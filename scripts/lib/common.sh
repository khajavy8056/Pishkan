#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Shared helpers for the Pishkan installer and lifecycle CLI.
# Sourced by scripts/install.sh and scripts/pishkan — it is not executed
# directly.
# ---------------------------------------------------------------------------

set -o pipefail

REPO_OWNER="${REPO_OWNER:-khajavy8056}"
REPO_NAME="${REPO_NAME:-Pishkan}"
REPO_URL="${REPO_URL:-https://github.com/${REPO_OWNER}/${REPO_NAME}.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
PISHKAN_COMMIT="${PISHKAN_COMMIT:-}"

APP_USER="${APP_USER:-pishkan}"
APP_GROUP="${APP_GROUP:-pishkan}"
APP_ROOT="${APP_ROOT:-/opt/pishkan}"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"

CONFIG_DIR="${CONFIG_DIR:-/etc/pishkan}"
ENV_FILE="${ENV_FILE:-${CONFIG_DIR}/pishkan.env}"
STATE_DIR="${STATE_DIR:-/var/lib/pishkan}"
UPLOAD_DIR="${UPLOAD_DIR:-${STATE_DIR}/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pishkan}"
LOG_DIR="${LOG_DIR:-/var/log/pishkan}"

SERVICE_NAME="${SERVICE_NAME:-pishkan-api}"
DB_NAME="${DB_NAME:-pishkan}"
DB_USER="${DB_USER:-pishkan}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

C_RESET='\033[0m'
C_BOLD='\033[1m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_BLUE='\033[0;34m'

log()   { printf '%b\n' "${C_BLUE}•${C_RESET} $*"; }
ok()    { printf '%b\n' "${C_GREEN}✔${C_RESET} $*"; }
warn()  { printf '%b\n' "${C_YELLOW}!${C_RESET} $*" >&2; }
err()   { printf '%b\n' "${C_RED}✖${C_RESET} $*" >&2; }

die() {
  err "$*"
  exit 1
}

heading() {
  printf '\n%b\n' "${C_BOLD}$*${C_RESET}"
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "این دستور باید با دسترسی root اجرا شود: sudo bash $0"
}

require_commands() {
  local missing=()
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    die "این ابزارها نصب نیستند: ${missing[*]}"
  fi
}

is_full_commit() { [[ "${1:-}" =~ ^[0-9a-fA-F]{40}$ ]]; }

clone_verified_commit() {
  local commit="$1" destination="$2" actual
  is_full_commit "$commit" || die 'برای نصب نسخه تأییدشده، PISHKAN_COMMIT باید SHA کامل ۴۰ رقمی Git باشد.'
  mkdir -p "$destination"
  git -C "$destination" init -q
  git -C "$destination" remote add origin "$REPO_URL"
  git -C "$destination" fetch --quiet --depth 1 origin "$commit" \
    || { rm -rf "$destination"; die "دریافت commit ${commit} ناموفق بود؛ SHA و دسترسی مخزن را بررسی کنید."; }
  git -C "$destination" checkout --quiet --detach FETCH_HEAD \
    || { rm -rf "$destination"; die 'Checkout نسخه تأییدشده ناموفق بود.'; }
  actual="$(git -C "$destination" rev-parse HEAD)"
  [ "${actual,,}" = "${commit,,}" ] || { rm -rf "$destination"; die 'SHA دریافت‌شده با نسخه تأییدشده مطابقت ندارد.'; }
  printf '%s\n' "$actual"
}

is_installed() {
  [ -L "$CURRENT_LINK" ] && [ -f "$CURRENT_LINK/apps/api/package.json" ]
}

service_active() {
  systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null
}

api_port() {
  # PORT from the environment file, default 3000.
  local port
  port="$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'")"
  echo "${port:-3000}"
}

health_url() {
  local host port
  host="${HEALTH_HOST:-127.0.0.1}"
  port="$(api_port)"
  echo "http://${host}:${port}/api/health"
}

wait_for_health() {
  local timeout="${1:-60}"
  local url
  url="$(health_url)"
  local i=0
  while [ "$i" -lt "$timeout" ]; do
    if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

random_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Generate a password that is safe inside .env values and SQL literals.
random_password() {
  local raw
  raw="$(random_hex 18)"
  printf '%s' "${raw:0:24}"
}

read_env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

set_env_value() {
  local key="$1" value="$2"
  [ -f "$ENV_FILE" ] || return 0
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # Use a temporary file so a failed write never truncates the real config.
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

current_release() {
  readlink -f "$CURRENT_LINK" 2>/dev/null || true
}

previous_release() {
  # Most recent release directory that is not the current one.
  local current
  current="$(basename "$(current_release)")"
  # Release names are generated identifiers, never user filenames.
  # shellcheck disable=SC2011
  ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | xargs -r -n1 basename | grep -v "^${current}$" | head -1
}

db_url() {
  local password
  password="$(read_env_value DB_PASSWORD)"
  if [ -n "$password" ]; then
    printf 'postgres://%s:%s@%s:%s/%s' "$DB_USER" "$password" "$DB_HOST" "$DB_PORT" "$DB_NAME"
  else
    read_env_value DATABASE_URL
  fi
}

psql_admin() {
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "$1"
}

run_as_app() {
  ( cd "$1" && shift && runuser -u "$APP_USER" -- env HOME="$APP_ROOT" "$@" )
}

# Run a Node/tsx script inside a release with the production environment
# loaded. The environment file is sourced as root (it is 0640 root:app) and the
# resulting variables are passed to the unprivileged app user.
run_node_script() {
  local release="$1" workdir="$2"
  shift 2
  (
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    cd "${release}/${workdir}" || exit 1
    runuser -u "$APP_USER" -- env HOME="$APP_ROOT" "$@"
  )
}

# Run one of apps/api/src/cli/*.ts scripts.
#
# Prefers the compiled entry point (dist/cli/<name>.js) because production
# installs may skip devDependencies; falls back to tsx when the build is absent
# (developer checkouts). Node's built-in SQLite needs its experimental flag on
# Node 22, so it is added only when the environment selects the sqlite driver.
run_cli_script() {
  local release="$1" name="$2"
  shift 2
  local compiled="${release}/apps/api/dist/cli/${name}.js"
  local -a node_flags=()
  if grep -qE '^[[:space:]]*DB_DRIVER=["'"'"']?sqlite' "$ENV_FILE" 2>/dev/null; then
    node_flags+=(--experimental-sqlite)
  fi
  if [ -f "$compiled" ]; then
    run_node_script "$release" apps/api node "${node_flags[@]}" "$compiled" "$@"
  else
    warn "نسخه کامپایل‌شده ${name} یافت نشد؛ اجرا با tsx."
    run_node_script "$release" apps/api npx --no-install tsx "${node_flags[@]}" "src/cli/${name}.ts" "$@"
  fi
}

confirm_phrase() {
  local phrase="$1" prompt="$2" answer
  printf '%s' "$prompt"
  read -r answer || true
  [ "$answer" = "$phrase" ]
}
