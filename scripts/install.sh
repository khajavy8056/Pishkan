#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pishkan — Ubuntu Server one-command installer
#
#   Use the immutable PISHKAN_COMMIT examples in README.md or docs/INSTALL.md; do not pipe from a floating branch.
#
# or from a checkout:
#
#   sudo bash scripts/install.sh
#
# The installer is idempotent: running it again on an existing installation
# only fills in what is missing and never drops the database, uploads or
# administrator accounts. Use the `pishkan` CLI for updates and restores.
# ---------------------------------------------------------------------------

set -Eeuo pipefail

INSTALL_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -f "${INSTALL_SCRIPT_DIR}/lib/common.sh" ]; then
  # shellcheck source=lib/common.sh
  . "${INSTALL_SCRIPT_DIR}/lib/common.sh"
  # shellcheck source=lib/config.sh
  . "${INSTALL_SCRIPT_DIR}/lib/config.sh"
  # shellcheck source=lib/net.sh
  . "${INSTALL_SCRIPT_DIR}/lib/net.sh"
else
  # Piped execution: fetch the helpers next to this script. The library is
  # pinned to the same commit as the code, so a half-updated helper set is
  # impossible.
  TMP_LIB="$(mktemp -d)"
  trap 'rm -rf "$TMP_LIB"' EXIT
  COMMONS_REF="${PISHKAN_COMMIT:-main}"
  for helper in common.sh config.sh net.sh; do
    curl -fsSL "https://raw.githubusercontent.com/khajavy8056/Pishkan/${COMMONS_REF}/scripts/lib/${helper}" -o "${TMP_LIB}/${helper}" \
      || { echo "دریافت فایل‌های نصب (${helper}) ناموفق بود. اتصال شبکه و مرجع نسخه را بررسی کنید." >&2; exit 1; }
  done
  # shellcheck source=lib/common.sh
  . "${TMP_LIB}/common.sh"
  # shellcheck source=lib/config.sh
  . "${TMP_LIB}/config.sh"
  # shellcheck source=lib/net.sh
  . "${TMP_LIB}/net.sh"
fi

NODE_MAJOR="${NODE_MAJOR:-22}"

on_error() {
  local exit_code=$?
  err "نصب در خط $1 با کد $exit_code متوقف شد."
  err "هیچ داده‌ای حذف نشده است. برای بررسی، فایل /var/log/pishkan/install.log را ببینید."
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

require_root
mkdir -p "$LOG_DIR"
exec > >(tee -a "${LOG_DIR}/install.log") 2>&1

# ---------------------------------------------------------------------------
# 0. Pre-flight checks — abort with an actionable message, never half-install
# ---------------------------------------------------------------------------
heading "پیش‌بررسی سرور"

[ -f /etc/os-release ] || die "این سیستم‌عامل پشتیبانی نمی‌شود. Ubuntu Server 22.04 یا 24.04 LTS لازم است."
# shellcheck disable=SC1091
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ]; then
  die "این نسخه نصب‌کننده فقط برای Ubuntu Server نوشته شده است (سیستم فعلی: ${PRETTY_NAME:-نامشخص})."
fi
case "${VERSION_ID:-}" in
  22.04|24.04) ok "سیستم‌عامل: ${PRETTY_NAME}" ;;
  *) die "نسخه Ubuntu باید 22.04 یا 24.04 LTS باشد (نسخه فعلی: ${VERSION_ID:-نامشخص})." ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64) ok "معماری: $ARCH" ;;
  *) die "معماری $ARCH پشتیبانی نمی‌شود. سرور x86_64 یا aarch64 لازم است." ;;
esac

RAM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
[ "$RAM_MB" -ge 900 ] || die "حافظه سرور کافی نیست (${RAM_MB}MB). حداقل 1GB RAM لازم است."
ok "حافظه: ${RAM_MB}MB"

AVAILABLE_KB="$(df -Pk /var 2>/dev/null | awk 'NR==2 {print $4}')"
[ -n "$AVAILABLE_KB" ] || die "خواندن فضای دیسک ممکن نشد."
if [ "$AVAILABLE_KB" -lt 4000000 ]; then
  die "فضای دیسک کافی نیست ($((AVAILABLE_KB / 1024))MB آزاد). حداقل 4GB لازم است."
fi
ok "فضای دیسک: $((AVAILABLE_KB / 1024))MB آزاد"

if [ -f /etc/pishkan/pishkan.env ] && is_installed; then
  warn "یک نصب قبلی پیدا شد. نصب‌کننده فقط موارد ناقص را تکمیل می‌کند و داده‌ها را تغییر نمی‌دهد."
  EXISTING_INSTALL=1
