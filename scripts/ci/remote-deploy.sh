#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pishkan — server-side deployment entry point for GitHub Actions.
#
# Uploaded and executed over SSH by scripts/ci/deploy-run.sh (runner side).
# It is not meant to be run by hand on a workstation; it expects a Pishkan VPS.
#
#   remote-deploy.sh <action> <domain> <acme_email> <force 0|1> <ref SHA> <branch>
#
# Actions: install | update | doctor | status | provision-tls | backup | report
#
# Security rules honoured here:
#   - No secret is ever printed. The initial admin password stays in the
#     root-only file the installer writes (/etc/pishkan/initial-admin-secret.txt);
#     the install report is sanitized by design and additionally scanned before
#     it is echoed to the (public) CI log.
#   - Every input is validated against a strict pattern before use.
#   - Non-root SSH users are escalated with `sudo -n` (fail fast, never prompt).
#   - The installer itself is idempotent and never deletes customer data.
# ---------------------------------------------------------------------------

set -Eeuo pipefail

REPO_URL="${PISHKAN_REPO_URL:-https://github.com/khajavy8056/Pishkan.git}"
CONFIG_DIR="/etc/pishkan"
STATE_DIR="/var/lib/pishkan"
LOG_DIR="/var/log/pishkan"
INSTALL_LOCK="${STATE_DIR}/.install-complete"
REPORT_FILE="${LOG_DIR}/install-report.md"

CLEANUP_DIR=""
# Always return 0: under `set -e` a non-zero EXIT trap could overwrite a
# successful action's exit code and make a good deploy look failed.
cleanup() {
  if [ -n "$CLEANUP_DIR" ]; then rm -rf "$CLEANUP_DIR"; fi
  return 0
}
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

