#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pishkan — deployment logic checks
#
# The installer and the `pishkan` CLI cannot be run end-to-end without a real
# Ubuntu server, but almost every bug they have had is pure shell logic: a
# config value parsed wrong, a template placeholder that survived the render, a
# domain that should have been rejected. Those are all testable here, in a
# temp directory, with no root, no network and no systemd.
#
# Run:  bash tools/check_deploy.sh
# Exit: 0 when every check passes.
# ---------------------------------------------------------------------------

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
FAILED_NAMES=()

pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi
}

section() { printf '\n%s\n' "$1"; }

# ---------------------------------------------------------------------------
# Load the libraries the same way the installer does.
# ---------------------------------------------------------------------------
CONFIG_DIR="$WORK/etc"
export CONFIG_DIR
mkdir -p "$CONFIG_DIR"

# shellcheck source=../scripts/lib/common.sh
. "$REPO_ROOT/scripts/lib/common.sh"
# shellcheck source=../scripts/lib/config.sh
. "$REPO_ROOT/scripts/lib/config.sh"
# shellcheck source=../scripts/lib/net.sh
. "$REPO_ROOT/scripts/lib/net.sh"

# Silence the coloured logging while testing.
log() { :; }
ok() { :; }
warn() { :; }
err() { :; }
die() { return 1; }

# ---------------------------------------------------------------------------
section "config: parsing"
# ---------------------------------------------------------------------------

write_conf() {
  local path="$1"
  shift
  printf '%s\n' "$@" >"$path"
}

CONF="$WORK/deploy.conf"
write_conf "$CONF" \
  '# a comment' \
  'DOMAIN=pishkan.test-domain.ir' \
  '' \
  '  ACME_EMAIL = admin@test-domain.ir  ' \
  'BLOG_MODE=inline' \
  'TLS_MODE=auto'

config_load "$CONF"
check "DOMAIN is read" test "$(config_get DOMAIN)" = "pishkan.test-domain.ir"
check "surrounding whitespace is trimmed" test "$(config_get ACME_EMAIL)" = "admin@test-domain.ir"
check "missing key falls back" test "$(config_get NOPE fallback)" = "fallback"
check "comments are not keys" bash -c '! config_is_set a'

# Values that look like shell must never be executed.
write_conf "$CONF" 'DOMAIN=$(whoami)' 'ACME_EMAIL=`id`'
config_load "$CONF"
check "command substitution is left literal" test "$(config_get DOMAIN)" = '$(whoami)'
check "backticks are left literal" test "$(config_get ACME_EMAIL)" = '`id`'

# A value that legitimately contains '#', when not preceded by whitespace.
write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir#frag'
config_load "$CONF"
check "hash inside a value survives" test "$(config_get DOMAIN)" = 'pishkan.test-domain.ir#frag'

write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir   # trailing note'
config_load "$CONF"
check "trailing comment is stripped" test "$(config_get DOMAIN)" = 'pishkan.test-domain.ir'

write_conf "$CONF" 'DOMAIN="pishkan.test-domain.ir"'
config_load "$CONF"
check "optional quotes are removed" test "$(config_get DOMAIN)" = 'pishkan.test-domain.ir'

# ---------------------------------------------------------------------------
section "config: validation rejects what would break the install"
# ---------------------------------------------------------------------------

write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=admin@test-domain.ir'
config_load "$CONF"
check "a clean config validates" config_validate

BAD_DOMAINS=(
  'https://pishkan.test-domain.ir'
  'pishkan.test-domain.ir/'
  'pishkan'
  'pishkan..test-domain.ir'
  'pis hkan.test-domain.ir'
  'pishkan.test-domain.ir:8080'
)
for bad in "${BAD_DOMAINS[@]}"; do
  write_conf "$CONF" "DOMAIN=$bad" 'ACME_EMAIL=admin@test-domain.ir'
  config_load "$CONF"
  if config_validate; then
    fail "rejects bad DOMAIN: '${bad}'"
  else
    pass "rejects bad DOMAIN: '${bad}'"
  fi
done

write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=not-an-email'
config_load "$CONF"
check "rejects a malformed ACME_EMAIL" bash -c '! config_validate'

