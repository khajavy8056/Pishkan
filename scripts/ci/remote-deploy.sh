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
# Production always uses the defaults; the overrides exist so the session
# machinery can be exercised end-to-end in a sandbox without touching /etc.
CONFIG_DIR="${PISHKAN_CONFIG_DIR:-/etc/pishkan}"
STATE_DIR="${PISHKAN_STATE_DIR:-/var/lib/pishkan}"
LOG_DIR="${PISHKAN_LOG_DIR:-/var/log/pishkan}"
INSTALL_LOCK="${STATE_DIR}/.install-complete"
REPORT_FILE="${LOG_DIR}/install-report.md"

# Long actions run inside a detached tmux session so a dropped SSH connection
# does NOT kill the install. The session keeps running on the server; the
# operator can watch it live from PuTTY with `tmux attach -r -t pishkan-deploy`.
SESSION_NAME="pishkan-deploy"
SESSION_LOG="${LOG_DIR}/deploy-session.log"
SESSION_EXIT="${LOG_DIR}/deploy-session.exit"

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
    install|update|doctor|status|provision-tls|backup|report|logs|reset) ;;
    *) die "unknown action '$action' (allowed: install update doctor status provision-tls backup report logs reset)" ;;
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

# --- logs (precise, secret-safe diagnostics) ----------------------------------
# Stream redaction: strip anything that looks like a credential assignment or a
# password inside a connection URL before it can reach the (public) CI log.
redact_stream() {
  sed -E \
    -e 's/(DB_PASSWORD|APP_ENCRYPTION_KEY|BOOTSTRAP_ADMIN_PASSWORD|DATABASE_URL|PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY)([[:space:]]*[:=][[:space:]]*)[^[:space:]]+/\1\2[redacted]/Ig' \
    -e 's#(postgres(ql)?://[^:/[:space:]]+:)[^@[:space:]]+@#\1[redacted]@#Ig'
}

action_logs() {
  say "===== tmux deploy session (live status) ====="
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    say "session '$SESSION_NAME' is RUNNING — watch from PuTTY: tmux attach -r -t $SESSION_NAME"
  else
    say "(no running deploy session)"
  fi
  if [ -f "$SESSION_EXIT" ]; then say "last session exit code: $(cat "$SESSION_EXIT")"; fi
  if [ -f "$SESSION_LOG" ]; then
    say ""
    say "===== deploy-session.log (last 120 lines — full installer output) ====="
    tail -n 120 "$SESSION_LOG" | redact_stream
  fi
  say ""
  say "===== install.log (last 150 lines) ====="
  if [ -f "$LOG_DIR/install.log" ]; then tail -n 150 "$LOG_DIR/install.log" | redact_stream; else say "(no install.log yet)"; fi
  say ""
  say "===== install-journal.jsonl (last 40 steps) ====="
  if [ -f "$LOG_DIR/install-journal.jsonl" ]; then tail -n 40 "$LOG_DIR/install-journal.jsonl"; else say "(no journal yet)"; fi
  say ""
  say "===== pishkan-api service journal (last 150 lines) ====="
  if command -v journalctl >/dev/null 2>&1; then journalctl -u pishkan-api -n 150 --no-pager 2>/dev/null | redact_stream || say "(no service journal)"; else say "(journalctl unavailable)"; fi
  say ""
  say "===== nginx error log (last 80 lines) ====="
  if [ -f /var/log/nginx/error.log ]; then tail -n 80 /var/log/nginx/error.log | redact_stream; else say "(no nginx error log)"; fi
}