else
  EXISTING_INSTALL=0
fi

# ---------------------------------------------------------------------------
# 0b. Deployment configuration — read and validate BEFORE touching the system.
#
# Everything the install writes later (nginx server_name, certificates, CORS,
# cookie flags, the public URL) is derived from deploy.conf. Validating first
# means a typo in the domain aborts on an untouched server instead of halfway
# through, with nginx already pointed at a hostname that does not exist.
# ---------------------------------------------------------------------------
heading "خواندن تنظیمات استقرار"

CONFIG_FILE_SOURCE=""
if [ -n "${PISHKAN_DEPLOY_CONF:-}" ] && [ -f "${PISHKAN_DEPLOY_CONF}" ]; then
  CONFIG_FILE_SOURCE="$PISHKAN_DEPLOY_CONF"
elif [ -f "${INSTALL_SCRIPT_DIR}/../deploy/deploy.conf" ]; then
  # Running from a checkout: the repo copy is the template.
  CONFIG_FILE_SOURCE="$(cd "${INSTALL_SCRIPT_DIR}/.." && pwd)/deploy/deploy.conf"
elif [ -f "${CONFIG_DIR}/deploy.conf" ]; then
  CONFIG_FILE_SOURCE="${CONFIG_DIR}/deploy.conf"
fi

# No config anywhere: this is a piped install on a fresh server. The whole point
# of the one-command install is that nobody has to clone the repo first, so fetch
# the template ourselves and fill in the two values that cannot be guessed.
if [ -z "$CONFIG_FILE_SOURCE" ]; then
  install -d -m 0750 "$CONFIG_DIR"
  TEMPLATE_URL="https://raw.githubusercontent.com/khajavy8056/Pishkan/${PISHKAN_COMMIT:-main}/deploy/deploy.conf"
  if curl -fsSL "$TEMPLATE_URL" -o "${CONFIG_DIR}/deploy.conf"; then
    chmod 0640 "${CONFIG_DIR}/deploy.conf"
    ok "قالب تنظیمات از مخزن دریافت شد: ${CONFIG_DIR}/deploy.conf"
    CONFIG_FILE_SOURCE="${CONFIG_DIR}/deploy.conf"
  fi
fi

if [ -z "$CONFIG_FILE_SOURCE" ]; then
  err "فایل تنظیمات استقرار پیدا نشد و دریافت قالب از مخزن هم ناموفق بود."
  err "  اتصال شبکه را بررسی کنید، یا فایل را دستی بسازید:"
  err "    sudo mkdir -p ${CONFIG_DIR}"
  err "    sudo nano ${CONFIG_DIR}/deploy.conf   # از deploy/deploy.conf مخزن کپی کنید"
  exit 1
fi

# Ask for the domain only when it was not supplied on the command line and the
# file still holds the example value. Everything else has a safe default.
config_load "$CONFIG_FILE_SOURCE"
CURRENT_DOMAIN="$(config_get DOMAIN)"

needs_domain() {
  case "${1:-}" in
    ''|*example.com*|*example.ir*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -n "${DOMAIN:-}" ]; then
  config_set DOMAIN "$DOMAIN"
  config_write "$CONFIG_FILE_SOURCE" DOMAIN "$DOMAIN"
elif needs_domain "$CURRENT_DOMAIN"; then
  if [ -t 0 ]; then
    printf '\n'
    printf 'دامنه‌ای که این سامانه روی آن اجرا می‌شود را وارد کنید\n'
    printf '(مثلاً pishkan.example.ir — بدون https:// و بدون مسیر): '
    read -r REPLY_DOMAIN || REPLY_DOMAIN=""
    if [ -n "$REPLY_DOMAIN" ]; then
      config_set DOMAIN "$REPLY_DOMAIN"
      config_write "$CONFIG_FILE_SOURCE" DOMAIN "$REPLY_DOMAIN"
      ok "دامنه ذخیره شد: ${REPLY_DOMAIN}"
    fi
  else
    warn "دامنه تنظیم نشده و ورودی تعاملی در دسترس نیست."
    warn "  نسخه در حالت IP-only نصب می‌شود؛ بعداً dامنه را در deploy.conf بنویسید و provision بزنید."
  fi
fi

config_load "$CONFIG_FILE_SOURCE"