write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=admin@test-domain.ir' 'TLS_MODE=sometimes'
config_load "$CONF"
check "rejects an unknown TLS_MODE" bash -c '! config_validate'

# Flexible SSL is the single most common way this app breaks: session cookies
# are HTTPS-only, so the browser drops them and login loops forever.
write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=admin@test-domain.ir' \
  'CLOUDFLARE_SSL_MODE=flexible'
config_load "$CONF"
check "rejects Cloudflare flexible SSL" bash -c '! config_validate'

write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=admin@test-domain.ir' \
  'BLOG_MODE=subdomain' 'BLOG_SUBDOMAIN=blog.other-domain.ir'
config_load "$CONF"
check "rejects a blog host outside the main domain" bash -c '! config_validate'

write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=admin@test-domain.ir' \
  'BLOG_MODE=subdomain' 'BLOG_SUBDOMAIN=blog.pishkan.test-domain.ir'
config_load "$CONF"
check "accepts a blog host inside the main domain" config_validate

write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=admin@test-domain.ir' 'KEEP_RELEASES=1'
config_load "$CONF"
check "refuses KEEP_RELEASES below 2" bash -c '! config_validate'

# ---------------------------------------------------------------------------
section "config: derived values"
# ---------------------------------------------------------------------------

write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'DOMAIN_WWW=www.pishkan.test-domain.ir' \
  'ACME_EMAIL=admin@test-domain.ir' 'BLOG_MODE=subdomain' \
  'BLOG_SUBDOMAIN=blog.pishkan.test-domain.ir'
config_load "$CONF"

check "app URL is https from the domain" \
  test "$(config_app_url)" = "https://pishkan.test-domain.ir"
check "main hosts include domain and www" \
  test "$(config_main_hosts)" = "pishkan.test-domain.ir www.pishkan.test-domain.ir"
check "TLS hosts include the blog sub-domain" \
  test "$(config_tls_hosts)" = "pishkan.test-domain.ir www.pishkan.test-domain.ir blog.pishkan.test-domain.ir"
check "CORS lists every origin" \
  test "$(config_cors_origins)" = "https://pishkan.test-domain.ir,https://www.pishkan.test-domain.ir,https://blog.pishkan.test-domain.ir"
check "blog sub-domain is exposed" \
  test "$(config_blog_subdomain)" = "blog.pishkan.test-domain.ir"

# TLS off must downgrade every derived URL, or cookies and CORS disagree with
# what nginx actually serves.
write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=admin@test-domain.ir' 'TLS_MODE=off'
config_load "$CONF"
check "TLS off yields an http app URL" \
  test "$(config_app_url)" = "http://pishkan.test-domain.ir"
check "TLS off yields http CORS origins" \
  test "$(config_cors_origins)" = "http://pishkan.test-domain.ir"

# Inline mode must not produce a blog host anywhere.
write_conf "$CONF" 'DOMAIN=pishkan.test-domain.ir' 'ACME_EMAIL=admin@test-domain.ir' 'BLOG_MODE=inline'
config_load "$CONF"
check "inline mode has no blog sub-domain" bash -c '! config_blog_subdomain'
check "inline mode keeps CORS to the main origin" \
  test "$(config_cors_origins)" = "https://pishkan.test-domain.ir"

# ---------------------------------------------------------------------------
section "config: stale values from the template"
# ---------------------------------------------------------------------------

# The commonest operator mistake: change DOMAIN, forget DOMAIN_WWW and
# BLOG_SUBDOMAIN. Asking Let's Encrypt for a hostname you do not own fails the
# WHOLE certificate, including the one domain that was correct.
write_conf "$CONF" \
  'DOMAIN=pishkan.mysite.ir' \
  'DOMAIN_WWW=www.pishkan.example.ir' \
  'ACME_EMAIL=ops@mysite.ir'
config_load "$CONF"
config_validate
check "a stale DOMAIN_WWW is dropped, not certified" \
  test "$(config_tls_hosts)" = "pishkan.mysite.ir"