# --- reset (clean a broken/half install; NEVER deletes customer data) ----------
# Removes code releases, the service + timer, the CLI, the nginx vhosts and the
# install lock so the installer can run again from a clean slate. The database,
# uploads, /etc/pishkan config and /var/backups/pishkan are ALWAYS preserved.
# Requires force=1 because it stops the running service.
action_reset() {
  local force="$1"
  [ "$force" = "1" ] || die "reset requires force=true (it stops the service). Customer data, uploads, config and backups are never deleted."
  say "Resetting install state — preserving database, uploads, config and backups…"

  # A still-running install session would race with the cleanup — end it first.
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    say "Stopping the running deploy session '$SESSION_NAME' first…"
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  fi
  # Also remove the panel binary so a stale panel cannot call a removed CLI.
  rm -f /usr/local/bin/pishkan-panel

  systemctl stop pishkan-api 2>/dev/null || true
  systemctl disable pishkan-api 2>/dev/null || true
  systemctl stop pishkan-backup.timer 2>/dev/null || true
  systemctl disable pishkan-backup.timer 2>/dev/null || true

  rm -f /etc/systemd/system/pishkan-api.service \
        /etc/systemd/system/pishkan-backup.service \
        /etc/systemd/system/pishkan-backup.timer
  systemctl daemon-reload 2>/dev/null || true

  # Code releases only — never the data directories.
  rm -rf /opt/pishkan/releases /opt/pishkan/current /opt/pishkan/previous
  rm -f /usr/local/bin/pishkan

  rm -f /etc/nginx/sites-enabled/pishkan.conf /etc/nginx/sites-enabled/pishkan-tls.conf \
        /etc/nginx/sites-available/pishkan.conf /etc/nginx/sites-available/pishkan-tls.conf
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then systemctl reload nginx 2>/dev/null || true; fi

  rm -f "$INSTALL_LOCK"

  say "✔ Reset complete. Preserved: PostgreSQL database, /var/lib/pishkan/uploads, /etc/pishkan, /var/backups/pishkan."
  say "  Re-run action=install to install fresh; it reuses the preserved config and data."
}

# --- tmux session persistence --------------------------------------------------
ensure_tmux() {
  command -v tmux >/dev/null 2>&1 && return 0
  say "Installing tmux (keeps the install alive across SSH disconnects)…"
  export DEBIAN_FRONTEND=noninteractive
  # Fresh Ubuntu boots often hold the dpkg lock (unattended-upgrades) — retry.
  local attempt
  for attempt in 1 2 3; do
    if apt-get update -qq && apt-get install -y -qq tmux; then return 0; fi
    say "apt attempt ${attempt} failed (dpkg lock?) — retrying in 15s…"
    sleep 15
  done
  die "could not install tmux after 3 attempts — install it manually: apt-get install -y tmux"
}

# Dispatch a single action (used both directly and inside the tmux session).
dispatch_action() {
  local action="$1" domain="$2" email="$3" force="$4" ref="$5" branch="$6"
  case "$action" in
    install)       action_install "$domain" "$email" "$force" "$ref" "$branch" ;;
    update)        action_update "$ref" ;;
    doctor)        require_cli; pishkan doctor ;;
    status)        require_cli; pishkan status ;;
    provision-tls) action_provision_tls "$domain" "$email" ;;
    backup)        require_cli; pishkan backup ;;
    report)        print_report ;;
    logs)          action_logs ;;
    reset)         action_reset "$force" ;;
  esac
}

# Follow the running session's log until it writes its exit marker. This is the
# best-effort foreground part: if the SSH connection drops, the tmux session (the
# actual work) keeps running on the server and can be re-attached or re-followed.
follow_session() {
  local tailpid waited=0 rc
  tail -n +1 -f "$SESSION_LOG" & tailpid=$!
  while [ ! -f "$SESSION_EXIT" ]; do
    sleep 2; waited=$((waited + 2))
    if [ "$waited" -ge 3600 ]; then
      kill "$tailpid" 2>/dev/null || true
      die "deploy session timed out after 1h — it may still be running: tmux attach -t $SESSION_NAME"
    fi
    if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null && [ ! -f "$SESSION_EXIT" ]; then
      sleep 2
      [ -f "$SESSION_EXIT" ] && break
      kill "$tailpid" 2>/dev/null || true
      die "deploy session ended without an exit marker — inspect: cat $SESSION_LOG"
    fi
  done
  sleep 1
  kill "$tailpid" 2>/dev/null || true
  rc="$(cat "$SESSION_EXIT" 2>/dev/null || echo 1)"
  say ""
  say "=== deploy session finished (exit $rc) ==="
  return "$rc"
}