# Same for the ACME address, but only when TLS will actually be requested.
if [ -z "${EMAIL:-}" ] && [ "$(config_get TLS_MODE auto)" = "auto" ] \
   && needs_domain "$(config_get ACME_EMAIL)" ; then
  if [ -t 0 ]; then
    printf 'ایمیل برای گواهی HTTPS (Let'\''s Encrypt — برای هشدار انقضا): '
    read -r REPLY_EMAIL || REPLY_EMAIL=""
    if [ -n "$REPLY_EMAIL" ]; then
      config_set ACME_EMAIL "$REPLY_EMAIL"
      config_write "$CONFIG_FILE_SOURCE" ACME_EMAIL "$REPLY_EMAIL"
    fi
  fi
fi
[ -n "${EMAIL:-}" ] && config_set ACME_EMAIL "$EMAIL"

config_load "$CONFIG_FILE_SOURCE"

ok "تنظیمات خوانده شد: ${CONFIG_FILE_SOURCE}"

if ! config_validate; then
  config_report
  err ""
  err "نصب متوقف شد و هیچ تغییری روی سیستم اعمال نشد. ${CONFIG_FILE_SOURCE} را اصلاح کنید."
  exit 1
fi
config_report

CONFIG_DOMAIN="$(config_get DOMAIN)"
CONFIG_EMAIL="$(config_get ACME_EMAIL)"
CONFIG_TLS_MODE="$(config_get TLS_MODE auto)"
CONFIG_APP_URL="$(config_app_url)"
CONFIG_TLS_HOSTS="$(config_tls_hosts)"
CONFIG_CORS="$(config_cors_origins)"
CONFIG_BLOG_SUB="$(config_blog_subdomain || true)"
CONFIG_TIMEZONE="$(config_get TIMEZONE Asia/Tehran)"

ok "دامنه: ${CONFIG_DOMAIN}"
[ -n "$CONFIG_BLOG_SUB" ] && ok "زیردامنهٔ وبلاگ: ${CONFIG_BLOG_SUB}"
[ -n "$CONFIG_TLS_HOSTS" ] && ok "نام‌هایی که گواهی پوشش می‌دهد: ${CONFIG_TLS_HOSTS}"
ok "نشانی عمومی: ${CONFIG_APP_URL}"
ok "HTTPS: ${CONFIG_TLS_MODE}"

# Persist the file for later runs (update, provision, rollback all re-read it).
if [ "$CONFIG_FILE_SOURCE" != "${CONFIG_DIR}/deploy.conf" ]; then
  install -d -m 0750 "$CONFIG_DIR"
  install -m 0640 "$CONFIG_FILE_SOURCE" "${CONFIG_DIR}/deploy.conf"
  ok "نسخه‌ای از تنظیمات در ${CONFIG_DIR}/deploy.conf ذخیره شد."
fi

# DNS pre-flight: report, never block. A fresh server whose DNS has not
# propagated yet must still install; TLS is retried later by `pishkan provision`.
heading "بررسی DNS"
for host in $(config_main_hosts); do
  dns_explain "$host" "$(dns_classify "$host")"
done
if [ -n "$CONFIG_BLOG_SUB" ]; then
  dns_explain "$CONFIG_BLOG_SUB" "$(dns_classify "$CONFIG_BLOG_SUB")"
fi

export DEBIAN_FRONTEND=noninteractive

heading "نصب پیش‌نیازهای سیستم"
apt-get update -qq
apt-get install -y -qq \
  curl ca-certificates gnupg lsb-release git rsync build-essential \
  postgresql postgresql-contrib nginx certbot python3-certbot-nginx ufw jq >/dev/null
ok "بسته‌های پایه نصب شدند."

node_version_supported() {
  command -v node >/dev/null 2>&1 && node -e 'const [major,minor,patch]=process.versions.node.split(".").map(Number); process.exit(major>22 || (major===22 && (minor>22 || (minor===22 && patch>=2))) ? 0 : 1)' >/dev/null 2>&1
}
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt "$NODE_MAJOR" ] || ! node_version_supported; then
  heading "نصب Node.js ${NODE_MAJOR} (حداقل 22.22.2)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_VERSION="$(node -v)"
node_version_supported || die "Node.js ${NODE_VERSION} نصب شد اما حداقل نسخهٔ پشتیبانی‌شده v22.22.2 است."
ok "Node.js ${NODE_VERSION}"
if ! node --experimental-sqlite -e 'require("node:sqlite")' >/dev/null 2>&1; then
  warn "ماژول node:sqlite در دسترس نیست؛ در محیط عملیاتی از PostgreSQL استفاده می‌شود."
fi

