#!/usr/bin/env bash
# End-to-end test of the operator-approved agent access gate.
#
# Proves: no approval → refused; valid approval → runs once and is consumed;
# reuse → refused; expired → refused; wrong action → refused; input validation.
#
# Run:  bash scripts/ci/tests/agent-approval.e2e.sh   (no root needed: the
# functions are sourced directly and paths are overridden via PISHKAN_* env).
set -u
RD="$(cd "$(dirname "$0")/.." && pwd)/remote-deploy.sh"
T=$(mktemp -d /tmp/pishkan-agent-test.XXXXXX)
mkdir -p "$T/bin" "$T/log" "$T/state/agent-approvals" "$T/conf"
export PISHKAN_LOG_DIR="$T/log" PISHKAN_STATE_DIR="$T/state" PISHKAN_CONFIG_DIR="$T/conf"
export PATH="$T/bin:$PATH"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# Mock pishkan CLI so action_agent has something read-only to run.
cat > "$T/bin/pishkan" <<'EOF'
#!/usr/bin/env bash
echo "[mock pishkan $*]"
EOF
chmod +x "$T/bin/pishkan"

# shellcheck source=/dev/null
source "$RD"
set +e

future="$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+10M +%Y-%m-%dT%H:%M:%SZ)"
past="$(date -u -d '-10 minutes' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)"

write_approval() {
  local id="$1" action="$2" expires="$3" used="$4"
  printf 'REQUEST_ID=%s\nACTION=%s\nAPPROVED_AT=%s\nEXPIRES_AT=%s\nUSED=%s\n' "$id" "$action" "$future" "$expires" "$used" > "$T/state/agent-approvals/$id.conf"
}

echo "=== A) no approval → refused ==="
out="$(action_agent req-none-12345 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "no operator approval" && ok "A refused without approval" || bad "A not refused (rc=$rc)"

echo "=== B) valid approval → runs, consumes ==="
write_approval req-valid-12345 agent "$future" 0
out="$(action_agent req-valid-12345 2>&1)"; rc=$?
[ "$rc" = 0 ] && ok "B ran with valid approval" || bad "B failed (rc=$rc): $out"
echo "$out" | grep -q "mock pishkan status" && ok "B status executed" || bad "B status missing"
echo "$out" | grep -q "mock pishkan doctor" && ok "B doctor executed" || bad "B doctor missing"
grep -q "^USED=1$" "$T/state/agent-approvals/req-valid-12345.conf" && ok "B approval consumed" || bad "B approval not consumed"

echo "=== C) reuse → refused ==="
out="$(action_agent req-valid-12345 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "already consumed" && ok "C reuse refused" || bad "C reuse allowed (rc=$rc)"

echo "=== D) expired → refused ==="
write_approval req-expired-123 agent "$past" 0
out="$(action_agent req-expired-123 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "expired" && ok "D expired refused" || bad "D expired allowed (rc=$rc)"

echo "=== E) wrong action → refused ==="
write_approval req-wrong-1234 install "$future" 0
out="$(action_agent req-wrong-1234 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "not 'agent'" && ok "E wrong action refused" || bad "E wrong action allowed (rc=$rc)"

echo "=== F) input validation ==="
(validate_inputs agent "" "" 0 "" main "" 2>/dev/null); [ $? -ne 0 ] && ok "F agent without request_id rejected" || bad "F missing id accepted"
(validate_inputs agent "" "" 0 "" main "req-valid-12345" 2>/dev/null); [ $? -eq 0 ] && ok "F agent with valid id accepted" || bad "F valid id rejected"
(validate_inputs agent "" "" 0 "" main "../../etc/passwd" 2>/dev/null); [ $? -ne 0 ] && ok "F path-traversal id rejected" || bad "F traversal accepted"

echo ""
echo "RESULT: PASS=$PASS FAIL=$FAIL"
rm -rf "$T"
[ "$FAIL" = 0 ]