# Run a long action inside a detached tmux session (survives SSH disconnects).
run_long_action() {
  local action="$1" domain="$2" email="$3" force="$4" ref="$5" branch="$6"
  mkdir -p "$LOG_DIR"

  # Inside the tmux session: do the work, capture output + exit code. The work
  # runs in nested subshells so a `die`/non-zero exit is captured into the marker
  # instead of aborting before the marker is written; `set +e` is confined to the
  # subshell so it never leaks to the caller's shell options.
  if [ "${PISHKAN_IN_TMUX:-0}" = "1" ]; then
    local rc
    (
      set +e
      ( dispatch_action "$action" "$domain" "$email" "$force" "$ref" "$branch" ) 2>&1 | tee -a "$SESSION_LOG"
      printf '%s\n' "${PIPESTATUS[0]}" > "$SESSION_EXIT"
    )
    rc="$(cat "$SESSION_EXIT" 2>/dev/null || echo 1)"
    return "$rc"
  fi

  ensure_tmux
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    say "A deploy session is already running (tmux: $SESSION_NAME) — following it (resume after a disconnect)."
  else
    rm -f "$SESSION_EXIT"
    : > "$SESSION_LOG"
    # A tiny runner guarantees the exit marker even if the inner script dies
    # early (input validation, sudo failure, …) before its own marker logic.
    local runner="${LOG_DIR}/deploy-session-runner.sh"
    {
      printf '#!/usr/bin/env bash\n'
      # Pin the effective paths explicitly: a long-lived tmux server can carry
      # a stale environment, so the inner run must not rely on inheritance.
      printf 'export PISHKAN_CONFIG_DIR=%q PISHKAN_STATE_DIR=%q PISHKAN_LOG_DIR=%q PISHKAN_REPO_URL=%q\n' \
        "$CONFIG_DIR" "$STATE_DIR" "$LOG_DIR" "$REPO_URL"
      printf 'PISHKAN_IN_TMUX=1 bash %q' "$0"
      printf ' %q' "$action" "$domain" "$email" "$force" "$ref" "$branch"
      printf '\nrc=$?\n'
      printf '[ -f %q ] || printf "%%s\\n" "$rc" > %q\n' "$SESSION_EXIT" "$SESSION_EXIT"
    } > "$runner"
    chmod 700 "$runner"
    tmux new-session -d -s "$SESSION_NAME" -x 220 -y 50 "bash $(printf '%q' "$runner")"
    say "Started tmux session '$SESSION_NAME' — it survives SSH disconnects."
  fi
  say "┌────────────────────────────────────────────────────────────────┐"
  say "│ تماشای زندهٔ نصب از PuTTY (هم‌زمان):                            │"
  say "│   tmux attach -r -t pishkan-deploy   ← فقط تماشا (امن)          │"
  say "│   tmux attach -t pishkan-deploy      ← تماشا + تعامل            │"
  say "│ خروج از تماشا بدون توقف نصب:  Ctrl-b سپس d                     │"
  say "└────────────────────────────────────────────────────────────────┘"
  follow_session
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
    # Long-running actions: run inside tmux so a dropped SSH link cannot kill them.
    install|update|provision-tls|backup)
      run_long_action "$action" "$domain" "$email" "$force" "$ref" "$branch" ;;
    # Short / read-only actions: run directly.
    *)
      dispatch_action "$action" "$domain" "$email" "$force" "$ref" "$branch" ;;
  esac
}

# Allow sourcing for unit tests without executing main.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