# ---------------------------------------------------------------------------
# 1. System user and directories. Data directories are never recreated.
# ---------------------------------------------------------------------------
heading "ساخت کاربر و مسیرهای سامانه"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
  ok "کاربر سیستمی ${APP_USER} ساخته شد."
else
  ok "کاربر سیستمی ${APP_USER} از قبل وجود دارد."
fi

install -d -o "$APP_USER" -g "$APP_GROUP" "$APP_ROOT" "$RELEASES_DIR" "$STATE_DIR" "$LOG_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$UPLOAD_DIR"
install -d -o root -g "$APP_GROUP" -m 0750 "$BACKUP_DIR" "$CONFIG_DIR"
ok "مسیرها آماده هستند."

# ---------------------------------------------------------------------------
# 2. Database. CREATE ... IF NOT EXISTS semantics; existing data is kept.
# ---------------------------------------------------------------------------
heading "پایگاه داده PostgreSQL"
systemctl enable --now postgresql >/dev/null 2>&1 || true
DB_PASSWORD="$(read_env_value DB_PASSWORD)"
if [ -z "$DB_PASSWORD" ]; then
  DB_PASSWORD="$(random_password)"
fi

if [ "$(psql_admin "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" != "1" ]; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c \
    "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';" >/dev/null
  ok "نقش پایگاه داده ${DB_USER} ساخته شد."
else
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c \
    "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" >/dev/null
  ok "رمز نقش ${DB_USER} همگام شد."
fi

if [ "$(psql_admin "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")" != "1" ]; then
  runuser -u postgres -- createdb -O "$DB_USER" "$DB_NAME"
  ok "پایگاه داده ${DB_NAME} ساخته شد."
else
  ok "پایگاه داده ${DB_NAME} از قبل وجود دارد (داده‌ها حفظ شدند)."
fi
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" >/dev/null

# ---------------------------------------------------------------------------
# 3. Application release
# ---------------------------------------------------------------------------
heading "دریافت کد سامانه"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"

RELEASE_COMMIT=""
if [ "$EXISTING_INSTALL" = "1" ] && [ "${FORCE_REINSTALL:-0}" != "1" ]; then
  log "نصب موجود است؛ نسخه فعلی حفظ می‌شود. برای استقرار نسخه جدید از «pishkan update --ref SHA» استفاده کنید."
  RELEASE_DIR="$(current_release)"
  RELEASE_COMMIT="$(cat "${RELEASE_DIR}/.release-commit" 2>/dev/null || true)"
  if ! is_full_commit "$RELEASE_COMMIT"; then RELEASE_COMMIT="$(git -C "$RELEASE_DIR" rev-parse HEAD 2>/dev/null || true)"; fi
else
  if [ -n "${SOURCE_DIR:-}" ] && [ -d "${SOURCE_DIR}/apps/api" ]; then
    SOURCE_COMMIT="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || true)"
    is_full_commit "$SOURCE_COMMIT" || die 'SOURCE_DIR باید clone گیت با commit مشخص باشد؛ از کپی بدون تاریخچه برای نصب تولید استفاده نکنید.'
    if [ -n "$PISHKAN_COMMIT" ] && [ "${SOURCE_COMMIT,,}" != "${PISHKAN_COMMIT,,}" ]; then
      die 'commit مسیر SOURCE_DIR با PISHKAN_COMMIT مورد تأیید مطابقت ندارد.'
    fi
    rsync -a --exclude node_modules --exclude .git --exclude .data "${SOURCE_DIR}/" "$RELEASE_DIR/"
    RELEASE_COMMIT="$SOURCE_COMMIT"
    ok "کد از ${SOURCE_DIR} با commit ${RELEASE_COMMIT} کپی شد."
  else
    is_full_commit "$PISHKAN_COMMIT" || die 'نصب تولیدی به PISHKAN_COMMIT کامل ۴۰ رقمی نیاز دارد؛ دریافت شناور شاخه main مجاز نیست.'
    RELEASE_COMMIT="$(clone_verified_commit "$PISHKAN_COMMIT" "$RELEASE_DIR")"
    ok "کد تأییدشده با commit ${RELEASE_COMMIT} دریافت شد."
  fi
  printf '%s\n' "$RELEASE_COMMIT" >"${RELEASE_DIR}/.release-commit"
fi

# ---------------------------------------------------------------------------
# 4. Environment file with generated secrets (only created once)
# ---------------------------------------------------------------------------
heading "تنظیمات محیطی"
if [ -f "$ENV_FILE" ]; then
  ok "فایل تنظیمات موجود است؛ فقط شناسه commit نسخهٔ فعال در صورت نیاز تکمیل می‌شود: ${ENV_FILE}"
else
  APP_ENCRYPTION_KEY="$(random_hex 32)"
  # Derived from deploy.conf — the single source of truth for the domain.
  APP_URL_VALUE="${CONFIG_APP_URL}"
  APP_VERSION_VALUE="$(node -p "require('${RELEASE_DIR}/apps/api/package.json').version" 2>/dev/null || echo 0.0.0)"

  cat >"$ENV_FILE" <<EOF
# Pishkan production configuration — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Secrets in this file grant full access. Keep permissions at 0640 (root:${APP_GROUP}).
NODE_ENV=production
PORT=3000
HOST=127.0.0.1

DB_DRIVER=postgres
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}
DB_PASSWORD=${DB_PASSWORD}

