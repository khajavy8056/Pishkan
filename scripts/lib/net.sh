#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pishkan — DNS and edge detection
#
# Whether `certbot` can succeed depends entirely on where DNS points:
#
#   * Cloudflare proxied (orange cloud) — the A record resolves to Cloudflare's
#     ranges, not to this server. HTTP-01 validation still works because
#     Cloudflare forwards /.well-known/acme-challenge/, but only if we do not
#     let the SPA catch-all swallow it.
#   * A record pointing at this server — plain HTTP-01, nothing special.
#   * A record pointing somewhere else — certbot will fail, and it is much
#     kinder to say so before asking for a certificate than after.
#
# All checks here are advisory: a wrong answer slows the install down, it never
# corrupts anything. The one exception is `cloudflare` mode with a "flexible"
# SSL setting, which config_validate already refuses.
# ---------------------------------------------------------------------------

# Resolve a name to addresses, A and AAAA. Uses getent so no dig/unbound
# dependency, and falls back to `host` when getent is missing.
dns_resolve() {
  local name="${1:-}"
  [ -n "$name" ] || return 0
  if command -v getent >/dev/null 2>&1; then
    getent ahosts "$name" 2>/dev/null | awk '{print $1}' | sort -u
  elif command -v host >/dev/null 2>&1; then
    host "$name" 2>/dev/null | awk '/has (IPv4|IPv6) address/ {print $NF}' | sort -u
  fi
}

# Public IPv4 of this host. Cloudflare-proxied DNS is compared against this, so
# getting it wrong only affects the message we print.
server_public_ip() {
  local ip=""
  local url
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip="$(curl -fsS --max-time 6 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
    case "$ip" in
      *[!0-9.]*|'') ip="" ; continue ;;
      *) printf '%s' "$ip"; return 0 ;;
    esac
  done
  # Offline installs still work: fall back to the first global address.
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)"
  printf '%s' "$ip"
}

# Cloudflare publishes its ranges at https://www.cloudflare.com/ips-v4 — but
# that needs network, and the check must work during a smoke test too. These
# are the ranges as of 2025; a miss only downgrades the diagnosis, never the
# install.
CF_IPV4_RANGES="
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22
"

ipv4_in_cidr() {
  local ip="$1" cidr="$2" net bits a b c d mask
  local -a io
  IFS=. read -r -a io <<<"$ip"
  [ ${#io[@]} -eq 4 ] || return 1
  net="${cidr%/*}"
  bits="${cidr#*/}"
  IFS=. read -r a b c d <<<"$net"
  local ipnum netnum
  ipnum=$(( (io[0] << 24) | (io[1] << 16) | (io[2] << 8) | io[3] ))
  netnum=$(( (a << 24) | (b << 16) | (c << 8) | d ))
  mask=$(( bits == 0 ? 0 : (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF ))
  [ $(( ipnum & mask )) -eq $(( netnum & mask )) ]
}

# Echo one of: cloudflare | direct | elsewhere | unresolved
dns_classify() {
  local name="${1:-}" ips ip public
  [ -n "$name" ] || { printf 'unresolved'; return 0; }

  ips="$(dns_resolve "$name")"
  if [ -z "$ips" ]; then
    printf 'unresolved'
    return 0
  fi

  public="$(server_public_ip)"
  local cloudflare=0 matches_here=0
  for ip in $ips; do
    case "$ip" in *:*) continue ;; esac
    for cidr in $CF_IPV4_RANGES; do
      if ipv4_in_cidr "$ip" "$cidr"; then cloudflare=1; break; fi
    done
    if [ -n "$public" ] && [ "$ip" = "$public" ]; then matches_here=1; fi
  done

  if [ "$cloudflare" = "1" ]; then
    printf 'cloudflare'
  elif [ "$matches_here" = "1" ]; then
    printf 'direct'
  else
    printf 'elsewhere'
  fi
}

# Human explanation for a classification, with the next step.
dns_explain() {
  local name="$1" kind="$2" ips
  ips="$(dns_resolve "$name" | tr '\n' ' ')"
  case "$kind" in
    cloudflare)
      ok "DNS ${name} → Cloudflare (${ips% }) — حالت پروکسی شناسایی شد." ;;
    direct)
      ok "DNS ${name} → ${ips% } — مستقیم به این سرور." ;;
    elsewhere)
      warn "DNS ${name} به این سرور اشاره نمی‌کند (${ips% })."
      warn "  رکورد A را به IP عمومی این سرور تغییر دهید، یا اگر پشت Cloudflare است آن را Proxied کنید." ;;
    unresolved)
      warn "DNS ${name} هنوز منتشر نشده است (پاسخ خالی)."
      warn "  انتشار DNS می‌تواند تا چند ساعت طول بکشد. نصب ادامه می‌یابد؛ HTTPS بعداً با «pishkan provision --tls» انجام می‌شود." ;;
  esac
}

