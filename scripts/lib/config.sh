#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pishkan — deployment configuration
#
# Reads deploy.conf and turns it into the values nginx, systemd, the API and
# the installer all agree on. Sourced by scripts/install.sh and scripts/pishkan;
# never executed directly.
#
# The rule this file exists to enforce: **one source of truth**. The domain is
# written in exactly one place, and every consumer — nginx server_name, TLS
# certificate, CORS origin, session cookie domain, the app's own links — is
# derived from it. Nothing is hard-coded and nothing is asked twice.
# ---------------------------------------------------------------------------

PISHKAN_DEPLOY_CONF="${PISHKAN_DEPLOY_CONF:-${CONFIG_DIR:-/etc/pishkan}/deploy.conf}"

# Values that survived config_load, keyed by name. Bash 3 syntax (associative
# arrays need bash 4; Ubuntu ships 5, but the installer also runs on hosts where
# an old bash is picked up from PATH).
CONFIG_KEYS=()
CONFIG_VALUES=()

config_is_set() {
  local key="$1" i
  for i in "${!CONFIG_KEYS[@]}"; do
    [ "${CONFIG_KEYS[$i]}" = "$key" ] && return 0
  done
  return 1
}

config_get() {
  local key="$1" fallback="${2:-}" i
  for i in "${!CONFIG_KEYS[@]}"; do
    if [ "${CONFIG_KEYS[$i]}" = "$key" ]; then
      printf '%s' "${CONFIG_VALUES[$i]}"
      return 0
    fi
  done
  printf '%s' "$fallback"
}

config_set() {
  local key="$1" value="$2" i
  for i in "${!CONFIG_KEYS[@]}"; do
    if [ "${CONFIG_KEYS[$i]}" = "$key" ]; then
      CONFIG_VALUES[$i]="$value"
      return 0
    fi
  done
  CONFIG_KEYS+=("$key")
  CONFIG_VALUES+=("$value")
}

# Strip surrounding whitespace without spawning sed.
config_trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# Parse KEY=value lines. Deliberately not `source`: the file is owned by root
# but sits next to operator notes, and `source` would execute anything in it —
# including a stray `$(...)` in a comment someone pasted.
config_load() {
  local file="${1:-$PISHKAN_DEPLOY_CONF}"
  CONFIG_KEYS=()
  CONFIG_VALUES=()

  if [ ! -f "$file" ]; then
    return 1
  fi

  local line key value lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    line="${line%$'\r'}"
    # Full-line comments and blanks are the common case; skip before parsing.
    case "$line" in
      ''|'#'*) continue ;;
    esac
    # A trailing comment is stripped only when preceded by whitespace, so a
    # value that legitimately contains '#' survives.
    line="${line%%[[:space:]]#*}"
    line="$(config_trim "$line")"
    [ -n "$line" ] || continue

    case "$line" in
      *=*) ;;
      *) warn "deploy.conf خط ${lineno}: «${line}» قالب KEY=value ندارد؛ نادیده گرفته شد." ; continue ;;
    esac

    key="$(config_trim "${line%%=*}")"
    value="$(config_trim "${line#*=}")"

    # Drop matching quotes, if the operator added them out of habit.
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac

    case "$key" in
      [A-Z_]*)
        case "$key" in
          *[!A-Z0-9_]*) warn "deploy.conf خط ${lineno}: نام کلید «${key}» نامعتبر است." ; continue ;;
        esac
        ;;
      *) warn "deploy.conf خط ${lineno}: نام کلید «${key}» باید با حرف بزرگ لاتین شروع شود." ; continue ;;
    esac

    config_set "$key" "$value"
  done <"$file"

  return 0
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

CONFIG_ERRORS=()
CONFIG_WARNINGS=()

config_problem() { CONFIG_ERRORS+=("$*"); }
config_caution() { CONFIG_WARNINGS+=("$*"); }

# The template ships DOMAIN=pishkan.example.ir so the file is self-documenting.
# Treating that — or a blank — as "no domain yet" is what lets the same file be
# used before and after DNS is configured.
is_placeholder_domain() {
  case "${1:-}" in
    ''|*example.com*|*example.ir*|*example.org*) return 0 ;;
    *) return 1 ;;
  esac
}