APP_URL=${APP_URL_VALUE}
API_URL=${APP_URL_VALUE}
# Every origin the app is served from: the main domain plus any sub-domain.
# A mismatch here shows up as a CORS error on the first API call.
CORS_ORIGINS=${CONFIG_CORS}
TRUST_PROXY=$(config_get TRUST_PROXY true)
# HTTPS-only cookies behind TLS. Off only for a plain-HTTP smoke test, where
# the browser would otherwise drop the session cookie on login.
COOKIE_SECURE=$([ "$CONFIG_TLS_MODE" = "off" ] && echo false || echo true)
SESSION_COOKIE=pishkan_session
SESSION_TTL_HOURS=168

APP_ENCRYPTION_KEY=${APP_ENCRYPTION_KEY}

UPLOAD_DIR=${UPLOAD_DIR}
BACKUP_DIR=${BACKUP_DIR}

BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=
BOOTSTRAP_ADMIN_NAME=مدیر سامانه

LOG_LEVEL=info
LOG_FILE=${LOG_DIR}/api.log
DEMO_MODE=false
APP_VERSION=${APP_VERSION_VALUE}
TZ=${CONFIG_TIMEZONE}
PISHKAN_RELEASE_REF=${RELEASE_COMMIT}
EOF
  chown "root:${APP_GROUP}" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  ok "فایل تنظیمات ساخته شد: ${ENV_FILE}"
fi
if is_full_commit "$RELEASE_COMMIT" && [ -n "$ENV_FILE" ] && [ -z "$(read_env_value PISHKAN_RELEASE_REF)" ]; then
  set_env_value PISHKAN_RELEASE_REF "$RELEASE_COMMIT"
fi

# ---------------------------------------------------------------------------
# 5. Build
# ---------------------------------------------------------------------------
if [ "${RELEASE_DIR}" = "$(current_release)" ]; then
  ok "نسخه فعلی آماده است؛ مرحله ساخت رد شد."
else
  heading "ساخت سامانه (این مرحله ممکن است چند دقیقه طول بکشد)"
  chown -R "$APP_USER:$APP_GROUP" "$RELEASE_DIR"
  run_as_app "$RELEASE_DIR" npm ci --no-audit --no-fund
  run_as_app "$RELEASE_DIR" npm run build --workspace apps/api
  run_as_app "$RELEASE_DIR" npm run build --workspace apps/web
  ok "بسته تولیدی ساخته شد."
fi

# ---------------------------------------------------------------------------
# 6. Migrations + bootstrap admin
# ---------------------------------------------------------------------------
heading "اجرای مهاجرت‌های پایگاه داده"
# Migrations are versioned and additive; they never drop customer data.
run_cli_script "$RELEASE_DIR" migrate
ok "مهاجرت‌ها اعمال شدند."

BOOTSTRAP_PASSWORD="$(read_env_value BOOTSTRAP_ADMIN_PASSWORD)"
GENERATED_PASSWORD=""
ADMIN_EXISTS="$(runuser -u postgres -- psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name='users'" -d "$DB_NAME" | tr -d ' ')"
if [ "$ADMIN_EXISTS" = "1" ]; then
  ADMIN_COUNT="$(runuser -u postgres -- psql -tAc "SELECT count(*) FROM users WHERE kind='admin'" -d "$DB_NAME" | tr -d ' ')"
else
  ADMIN_COUNT="0"
fi

if [ "${ADMIN_COUNT:-0}" = "0" ]; then
  if [ -z "$BOOTSTRAP_PASSWORD" ]; then
    BOOTSTRAP_PASSWORD="$(random_password)"
    GENERATED_PASSWORD="$BOOTSTRAP_PASSWORD"
    set_env_value BOOTSTRAP_ADMIN_PASSWORD "$BOOTSTRAP_PASSWORD"
  fi
  run_cli_script "$RELEASE_DIR" create-admin
  ok "حساب مدیر کل ساخته شد."