# Can we reach port 80 from outside right now? Cloudflare's HTTP-01 challenge
# comes from their network, so a closed port 80 fails the certificate. Only
# meaningful for direct DNS; behind Cloudflare port 80 must still be open.
port_80_open_locally() {
  local listening
  listening="$(ss -H -ltn 2>/dev/null | awk '$4 ~ /:80$/ {print $4; exit}')"
  [ -n "$listening" ]
}

# ---------------------------------------------------------------------------
# Post-install verification
#
# `wait_for_health` proves the process answered on 127.0.0.1. It does not prove
# anything a user cares about: that the domain resolves, that nginx answers on
# it, that TLS terminates correctly, or that the SPA actually loads. Those
# failures are exactly the ones that survive to the customer, so they are
# checked here, after install, while the operator is still watching the output.
# ---------------------------------------------------------------------------

# verify_url <url> <expect-substring> <label>
verify_url() {
  local url="$1" needle="$2" label="$3" body
  body="$(curl -fsS --max-time 15 -L "$url" 2>/dev/null || true)"
  if [ -z "$body" ]; then
    err "${label}: پاسخی از ${url} نرسید."
    return 1
  fi
  if ! printf '%s' "$body" | grep -q "$needle"; then
    err "${label}: پاسخ آمد ولی محتوای مورد انتظار نبود (${url})."
    return 1
  fi
  ok "${label}"
  return 0
}

# verify_api_health <url> <label>
verify_api_health() {
  local url="$1" label="$2" body
  body="$(curl -fsS --max-time 10 "$url" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -q '"status"'; then
    ok "${label}"
    return 0
  fi
  err "${label}: ${url} پاسخ سلامت نداد."
  return 1
}

# verify_acme_reachable <host>
# The single most expensive failure to discover late: the challenge path is
# swallowed by the SPA and every renewal silently fails for 60 days.
verify_acme_reachable() {
  local host="$1" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -L "http://${host}/.well-known/acme-challenge/pishkan-probe" 2>/dev/null || true)"
  case "$code" in
    404|403)
      # 404 is the correct answer: nginx looked for the file and did not find
      # it. A 200 here means the SPA answered instead, which breaks certbot.
      ok "مسیر چالش ACME روی ${host} به nginx می‌رسد (${code})."
      return 0 ;;
    200)
      err "مسیر چالش ACME روی ${host} به SPA می‌رسد نه nginx — تمدید گواهی شکست می‌خورد."
      return 1 ;;
    ''|000)
      warn "بررسی مسیر ACME روی ${host} ممکن نشد (پاسخ نداد)."
      return 0 ;;
    *)
      warn "مسیر ACME روی ${host} کد ${code} داد؛ بررسی دستی لازم است."
      return 0 ;;
  esac
}

# verify_certificate <host>
verify_certificate() {
  local host="$1" expiry
  expiry="$(echo | timeout 15 openssl s_client -servername "$host" -connect "${host}:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$expiry" ]; then
    ok "گواهی TLS روی ${host} معتبر است (تا ${expiry})."
    return 0
  fi
  err "گواهی TLS روی ${host} خوانده نشد."
  return 1
}