is_domain_name() {
  local d="${1:-}"
  [ -n "$d" ] || return 1
  # Labels of letters/digits/hyphen, at least one dot, no trailing dot.
  [[ "$d" =~ ^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$ ]]
}

is_subdomain_of() {
  local child="${1:-}" parent="${2:-}"
  [ -n "$child" ] && [ -n "$parent" ] || return 1
  case "$child" in
    *".$parent") return 0 ;;
    *) return 1 ;;
  esac
}

config_validate() {
  CONFIG_ERRORS=()
  CONFIG_WARNINGS=()

  local domain email tls blog_mode blog_sub cf_mode keep tz aliases

  domain="$(config_get DOMAIN)"
  email="$(config_get ACME_EMAIL)"
  tls="$(config_get TLS_MODE auto)"
  blog_mode="$(config_get BLOG_MODE inline)"
  blog_sub="$(config_get BLOG_SUBDOMAIN)"
  cf_mode="$(config_get CLOUDFLARE_SSL_MODE full_strict)"
  keep="$(config_get KEEP_RELEASES 5)"
  tz="$(config_get TIMEZONE Asia/Tehran)"
  aliases="$(config_get DOMAIN_ALIASES)"

  # An empty or example domain is not an error: it means "serve on the IP".
  # That is a legitimate first install before DNS is pointed anywhere, and the
  # installer then skips TLS entirely. What IS an error is a domain that looks
  # like a domain but is malformed, because nginx would accept the config and
  # then answer to nobody.
  if is_placeholder_domain "$domain"; then
    config_caution "DOMAIN تنظیم نشده (یا مقدار نمونه است). سامانه روی IP و HTTP نصب می‌شود."
    config_caution "  بعداً: دامنه را در deploy.conf بنویسید و «sudo pishkan provision --tls» را اجرا کنید."
    domain=""
  elif ! is_domain_name "$domain"; then
    config_problem "DOMAIN نامعتبر است: «${domain}». باید شکل pishkan.example.ir داشته باشد، بدون https:// و بدون /."
  fi

  case "$domain" in
    *'/'*|*' '*|*':'*)
      config_problem "DOMAIN نباید شامل مسیر، فاصله یا پورت باشد: «${domain}»." ;;
  esac

  case "$tls" in
    auto|off) ;;
    *) config_problem "TLS_MODE باید auto یا off باشد (مقدار فعلی: «${tls}»)." ;;
  esac

  # The address only matters when a certificate will actually be requested.
  if [ "$tls" = "auto" ] && [ -n "$domain" ]; then
    if [ -z "$email" ]; then
      config_problem "ACME_EMAIL خالی است. برای دریافت گواهی HTTPS ایمیل لازم است."
    elif ! [[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$ ]]; then
      config_problem "ACME_EMAIL نامعتبر است: «${email}»."
    fi
  fi

  case "$blog_mode" in
    inline) ;;
    subdomain)
      if [ -z "$blog_sub" ]; then
        config_problem "BLOG_MODE=subdomain است ولی BLOG_SUBDOMAIN خالی است."
      elif ! is_domain_name "$blog_sub"; then
        config_problem "BLOG_SUBDOMAIN نامعتبر است: «${blog_sub}»."
      elif [ -n "$domain" ] && ! is_subdomain_of "$blog_sub" "$domain"; then
        config_problem "BLOG_SUBDOMAIN (${blog_sub}) باید زیردامنهٔ DOMAIN (${domain}) باشد."
      fi
      ;;
    *)
      config_problem "BLOG_MODE باید inline یا subdomain باشد (مقدار فعلی: «${blog_mode}»)." ;;
  esac

  case "$cf_mode" in
    full_strict) ;;
    full)
      config_caution "CLOUDFLARE_SSL_MODE=full گواهی مبدأ را اعتبارسنجی نمی‌کند؛ full_strict امن‌تر است." ;;
    flexible)
      config_problem "CLOUDFLARE_SSL_MODE=flexible با کوکی HTTPS-only کار نمی‌کند: کاربر در حلقهٔ ریدایرکت گیر می‌کند و ورود انجام نمی‌شود. آن را روی full_strict بگذارید و در پنل Cloudflare هم SSL/TLS را Full (strict) کنید." ;;
    *)
      config_problem "CLOUDFLARE_SSL_MODE باید full_strict، full یا flexible باشد." ;;
  esac

  case "$keep" in
    ''|*[!0-9]*) config_problem "KEEP_RELEASES باید عدد باشد (مقدار فعلی: «${keep}»)." ;;
    *) [ "$keep" -ge 2 ] || config_problem "KEEP_RELEASES باید دست‌کم ۲ باشد تا بازگشت ممکن بماند." ;;
  esac

  if [ -n "$tz" ] && [ -d /usr/share/zoneinfo ]; then
    [ -f "/usr/share/zoneinfo/${tz}" ] || config_problem "TIMEZONE ناشناخته است: «${tz}»."
  fi

  local alias
  for alias in $aliases; do
    if ! is_domain_name "$alias"; then
      config_problem "DOMAIN_ALIASES شامل نام نامعتبر «${alias}» است."
    elif [ "$alias" = "$domain" ]; then
      config_caution "DOMAIN_ALIASES تکراری است: ${alias} همان DOMAIN است."
    fi
  done

  [ ${#CONFIG_ERRORS[@]} -eq 0 ]
}

config_report() {
  local item
  for item in "${CONFIG_ERRORS[@]+"${CONFIG_ERRORS[@]}"}"; do
    err "deploy.conf: $item"
  done
  for item in "${CONFIG_WARNINGS[@]+"${CONFIG_WARNINGS[@]}"}"; do
    warn "deploy.conf: $item"
  done
  [ ${#CONFIG_ERRORS[@]} -eq 0 ]
}

# ---------------------------------------------------------------------------
# Derived values — every consumer reads these, never the raw keys
# ---------------------------------------------------------------------------

# Canonical public origin, no trailing slash.
config_app_url() {
  local domain
  domain="$(config_get DOMAIN)"
  if is_placeholder_domain "$domain"; then
    printf ''
    return
  fi
  if [ "$(config_get TLS_MODE auto)" = "off" ]; then
    printf 'http://%s' "$domain"
  else
    printf 'https://%s' "$domain"
  fi
}

# All hostnames the main site answers to, space separated.
config_main_hosts() {
  local domain www aliases
  domain="$(config_get DOMAIN)"
  if is_placeholder_domain "$domain"; then
    return 0
  fi
  www="$(config_get DOMAIN_WWW)"
  aliases="$(config_get DOMAIN_ALIASES)"
  [ -n "$domain" ] || return 0
  printf '%s' "$domain"
  [ -n "$www" ] && printf ' %s' "$www"
  [ -n "$aliases" ] && printf ' %s' "$aliases"
}

# Hostnames that need their own certificate.
config_tls_hosts() {
  local hosts
  hosts="$(config_main_hosts)"
  if [ "$(config_get BLOG_MODE inline)" = "subdomain" ]; then
    local blog
    blog="$(config_get BLOG_SUBDOMAIN)"
    [ -n "$blog" ] && hosts="$hosts $blog"
  fi
  printf '%s' "$hosts"
}

# CORS origins for the API: the main origin plus every sub-domain origin.
config_cors_origins() {
  local host scheme origins=""
  scheme="https"
  [ "$(config_get TLS_MODE auto)" = "off" ] && scheme="http"

  for host in $(config_tls_hosts); do
    if [ -z "$origins" ]; then
      origins="${scheme}://${host}"
    else
      origins="${origins},${scheme}://${host}"
    fi
  done
  printf '%s' "$origins"
}

config_blog_subdomain() {
  [ "$(config_get BLOG_MODE inline)" = "subdomain" ] || return 1
  local sub
  sub="$(config_get BLOG_SUBDOMAIN)"
  [ -n "$sub" ] || return 1
  printf '%s' "$sub"
}

# ---------------------------------------------------------------------------
# Writing the config back
# ---------------------------------------------------------------------------

# Set KEY=value inside deploy.conf, adding the key when it is absent. Used by
# the installer so a value the operator left blank is filled in once and then
# visible in the file for next time.
config_write() {
  local file="$1" key="$2" value="$3"
  [ -f "$file" ] || return 1

  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    # Use a temp file + mv so an interrupted write never truncates the file.
    local tmp
    tmp="$(mktemp "${file}.XXXXXX")"
    awk -v k="$key" -v v="$value" '
      BEGIN { done = 0 }
      {
        line = $0
        if (!done && line ~ "^[[:space:]]*" k "=") {
          print k "=" v
          done = 1
          next
        }
        print line
      }
    ' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >>"$file"
  fi
}

# The file to read: the installed copy when it exists, else the repo template.
config_resolve_file() {
  if [ -f "$PISHKAN_DEPLOY_CONF" ]; then
    printf '%s' "$PISHKAN_DEPLOY_CONF"
    return 0
  fi
  # Deliberately NOT falling back to the release's own deploy.conf: that copy
  # is the template, and its example domain would be read as "no domain" —
  # which on an already-installed server would rewrite nginx to answer on the
  # bare IP and drop HTTPS. A missing live config is an error to surface, not
  # something to paper over.
  printf ''
  return 1
}

# ---------------------------------------------------------------------------
# nginx template rendering
#
# Lives here, not in the installer and not in the CLI, because both render the
# same template and two copies drift. Bash parameter expansion is used on
# purpose: the replacement values contain `/`, `&`, `$`, `\` and newlines, and
# every one of those is a metacharacter in sed, perl or awk. Bash treats them
# as plain text.
# ---------------------------------------------------------------------------

# render_nginx_template <template> <out> <listen> <ssl> <redirect> <blog_block> \
#                       <server_name> <api_port> <web_root> <acme_root>
render_nginx_template() {
  local template="$1" out="$2" listen="$3" ssl="$4" redirect="$5"
  local blog_block="$6" server_name="$7" port="$8" web_root="$9" acme="${10}"
  local content

  [ -f "$template" ] || return 1

  content="$(cat "$template")"
  content="${content//__LISTEN__/$listen}"
  content="${content//__SSL__/$ssl}"
  content="${content//__REDIRECT__/$redirect}"
  content="${content//__BLOG_REDIRECT__/$blog_block}"
  content="${content//__SERVER_NAME__/$server_name}"
  content="${content//__API_PORT__/$port}"
  content="${content//__WEB_ROOT__/$web_root}"
  content="${content//__ACME_ROOT__/$acme}"

  printf '%s\n' "$content" >"$out"
}

# The listen/ssl/redirect fragments, built once so install and provision emit
# byte-identical vhosts.
nginx_fragment_listen_http() {
  printf '    listen 80;\n    listen [::]:80;\n'
}

nginx_fragment_listen_tls() {
  printf '    listen 443 ssl;\n    listen [::]:443 ssl;\n    http2 on;\n'
}

nginx_fragment_ssl() {
  local cert_primary="$1"
  local live="/etc/letsencrypt/live/${cert_primary}"
  printf '    ssl_certificate     %s/fullchain.pem;\n' "$live"
  printf '    ssl_certificate_key %s/privkey.pem;\n' "$live"
  printf '    ssl_trusted_certificate %s/chain.pem;\n' "$live"
  printf '    ssl_protocols TLSv1.2 TLSv1.3;\n'
  printf '    ssl_prefer_server_ciphers off;\n'
  printf '    ssl_session_cache shared:SSL:10m;\n'
  printf '    ssl_session_timeout 1d;\n'
  printf '    ssl_stapling on;\n'
  printf '    ssl_stapling_verify on;\n'
  printf '    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n'
}

nginx_fragment_http_redirect() {
  printf '    location / {\n        return 301 https://$host$request_uri;\n    }\n'
}

# The /blog* -> sub-domain redirect, when one is configured.
nginx_fragment_blog_redirect() {
  local blog_host="${1:-}"
  [ -n "$blog_host" ] || return 0
  printf '    # The blog moved to its own hostname. Permanent redirects keep every\n'
  printf '    # shared link and every indexed URL working.\n'
  printf '    location ~ ^/blog(/.*)?$ {\n'
  printf '        return 301 https://%s$1;\n' "$blog_host"
  printf '    }\n'
}