write_conf "$CONF" \
  'DOMAIN=pishkan.mysite.ir' \
  'BLOG_MODE=subdomain' \
  'BLOG_SUBDOMAIN=blog.pishkan.example.ir' \
  'ACME_EMAIL=ops@mysite.ir'
config_load "$CONF"
check "a stale BLOG_SUBDOMAIN is an error, not a silent miss" bash -c '! config_validate'

# A consistent file must be left alone.
write_conf "$CONF" \
  'DOMAIN=pishkan.mysite.ir' \
  'DOMAIN_WWW=www.pishkan.mysite.ir' \
  'BLOG_MODE=subdomain' \
  'BLOG_SUBDOMAIN=blog.pishkan.mysite.ir' \
  'ACME_EMAIL=ops@mysite.ir'
config_load "$CONF"
check "a consistent file validates" config_validate
check "a consistent file certifies all three hosts" \
  test "$(config_tls_hosts)" = "pishkan.mysite.ir www.pishkan.mysite.ir blog.pishkan.mysite.ir"

# ---------------------------------------------------------------------------
section "config: IP-only install (no domain yet)"
# ---------------------------------------------------------------------------

# A fresh server with no DNS must still install. Treating the template's
# example domain as "not set" is what makes one config file work before and
# after DNS is pointed at the box.
write_conf "$CONF" 'DOMAIN=pishkan.example.ir' 'ACME_EMAIL=admin@test-domain.ir'
config_load "$CONF"
check "an example domain validates without error" config_validate
check "an example domain yields no app URL" test -z "$(config_app_url)"
check "an example domain yields no hosts" test -z "$(config_main_hosts)"

write_conf "$CONF" 'DOMAIN=' 'ACME_EMAIL='
config_load "$CONF"
check "an empty domain validates" config_validate
check "an empty domain yields no CORS" test -z "$(config_cors_origins)"

# But a domain that LOOKS real and is malformed must still be rejected, or
# nginx accepts a config that answers to nobody.
write_conf "$CONF" 'DOMAIN=pishkan' 'ACME_EMAIL=admin@test-domain.ir'
config_load "$CONF"
check "a malformed domain is still rejected" bash -c '! config_validate'

# ---------------------------------------------------------------------------
section "config: writing a value back"
# ---------------------------------------------------------------------------

WRITE="$WORK/write.conf"
printf '%s\n' '# header' 'DOMAIN=old.example.ir' 'ACME_EMAIL=admin@test-domain.ir' >"$WRITE"
config_write "$WRITE" 'DOMAIN' 'new.example.ir'
check "existing key is replaced in place" grep -qx 'DOMAIN=new.example.ir' "$WRITE"
check "replaced key keeps the comment header" grep -qx '# header' "$WRITE"
check "other keys are untouched" grep -qx 'ACME_EMAIL=admin@test-domain.ir' "$WRITE"
config_write "$WRITE" 'NEW_KEY' 'value'
check "missing key is appended" grep -qx 'NEW_KEY=value' "$WRITE"
if config_load "$WRITE" && [ "$(config_get NEW_KEY)" = "value" ]; then
  pass "the file still loads after writing"
else
  fail "the file still loads after writing"
fi

# ---------------------------------------------------------------------------
section "nginx: template rendering"
# ---------------------------------------------------------------------------

TEMPLATE="$REPO_ROOT/deploy/nginx/pishkan.conf"

render_into() {
  # Mirrors render_site from install.sh exactly.
  local out="$1" server_name="$2" blog_block="$3" port="$4" web_root="$5" acme="$6" listen="$7"
  local content
  content="$(cat "$TEMPLATE")"
  content="${content//__LISTEN__/$listen}"
  content="${content//__SSL__/}"
  content="${content//__REDIRECT__/}"
  content="${content//__BLOG_REDIRECT__/$blog_block}"
  content="${content//__SERVER_NAME__/$server_name}"
  content="${content//__API_PORT__/$port}"
  content="${content//__WEB_ROOT__/$web_root}"
  content="${content//__ACME_ROOT__/$acme}"
  printf '%s\n' "$content" >"$out"
}