# --- input validation (runs before escalation so errors are immediate) ------
validate_inputs() {
  local action="$1" domain="$2" email="$3" force="$4" ref="$5" branch="$6"
  case "$action" in
    install|update|doctor|status|provision-tls|backup|report) ;;
    *) die "unknown action '$action' (allowed: install update doctor status provision-tls backup report)" ;;
  esac
  if [ -n "$domain" ] && ! [[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$ ]]; then
    die "invalid domain '$domain' — expected e.g. office.example.ir, without scheme or path"
  fi
  if [ -n "$email" ] && ! [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    die "invalid acme_email '$email'"
  fi
  case "$force" in 0|1) ;; *) die "force must be 0 or 1, got '$force'" ;; esac
  if [ -n "$ref" ] && ! [[ "$ref" =~ ^[0-9a-fA-F]{40}$ ]]; then
    die "ref must be a full 40-character commit SHA, got '$ref'"
  fi
  if ! [[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    die "invalid branch name '$branch'"
  fi
}

# --- secret-safe report printing --------------------------------------------
# The CI log of a public repository is world-readable. The report is sanitized
# by the installer, but we scan it once more before echoing: anything that
# smells like a credential is withheld and left on the server for the operator.
print_report() {
  if [ ! -f "$REPORT_FILE" ]; then
    say "(no install report on this server yet)"
    return 0
  fi
  if grep -qiE 'BEGIN [A-Z ]*PRIVATE KEY|(DB_PASSWORD|APP_ENCRYPTION_KEY|BOOTSTRAP_ADMIN_PASSWORD|DATABASE_URL)[[:space:]]*=[[:space:]]*[^[:space:]]|(password|passwd|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*[^[:space:]]' "$REPORT_FILE"; then
    say "⚠ install report withheld from the public CI log (credential-like pattern detected)."
    say "  Read it on the server instead: sudo cat $REPORT_FILE"
    return 0
  fi
  say "----- install report ($REPORT_FILE) -----"
  cat "$REPORT_FILE"
  say "----- end of install report -----"
}

require_cli() {
  command -v pishkan >/dev/null 2>&1 \
    || die "Pishkan is not installed on this server (pishkan CLI not found). Run action=install first."
}

ensure_git() {
  command -v git >/dev/null 2>&1 && return 0
  say "git not found — installing it (needed to fetch the installer)…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git ca-certificates
}

# --- install -----------------------------------------------------------------
action_install() {
  local domain="$1" email="$2" force="$3" ref="$4" branch="$5"

  if [ -f "$INSTALL_LOCK" ] && [ "$force" != "1" ]; then
    say "✔ Pishkan is already installed on this server ($(cat "$INSTALL_LOCK" 2>/dev/null))."
    say "  Deploy new code with action=update, or re-run the installer with force=true (data preserved)."
    return 0
  fi
  [ -n "$ref" ] || die "install requires a full commit SHA (the workflow passes github.sha automatically)."
  if [ -n "$domain" ] && [ -z "$email" ]; then
    die "acme_email is required when domain is set (Let's Encrypt needs it). Leave domain blank for an IP-only first install, then use provision-tls once DNS is ready."
  fi

  ensure_git
  local src conf
  src="$(mktemp -d /tmp/pishkan-src.XXXXXX)"
  CLEANUP_DIR="$src"
  say "Fetching installer from ${REPO_URL} (branch ${branch})…"
  git clone --quiet --depth 1 --branch "$branch" "$REPO_URL" "$src"
  conf="$src/deploy/deploy.conf"
  [ -f "$conf" ] || die "deploy/deploy.conf template missing from the cloned source."

  if [ -z "$domain" ]; then
    # No domain yet: a clean IP-only HTTP install. Write explicit empty values
    # so no example.ir placeholder can leak into nginx, CORS or certificates.
    sed -i \
      -e 's|^DOMAIN=.*|DOMAIN=|' \
      -e 's|^DOMAIN_WWW=.*|DOMAIN_WWW=|' \
      -e 's|^BLOG_SUBDOMAIN=.*|BLOG_SUBDOMAIN=|' \
      -e 's|^ACME_EMAIL=.*|ACME_EMAIL=|' \
      -e 's|^TLS_MODE=.*|TLS_MODE=off|' \
      "$conf"
    say "No domain supplied — installing IP-only over HTTP (TLS off). Enable HTTPS later with provision-tls."
  else
    say "Domain ${domain} — the installer will request a Let's Encrypt certificate (DNS must already point here)."
  fi

  say "Running installer (pinned commit ${ref})…"
  local rc=0
  (
    cd "$src" || exit 1
    export PISHKAN_DEPLOY_CONF="$conf"
    export PISHKAN_COMMIT="$ref"
    if [ -n "$domain" ]; then
      # The installer's own DOMAIN/EMAIL overrides: config_validate clears the
      # placeholder www alias automatically, so the certificate covers exactly
      # the real domain instead of a leftover example.ir SAN.
      export DOMAIN="$domain" EMAIL="$email"
    fi
    if [ "$force" = "1" ]; then
      export PISHKAN_FORCE_INSTALL=1
    fi
    bash scripts/install.sh
  ) || rc=$?

  print_report
  return "$rc"
}

# --- update ------------------------------------------------------------------
action_update() {
  local ref="$1"
  require_cli
  [ -n "$ref" ] || die "update requires a full commit SHA (the workflow passes github.sha automatically)."
  pishkan update --ref "$ref"
}

# --- provision-tls -------------------------------------------------------------
conf_set() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

action_provision_tls() {
  local domain="$1" email="$2"
  require_cli
  local conf="$CONFIG_DIR/deploy.conf"
  [ -f "$conf" ] || die "$conf not found — run action=install first."

  if [ -n "$domain" ]; then
    [ -n "$email" ] || die "acme_email is required when domain is set."
    say "Updating $conf: DOMAIN=${domain}, TLS_MODE=auto"
    conf_set "$conf" DOMAIN "$domain"
    conf_set "$conf" ACME_EMAIL "$email"
    conf_set "$conf" TLS_MODE auto
    # DOMAIN_WWW is intentionally left untouched: adding a www SAN whose DNS
    # does not exist would make certbot fail for the whole certificate.
  else
    local current
    current="$(grep -E '^DOMAIN=' "$conf" | tail -1 | cut -d= -f2-)"
    [ -n "$current" ] || die "No domain is configured yet. Re-run provision-tls with the domain and acme_email inputs to enable HTTPS."
  fi
  pishkan provision --tls
}

# --- main ----------------------------------------------------------------------
main() {
  [ "$#" -eq 6 ] || die "usage: remote-deploy.sh <action> <domain> <acme_email> <force> <ref> <branch>"
  local action="$1" domain="$2" email="$3" force="$4" ref="$5" branch="$6"
  validate_inputs "$@"

  if [ "$(id -u)" -ne 0 ]; then
    say "SSH user is not root — escalating with sudo -n…"
    exec sudo -n bash "$0" "$action" "$domain" "$email" "$force" "$ref" "$branch"
  fi

  say "=== Pishkan remote deploy: action=${action} ref=${ref:0:12} branch=${branch} ==="
  case "$action" in
    install)       action_install "$domain" "$email" "$force" "$ref" "$branch" ;;
    update)        action_update "$ref" ;;
    doctor)        require_cli; pishkan doctor ;;
    status)        require_cli; pishkan status ;;
    provision-tls) action_provision_tls "$domain" "$email" ;;
    backup)        require_cli; pishkan backup ;;
    report)        print_report ;;
  esac
}

# Allow sourcing for unit tests without executing main.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