else
  ok "حساب مدیر کل از قبل وجود دارد (تغییر نکرد)."
fi

# Seed only fills an empty catalogue; it never overwrites admin edits.
if [ "${ADMIN_COUNT:-0}" = "0" ] || [ "${SEED_CATALOG:-0}" = "1" ]; then
  run_cli_script "$RELEASE_DIR" seed --catalog-only \
    || warn "بارگذاری کاتالوگ نمونه انجام نشد؛ می‌توانید بعداً seed را اجرا کنید."
fi

# ---------------------------------------------------------------------------
# 7. Release switch (atomic symlink) + service
# ---------------------------------------------------------------------------
if [ "${RELEASE_DIR}" != "$(current_release)" ]; then
  PREVIOUS_TARGET="$(current_release)"
  if [ -n "$PREVIOUS_TARGET" ]; then
    ln -sfn "$PREVIOUS_TARGET" "${APP_ROOT}/previous"
  fi
  ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
  ok "نسخه فعال: $RELEASE_DIR"
fi

heading "سرویس systemd"
install -m 0644 "${CURRENT_LINK}/deploy/systemd/pishkan-api.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"

if wait_for_health 90; then
  ok "سرویس API پاسخ سالم داد."
else
  err "سرویس API در زمان مورد انتظار پاسخ نداد."
  err "برای بررسی: journalctl -u ${SERVICE_NAME} -n 100 --no-pager"
  exit 1
fi

# ---------------------------------------------------------------------------
# 8. Nginx — every hostname derived from deploy.conf
#
# The same template is rendered twice: once for HTTP (which must keep serving
# ACME challenges and the app while a certificate is missing) and once for
# HTTPS. Sharing the routing rules is what stops the blog sub-domain and the
# main site from drifting apart.
# ---------------------------------------------------------------------------
heading "تنظیم Nginx"

ACME_ROOT="/var/www/letsencrypt"
install -d -m 0755 "${ACME_ROOT}/.well-known/acme-challenge"
install -d -m 0755 /etc/nginx/snippets
install -m 0644 "${CURRENT_LINK}/deploy/nginx/snippets/pishkan-proxy.conf" /etc/nginx/snippets/pishkan-proxy.conf

BLOG_HOST="$(config_blog_subdomain || true)"
BLOG_REDIRECT_BLOCK="$(nginx_fragment_blog_redirect "$BLOG_HOST")"

MAIN_HOSTS="$(config_main_hosts)"
NGINX_SERVER_NAME="${MAIN_HOSTS:-_}"
if [ -n "$BLOG_HOST" ]; then
  # One server block answers for both hosts; `/blog*` redirects, everything
  # else is the app. This keeps a single vhost and a single certificate.
  NGINX_SERVER_NAME="${MAIN_HOSTS} ${BLOG_HOST}"
fi

# The renderer lives in lib/config.sh so the installer and `pishkan provision`
# cannot drift. Everything below only decides *what* to render, never how.
render_site() {
  local listen="$1" ssl="$2" redirect="$3" out="$4"
  render_nginx_template \
    "${CURRENT_LINK}/deploy/nginx/pishkan.conf" "$out" \
    "$listen" "$ssl" "$redirect" "$BLOG_REDIRECT_BLOCK" \
    "$NGINX_SERVER_NAME" "$(api_port)" \
    "${CURRENT_LINK}/apps/web/dist" "$ACME_ROOT"
}

render_site "$(nginx_fragment_listen_http)" "" "" "/etc/nginx/sites-available/${APP_NAME}.conf"
ln -sfn "/etc/nginx/sites-available/${APP_NAME}.conf" "/etc/nginx/sites-enabled/${APP_NAME}.conf"
rm -f /etc/nginx/sites-enabled/default

if ! nginx -t >/dev/null 2>&1; then
  err "پیکربندی Nginx معتبر نیست. نصب متوقف شد؛ سرویس فعلی دست‌نخورده ماند."
  err "برای دیدن خطا: nginx -t"
  exit 1
fi
systemctl reload nginx
ok "Nginx پیکربندی و بارگذاری شد (${NGINX_SERVER_NAME})."

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  ok "پورت‌های HTTP/HTTPS در فایروال باز هستند."
fi

# ---------------------------------------------------------------------------
# 9. TLS — one certificate covering every hostname
# ---------------------------------------------------------------------------
heading "گواهی HTTPS"