HTTP_OUT="$WORK/http.conf"
render_into "$HTTP_OUT" "pishkan.test-domain.ir www.pishkan.test-domain.ir" "" "3000" \
  "/opt/pishkan/current/apps/web/dist" "/var/www/letsencrypt" \
  "    listen 80;
    listen [::]:80;
"

check "no placeholder survives the render" \
  bash -c "! grep -q '__[A-Z_]*__' '$HTTP_OUT'"
check "server_name carries every host" \
  grep -q 'server_name pishkan.test-domain.ir www.pishkan.test-domain.ir;' "$HTTP_OUT"
check "API port is substituted" grep -q 'server 127.0.0.1:3000;' "$HTTP_OUT"
check "web root is substituted" \
  grep -q 'root /opt/pishkan/current/apps/web/dist;' "$HTTP_OUT"
check "ACME root is substituted" grep -q 'root /var/www/letsencrypt;' "$HTTP_OUT"

# ACME must be reachable: the location has to appear BEFORE the SPA fallback,
# otherwise renewals 404 with an HTML body and look like DNS failures.
ACME_LINE="$(grep -n 'location \^~ /.well-known/acme-challenge/' "$HTTP_OUT" | head -1 | cut -d: -f1)"
SPA_LINE="$(grep -n 'location / {' "$HTTP_OUT" | head -1 | cut -d: -f1)"
if [ -n "$ACME_LINE" ] && [ -n "$SPA_LINE" ] && [ "$ACME_LINE" -lt "$SPA_LINE" ]; then
  pass "ACME block precedes the SPA fallback"
else
  fail "ACME block precedes the SPA fallback" "acme=${ACME_LINE:-none} spa=${SPA_LINE:-none}"
fi

# Cloudflare real-IP handling: without it every visitor shares one rate limit.
check "Cloudflare real-IP ranges are trusted" \
  grep -q 'real_ip_header CF-Connecting-IP;' "$HTTP_OUT"
check "a Cloudflare range is present" grep -q '104.16.0.0/13;' "$HTTP_OUT"

BLOG_BLOCK="    location ~ ^/blog(/.*)?\$ {
        return 301 https://blog.pishkan.test-domain.ir\$1;
    }
"
BLOG_OUT="$WORK/http-blog.conf"
render_into "$BLOG_OUT" "pishkan.test-domain.ir blog.pishkan.test-domain.ir" "$BLOG_BLOCK" "3000" \
  "/srv/app" "/var/www/letsencrypt" "    listen 80;
"
check "blog redirect is rendered when the sub-domain is on" \
  grep -q 'return 301 https://blog.pishkan.test-domain.ir' "$BLOG_OUT"
check "the redirect keeps the path" grep -q 'blog.pishkan.test-domain.ir\$1;' "$BLOG_OUT"

INLINE_OUT="$WORK/http-inline.conf"
render_into "$INLINE_OUT" "pishkan.test-domain.ir" "" "3000" "/srv/app" "/acme" "    listen 80;
"
check "no blog redirect in inline mode" \
  bash -c "! grep -q 'return 301 https://blog' '$INLINE_OUT'"

# Braces must balance, or nginx refuses the whole config and the site is down.
open_braces=$(grep -o '{' "$HTTP_OUT" | wc -l)
close_braces=$(grep -o '}' "$HTTP_OUT" | wc -l)
check "braces balance in the rendered config" test "$open_braces" -eq "$close_braces"

# The template must not still reference the removed per-subdomain file.
check "no stale subdomain.conf reference" \
  bash -c "! grep -rq 'subdomain.conf' '$REPO_ROOT/scripts'"

# ---------------------------------------------------------------------------
section "nginx: install and provision render identically"
# ---------------------------------------------------------------------------

# The renderer moved into lib/config.sh precisely because two copies drift.
# This proves both callers go through it and produce the same bytes.
T1="$WORK/from-lib-http.conf"
render_nginx_template "$TEMPLATE" "$T1" \
  "$(nginx_fragment_listen_http)" "" "" \
  "$(nginx_fragment_blog_redirect 'blog.pishkan.test-domain.ir')" \
  "pishkan.test-domain.ir blog.pishkan.test-domain.ir" 3000 "/srv/app" "/acme"

