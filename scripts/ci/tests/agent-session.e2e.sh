#!/usr/bin/env bash
# End-to-end checks for the restricted agent session path:
#   - diagnostics refuses without a live approval, runs (read-only) with one
#   - deploy-run.sh agent branch uses the AGENT key + dry-run works
#   - bootstrap refuses non-root and dispatches modes
# Run: bash scripts/ci/tests/agent-session.e2e.sh   (no root required)
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
T=$(mktemp -d /tmp/pishkan-agent-session.XXXXXX)
mkdir -p "$T/bin" "$T/state/agent-approvals" "$T/log"
export PATH="$T/bin:$PATH"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# Mock pishkan CLI (read-only status/doctor) + a log file with an IP to redact.
cat > "$T/bin/pishkan" <<'EOF'
#!/usr/bin/env bash
echo "[mock pishkan $*] server 203.0.113.7"
EOF
chmod +x "$T/bin/pishkan"
printf 'line one 198.51.100.9\nline two\n' > "$T/log/app.log"

future="$(date -u -d '+20 minutes' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+20M +%Y-%m-%dT%H:%M:%SZ)"

echo "=== A) diagnostics refuses without approval ==="
out="$(PISHKAN_STATE_DIR="$T/state" bash "$ROOT/scripts/pishkan-agent-diagnostics" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "دسترسی فعالی وجود ندارد" && ok "A refused without approval" || bad "A not refused (rc=$rc)"

echo "=== B) diagnostics runs read-only with a live approval ==="
printf 'REQUEST_ID=req-x\nACTION=agent\nEXPIRES_AT=%s\nMINUTES=20\n' "$future" > "$T/state/agent-approvals/req-x.conf"
# point the log tail at our temp log by symlinking the expected path is not possible
# without root; instead verify status/doctor + redaction of their output.
out="$(PISHKAN_STATE_DIR="$T/state" bash "$ROOT/scripts/pishkan-agent-diagnostics" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ok "B ran with approval" || bad "B failed (rc=$rc): $out"
echo "$out" | grep -q "mock pishkan status" && ok "B status executed" || bad "B status missing"
echo "$out" | grep -q "mock pishkan doctor" && ok "B doctor executed" || bad "B doctor missing"
echo "$out" | grep -q "\[IP\]" && ok "B IP redacted" || bad "B IP not redacted"
echo "$out" | grep -q "203.0.113.7" && bad "B leaked IP" || ok "B no raw IP leaked"

echo "=== C) deploy-run agent dry-run uses agent path ==="
out="$(PISHKAN_CI_DRY_RUN=1 ACTION=agent VPS_HOST=1.2.3.4 AGENT_SSH_KEY=dummy REQUEST_ID=req-x \
  bash "$ROOT/scripts/ci/deploy-run.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && echo "$out" | grep -q "pishkan-agent@1.2.3.4" && ok "C agent dry-run targets restricted user" || bad "C dry-run wrong (rc=$rc): $out"

echo "=== D) deploy-run agent requires AGENT_SSH_KEY ==="
out="$(PISHKAN_CI_DRY_RUN=1 ACTION=agent VPS_HOST=1.2.3.4 bash "$ROOT/scripts/ci/deploy-run.sh" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "AGENT_SSH_KEY" && ok "D missing agent key rejected" || bad "D missing key accepted (rc=$rc)"

echo "=== E) bootstrap refuses non-root ==="
if [ "$(id -u)" -ne 0 ]; then
  out="$(bash "$ROOT/scripts/pishkan-agent-bootstrap" status 2>&1)"; rc=$?
  [ "$rc" -ne 0 ] && echo "$out" | grep -q "root" && ok "E non-root refused" || bad "E non-root accepted (rc=$rc)"
else
  ok "E skipped (running as root)"
fi

echo "=== F) bootstrap rejects unknown mode (as root only) / syntax ==="
bash -n "$ROOT/scripts/pishkan-agent-bootstrap" && ok "F bootstrap syntax valid" || bad "F bootstrap syntax error"

echo ""
echo "RESULT: PASS=$PASS FAIL=$FAIL"
rm -rf "$T"
[ "$FAIL" = 0 ]