if [ "$CONFIG_TLS_MODE" = "off" ]; then
  warn "TLS_MODE=off است؛ سامانه روی HTTP اجرا می‌شود."
  warn "برای فعال‌سازی بعداً: sudo pishkan provision --tls"
else
  CERT_HOSTS="$(config_tls_hosts)"
  CERT_PRIMARY="$(config_get DOMAIN)"
  CERT_ARGS=()
  for host in $CERT_HOSTS; do CERT_ARGS+=(-d "$host"); done

  log "درخواست گواهی برای: ${CERT_HOSTS}"
  # --cert-name keeps one renewable lineage. Without it, adding an alias later
  # creates a second certificate that shadows the first, and renewals start
  # failing silently.
  if certbot certonly --nginx --cert-name "$CERT_PRIMARY" \
       "${CERT_ARGS[@]}" \
       --non-interactive --agree-tos --email "$CONFIG_EMAIL" \
       --keep-until-expiring --expand >/dev/null 2>&1; then
    ok "گواهی Let's Encrypt صادر شد: ${CERT_HOSTS}"

    render_site "$(nginx_fragment_listen_tls)" \
      "$(nginx_fragment_ssl "$CERT_PRIMARY")" "" \
      "/etc/nginx/sites-available/${APP_NAME}-tls.conf"

    # The :80 vhost keeps serving ACME while redirecting everything else. Using
    # our own redirect instead of `certbot --redirect` matters: certbot rewrites
    # the vhost, and our template would overwrite that rewrite on the next
    # update, silently breaking renewals.
    render_site "$(nginx_fragment_listen_http)" "" \
      "$(nginx_fragment_http_redirect)" \
      "/etc/nginx/sites-available/${APP_NAME}.conf"

    ln -sfn "/etc/nginx/sites-available/${APP_NAME}-tls.conf" "/etc/nginx/sites-enabled/${APP_NAME}-tls.conf"

    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx
      ok "HTTPS فعال شد؛ HTTP به HTTPS هدایت می‌شود."
    else
      err "بلوک HTTPS خطا دارد؛ به HTTP برمی‌گردیم تا سایت در دسترس بماند."
      rm -f "/etc/nginx/sites-enabled/${APP_NAME}-tls.conf"
      render_site "$(nginx_fragment_listen_http)" "" "" "/etc/nginx/sites-available/${APP_NAME}.conf"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx
    fi
  else
    warn "دریافت گواهی ناموفق بود."
    warn "  رایج‌ترین علت‌ها: DNS هنوز منتشر نشده، پورت ۸۰ بسته است، یا Cloudflare روی Flexible است."
    warn "  سایت روی HTTP کار می‌کند. پس از اصلاح DNS:"
    warn "    sudo pishkan provision --tls"
  fi
fi

systemctl enable --now certbot.timer >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 10. Timer for scheduled backups
# ---------------------------------------------------------------------------
heading "تنظیم منطقه زمانی"
if [ -n "$CONFIG_TIMEZONE" ] && timedatectl set-timezone "$CONFIG_TIMEZONE" >/dev/null 2>&1; then
  ok "منطقه زمانی: ${CONFIG_TIMEZONE}"
else
  warn "تنظیم منطقه زمانی ${CONFIG_TIMEZONE} ممکن نشد؛ ساعت سرور UTC می‌ماند."
fi

heading "پشتیبان‌گیری زمان‌بندی‌شده"
install -m 0755 "${CURRENT_LINK}/scripts/pishkan" /usr/local/bin/pishkan
cat >/etc/systemd/system/pishkan-backup.service <<EOF
[Unit]
Description=Pishkan daily backup
After=network.target postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pishkan backup --quiet
EOF
cat >/etc/systemd/system/pishkan-backup.timer <<'EOF'
[Unit]
Description=Run the Pishkan backup every night

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
if [ "$(config_get BACKUP_ENABLED true)" = "true" ]; then
  systemctl enable --now pishkan-backup.timer >/dev/null 2>&1 || true
  ok "پشتیبان‌گیری روزانه ساعت ۰۲:۳۰ (${CONFIG_TIMEZONE}) فعال شد."
else
  warn "BACKUP_ENABLED=false است؛ پشتیبان‌گیری خودکار نصب نشد."
  warn "  فعال‌سازی: sudo systemctl enable --now pishkan-backup.timer"
fi

# ---------------------------------------------------------------------------
# 11. Verification — what a user actually cares about
#
# The API health check above ran against 127.0.0.1:3000. Everything that can
# still be wrong at this point involves the path a real browser takes: DNS,
# nginx, TLS, and whether the SPA loads at all. Checking it here means the
# install either confirms itself or names the broken hop, instead of handing
# over a server that only looks finished.
# ---------------------------------------------------------------------------
heading "بررسی نهایی"