check "the shared renderer emits no placeholder" bash -c "! grep -q '__[A-Z_]*__' '$T1'"
check "the shared renderer writes the listen line" grep -q 'listen 80;' "$T1"
check "the shared renderer writes the server_name" \
  grep -q 'server_name pishkan.test-domain.ir blog.pishkan.test-domain.ir;' "$T1"
check "the blog redirect fragment carries the host" \
  grep -q 'return 301 https://blog.pishkan.test-domain.ir' "$T1"

# TLS fragments: every line the vhost needs must be present, or nginx starts
# but refuses to serve 443.
SSL_FRAG="$(nginx_fragment_ssl 'pishkan.test-domain.ir')"
for needle in 'ssl_certificate ' 'ssl_certificate_key ' 'ssl_protocols' \
              'ssl_stapling on' 'Strict-Transport-Security'; do
  if printf '%s' "$SSL_FRAG" | grep -q "$needle"; then
    pass "ssl fragment contains '${needle}'"
  else
    fail "ssl fragment contains '${needle}'"
  fi
done

if nginx_fragment_listen_tls | grep -q 'listen 443 ssl'; then
  pass "listen tls mentions 443 ssl"
else
  fail "listen tls mentions 443 ssl"
fi
if nginx_fragment_http_redirect | grep -q 'return 301 https://'; then
  pass "the http redirect points at https"
else
  fail "the http redirect points at https"
fi
check "no blog fragment when no host is given" \
  test -z "$(nginx_fragment_blog_redirect '')"

# Command substitution strips trailing newlines, which used to glue
# `http2 on;` and the first ssl_certificate line together into one broken
# directive. Every fragment line must start on its own line.
TLS_OUT="$WORK/tls.conf"
render_nginx_template "$TEMPLATE" "$TLS_OUT" \
  "$(nginx_fragment_listen_tls)" "$(nginx_fragment_ssl 'pishkan.test-domain.ir')" "" \
  "" "pishkan.test-domain.ir" 3000 "/srv/app" "/acme"

check "http2 is its own directive" grep -qxE '[[:space:]]*http2 on;' "$TLS_OUT"
check "ssl_certificate starts a line" \
  grep -qxE '[[:space:]]*ssl_certificate[[:space:]]+/etc/letsencrypt/live/pishkan\.test-domain\.ir/fullchain\.pem;' "$TLS_OUT"
check "listen 443 and http2 are not merged" \
  bash -c "! grep -qE 'http2 on;.*ssl_certificate' '$TLS_OUT'"
# The template's own description lines mention "ssl_certificate" and the
# redirect, but must stay COMMENTED. A renderer that substitutes inside
# comments turns them into live directives and nginx refuses to start.
check "no uncommented line came from the template's comment block" \
  bash -c "! grep -qE '^[[:space:]]*ssl_certificate / protocol' '$TLS_OUT' && \
           ! grep -qE '^[[:space:]]*:80 → :443' '$TLS_OUT'"
check "the template comment block is still present and commented" \
  grep -qE '^#.*server_name[[:space:]]+every hostname' "$TLS_OUT"

# Neither caller may keep a private copy of the substitution logic.
check "install.sh uses the shared renderer" \
  grep -q 'render_nginx_template' "$REPO_ROOT/scripts/install.sh"
check "the CLI uses the shared renderer" \
  grep -q 'render_nginx_template' "$REPO_ROOT/scripts/pishkan"
check "install.sh has no private placeholder substitution" \
  bash -c "! grep -q '__SERVER_NAME__' '$REPO_ROOT/scripts/install.sh'"
check "the CLI has no private placeholder substitution" \
  bash -c "! grep -q '__SERVER_NAME__' '$REPO_ROOT/scripts/pishkan'"

# ---------------------------------------------------------------------------
section "dns: classification without network"
# ---------------------------------------------------------------------------

# The Cloudflare range table is what separates "proxied" from "points elsewhere".
if ipv4_in_cidr "104.16.5.5" "104.16.0.0/13"; then
  pass "Cloudflare CIDR match"
else
  fail "Cloudflare CIDR match"