VERIFY_PROBLEMS=0
if [ -n "$CONFIG_DOMAIN" ]; then
  verify_url "${CONFIG_APP_URL}/" 'id="root"' 'صفحهٔ اصلی از طریق دامنه بارگذاری می‌شود' \
    || VERIFY_PROBLEMS=$((VERIFY_PROBLEMS + 1))

  verify_api_health "${CONFIG_APP_URL}/api/health" 'API از طریق دامنه سالم است' \
    || VERIFY_PROBLEMS=$((VERIFY_PROBLEMS + 1))

  verify_acme_reachable "$CONFIG_DOMAIN" || VERIFY_PROBLEMS=$((VERIFY_PROBLEMS + 1))

  if [ "$CONFIG_TLS_MODE" != "off" ] && [ -f "/etc/letsencrypt/live/${CONFIG_DOMAIN}/fullchain.pem" ]; then
    verify_certificate "$CONFIG_DOMAIN" || VERIFY_PROBLEMS=$((VERIFY_PROBLEMS + 1))
  else
    warn "گواهی TLS نصب نشده؛ بررسی HTTPS انجام نشد. بعد از اصلاح DNS: sudo pishkan provision --tls"
  fi
else
  SERVER_IP="$(server_public_ip)"
  if [ -n "$SERVER_IP" ]; then
    verify_url "http://${SERVER_IP}/" 'id="root"' 'صفحهٔ اصلی روی IP بارگذاری می‌شود' \
      || VERIFY_PROBLEMS=$((VERIFY_PROBLEMS + 1))
    verify_api_health "http://${SERVER_IP}/api/health" 'API روی IP سالم است' \
      || VERIFY_PROBLEMS=$((VERIFY_PROBLEMS + 1))
  fi
  warn "دامنه تنظیم نشده؛ سامانه روی IP نصب شد. برای HTTPS: دامنه را در ${CONFIG_DIR}/deploy.conf بنویسید و sudo pishkan provision --tls بزنید."
fi

if [ "$VERIFY_PROBLEMS" -gt 0 ]; then
  warn "${VERIFY_PROBLEMS} مورد در بررسی نهایی ناموفق بود."
  warn "  رایج‌ترین علت‌ها: DNS هنوز منتشر نشده (تا چند ساعت)، پورت ۸۰ بسته، یا Cloudflare روی Flexible."
  warn "  بعد از اصلاح: sudo pishkan doctor"
else
  ok "همهٔ بررسی‌های نهایی موفق بودند."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
PUBLIC_URL="$(read_env_value APP_URL)"
[ -n "$PUBLIC_URL" ] || PUBLIC_URL="http://$(hostname -I | awk '{print $1}')"
VERSION="$(read_env_value APP_VERSION)"

heading "نصب با موفقیت پایان یافت"
cat <<EOF

  نسخه:            ${VERSION}
  نشانی سامانه:    ${PUBLIC_URL}
  ورود مشترک:      ${PUBLIC_URL}/login
  ورود به پنل نقش: ${PUBLIC_URL}/panel
  سرویس:           systemctl status ${SERVICE_NAME}
  تنظیمات:         ${ENV_FILE}

  دستورهای مدیریت سامانه:
    pishkan status          وضعیت سرویس و سلامت
    pishkan logs -f         مشاهده زنده لاگ‌ها
    pishkan update          به‌روزرسانی امن با امکان بازگشت
    pishkan backup          پشتیبان‌گیری دستی
    pishkan restore FILE    بازیابی نسخه پشتیبان
    pishkan health          بررسی سلامت API

EOF

if [ -n "$GENERATED_PASSWORD" ]; then
  cat <<EOF
  ⚠ رمز عبور اولیه مدیر کل (فقط یک بار نمایش داده می‌شود):
      نام کاربری: admin
      رمز عبور:   ${GENERATED_PASSWORD}

  این رمز را همین حالا در جای امن ذخیره کنید و پس از اولین ورود آن را تغییر دهید.
  برای بازیابی از پنل، از مسیر «تنظیمات → امنیت» یا دستور pishkan reset-admin استفاده کنید.

EOF
fi

warn "اگر دامنه یا Cloudflare را خارج از این نصب تنظیم می‌کنید، راهنمای docs/DOMAIN-CLOUDFLARE.md را بخوانید."
warn "ارسال پیامک تا زمانی که اعتبارنامه ملی پیامک را در تنظیمات وارد نکنید غیرفعال است."