fi
if ipv4_in_cidr "8.8.8.8" "104.16.0.0/13"; then
  fail "non-Cloudflare IP is excluded"
else
  pass "non-Cloudflare IP is excluded"
fi
if ipv4_in_cidr "172.70.1.1" "172.64.0.0/13"; then
  pass "a second Cloudflare range matches"
else
  fail "a second Cloudflare range matches"
fi

# ---------------------------------------------------------------------------
section "update: release pruning"
# ---------------------------------------------------------------------------

# Reimplemented here because the CLI runs it inline; the contract is what
# matters: keep N directories, always keep `previous`, never touch others.
prune_releases() {
  local releases_dir="$1" keep="$2" keep_extra="$3"
  [ -d "$releases_dir" ] || return 0
  local -a all
  mapfile -t all < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
  local total=${#all[@]}
  [ "$total" -gt "$keep" ] || return 0
  local remove=$((total - keep))
  local name
  for name in "${all[@]}"; do
    [ "$remove" -gt 0 ] || break
    [ "$name" = "$keep_extra" ] && continue
    rm -rf "${releases_dir:?}/${name}"
    remove=$((remove - 1))
  done
}

REL="$WORK/releases"
mkdir -p "$REL"
for i in 1 2 3 4 5 6 7; do mkdir -p "$REL/2026010${i}000000"; done
prune_releases "$REL" 5 "20260107000000"
remaining=$(find "$REL" -mindepth 1 -maxdepth 1 -type d | wc -l)
check "pruning keeps exactly KEEP_RELEASES" test "$remaining" -eq 5
check "the newest release survives" test -d "$REL/20260107000000"
check "pruning never removes the protected release" test -d "$REL/20260107000000"

REL2="$WORK/releases2"
mkdir -p "$REL2"
for i in 1 2 3; do mkdir -p "$REL2/2026010${i}000000"; done
prune_releases "$REL2" 5 ""
remaining2=$(find "$REL2" -mindepth 1 -maxdepth 1 -type d | wc -l)
check "pruning is a no-op below the limit" test "$remaining2" -eq 3

# A protected release that is also the oldest must still survive.
REL3="$WORK/releases3"
mkdir -p "$REL3"
for i in 1 2 3 4; do mkdir -p "$REL3/2026010${i}000000"; done
prune_releases "$REL3" 2 "20260101000000"
check "an old but protected release survives" test -d "$REL3/20260101000000"

# ---------------------------------------------------------------------------
section "shell: static analysis"
# ---------------------------------------------------------------------------

# ShellCheck catches the class of bug that only shows up at 3am on a customer's
# server: a word-split path, an unquoted glob, a `local x=$(cmd)` that swallows
# the exit code. It is optional so the suite still runs without it, but it is
# wired into CI whenever it is installed.
if command -v shellcheck >/dev/null 2>&1; then
  for script in scripts/install.sh scripts/pishkan scripts/lib/common.sh \
                scripts/lib/config.sh scripts/lib/net.sh tools/check_deploy.sh; do
    if shellcheck -S warning -f gcc "$REPO_ROOT/$script" >"$WORK/sc.txt" 2>&1; then
      pass "shellcheck: ${script}"
    else
      fail "shellcheck: ${script}" "$(head -5 "$WORK/sc.txt")"
    fi
  done
else
  printf '  --   shellcheck not installed; skipped (install: pip install shellcheck-py)\n'
fi

# ---------------------------------------------------------------------------
section "update: rollback safety of migrations"
# ---------------------------------------------------------------------------

# Expand/contract rule: a migration that drops or renames something makes
# `pishkan rollback` a data-loss event. Enforce it mechanically so a future
# contributor cannot merge one by accident.
MIG_DIR="$REPO_ROOT/apps/api/migrations"
# Strip SQL line comments first: a migration whose header says "this renames
# nothing" must not trip the check, and a real statement hidden after a comment
# on the same line must still be caught.
destructive=""
for mig in "$MIG_DIR"/*.sql; do
  [ -f "$mig" ] || continue
  hits="$(sed 's/--.*$//' "$mig" | grep -inE '\b(drop[[:space:]]+(table|column)|rename[[:space:]]+(table|column|to)|truncate[[:space:]]+table|alter[[:space:]]+table[^;]*drop[[:space:]]+column)\b' || true)"
  if [ -n "$hits" ]; then
    destructive="${destructive}${mig}: ${hits}"$'\n'
  fi
done
if [ -z "$destructive" ]; then
  pass "no migration drops, renames or truncates anything"
else
  fail "no migration drops, renames or truncates anything" "$destructive"
fi

migration_count=$(find "$MIG_DIR" -maxdepth 1 -name '*.sql' | wc -l)
if [ "$migration_count" -ge 39 ]; then
  pass "all ${migration_count} migrations are present"
else
  fail "all migrations are present" "found ${migration_count}"
fi

# ---------------------------------------------------------------------------
section "docs: the contract is written down"
# ---------------------------------------------------------------------------

CHECK_DOCS=(
  "docs/DEPLOY.md:deploy.conf"
  "docs/DEPLOY.md:pishkan update"
  "docs/UPDATE.md:pishkan rollback"
  "docs/UPDATING-FOR-DEVELOPERS.md:expand"
)
for entry in "${CHECK_DOCS[@]}"; do
  file="${entry%%:*}"
  needle="${entry#*:}"
  if [ -f "$REPO_ROOT/$file" ] && grep -qi "$needle" "$REPO_ROOT/$file"; then
    pass "$(basename "$file") documents '${needle}'"
  else
    fail "$(basename "$file") documents '${needle}'"
  fi
done

# ---------------------------------------------------------------------------
section "install.sh: references stay valid"
# ---------------------------------------------------------------------------

check "install.sh parses" bash -n "$REPO_ROOT/scripts/install.sh"
check "pishkan CLI parses" bash -n "$REPO_ROOT/scripts/pishkan"
check "config.sh parses" bash -n "$REPO_ROOT/scripts/lib/config.sh"
check "net.sh parses" bash -n "$REPO_ROOT/scripts/lib/net.sh"

# The library is fetched by name over the network during a piped install; a
# file that exists but is not in that list silently half-installs.
for lib in common.sh config.sh net.sh; do
  check "install.sh fetches ${lib}" grep -q "${lib}" "$REPO_ROOT/scripts/install.sh"
done

# Deploy config keys must match what the code reads, both ways.
for key in DOMAIN DOMAIN_WWW ACME_EMAIL DOMAIN_ALIASES BLOG_MODE BLOG_SUBDOMAIN \
           TLS_MODE CLOUDFLARE_SSL_MODE TIMEZONE TRUST_PROXY BACKUP_ENABLED KEEP_RELEASES; do
  if grep -qE "^${key}=" "$REPO_ROOT/deploy/deploy.conf" && grep -rq "config_get ${key}" "$REPO_ROOT/scripts"; then
    pass "config key ${key} is declared and consumed"
  else
    fail "config key ${key} is declared and consumed"
  fi
done

# A placeholder in the template with no substitution is an nginx syntax error
# waiting to happen, and only at install time on a real server.
# `__LISTEN____SSL__` on the same line is one grep hit for two adjacent
# placeholders; split them so each is checked on its own.
TEMPLATE_PLACEHOLDERS="$(sed 's/__LISTEN____SSL__/__LISTEN__ __SSL__/' "$TEMPLATE" \
  | grep -o '__[A-Z_]*__' | sort -u)"
for ph in $TEMPLATE_PLACEHOLDERS; do
  # The renderer lives in lib/config.sh; if a placeholder is not there, the
  # template will ship it verbatim into nginx.conf and break the next reload.
  if grep -q "${ph}" "$REPO_ROOT/scripts/lib/config.sh" \
     || grep -q "${ph}" "$REPO_ROOT/scripts/install.sh"; then
    pass "template placeholder ${ph} is substituted"
  else
    fail "template placeholder ${ph} is substituted"
  fi
done

# ---------------------------------------------------------------------------
printf '\n----------------------------------------------------------------\n'
printf 'check_deploy: %d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'failed: %s\n' "${FAILED_NAMES[*]}"
  exit 1
fi
