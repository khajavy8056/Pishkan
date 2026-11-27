#!/usr/bin/env bash
# End-to-end test of the tmux session machinery with a faithful mock tmux.
# The detach semantics are REAL (nohup'd background process survives SIGHUP
# to the foreground process group, exactly like a dropped SSH connection).
#
# Run as root (the deploy script escalates with sudo -n otherwise, which would
# strip the path overrides):   sudo bash scripts/ci/tests/tmux-session.e2e.sh
#
# Covers: detached run + follow, SSH-drop survival + resume, exit-code
# propagation (incl. stderr capture), reset killing a live session while
# preserving customer data, and the reset force gate.
set -u
RD="$(cd "$(dirname "$0")/.." && pwd)/remote-deploy.sh"
T=$(mktemp -d /tmp/pishkan-e2e.XXXXXX)
mkdir -p "$T/bin" "$T/log" "$T/state" "$T/conf"
export PISHKAN_LOG_DIR="$T/log" PISHKAN_STATE_DIR="$T/state" PISHKAN_CONFIG_DIR="$T/conf"
export PATH="$T/bin:$PATH"
SHA=0123456789abcdef0123456789abcdef01234567
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# --- mock tmux (pidfile-backed; new-session detaches via nohup) ---
cat > "$T/bin/tmux" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  has-session) [ -f "$T/running" ] && kill -0 "\$(cat "$T/running")" 2>/dev/null ;;
  kill-session) kill "\$(cat "$T/running")" 2>/dev/null; rm -f "$T/running" ;;
  new-session)
    shift
    while [ "\$#" -gt 1 ]; do case "\$1" in -d) shift;; -s|-x|-y) shift 2;; *) break;; esac; done
    nohup bash -c "\$1" >/dev/null 2>&1 &
    echo \$! > "$T/running" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$T/bin/tmux"

echo "=== A) install with lock → detached session, follow, exit 0 ==="
echo "test-lock" > "$T/state/.install-complete"
bash "$RD" install "" "" 0 "$SHA" main > "$T/a.out" 2>&1
rc=$?
[ "$rc" = 0 ] && ok "A exit code 0" || bad "A exit code $rc"
grep -q "already installed" "$T/a.out" && ok "A installer skip message streamed" || bad "A no skip message"
grep -q "deploy session finished (exit 0)" "$T/a.out" && ok "A finish marker followed" || bad "A no finish line"
[ "$(cat "$T/log/deploy-session.exit" 2>/dev/null)" = 0 ] && ok "A marker file = 0" || bad "A marker wrong"
grep -q "already installed" "$T/log/deploy-session.log" && ok "A full output captured in session log" || bad "A session log missing output"

echo "=== B) SSH drop mid-update → session survives → resume follows it ==="
cat > "$T/bin/pishkan" <<'EOF'
#!/usr/bin/env bash
echo "update: step 1/3"; sleep 4
echo "update: step 2/3"; sleep 4
echo "update: step 3/3"; sleep 4
echo "UPDATE-DONE"
EOF
chmod +x "$T/bin/pishkan"
rm -f "$T/log/deploy-session.exit"
setsid bash "$RD" update "" "" 0 "$SHA" main > "$T/b1.out" 2>&1 &
BGPID=$!
sleep 3
# simulate the SSH connection dropping: SIGHUP to the whole foreground group
kill -HUP -"$BGPID" 2>/dev/null
sleep 2
if [ -f "$T/running" ] && kill -0 "$(cat "$T/running")" 2>/dev/null; then ok "B session alive after SSH drop"; else bad "B session died with the connection"; fi
[ ! -f "$T/log/deploy-session.exit" ] && ok "B still running (no exit marker yet)" || bad "B unexpectedly finished"
# logs action must report the RUNNING session
bash "$RD" logs "" "" 0 "" main 2>&1 | grep -q "is RUNNING" && ok "B logs reports RUNNING session" || bad "B logs did not report running"
# reconnect: a new invocation must RESUME (attach), not restart
bash "$RD" update "" "" 0 "$SHA" main > "$T/b2.out" 2>&1
rc=$?
[ "$rc" = 0 ] && ok "B resume exit 0" || bad "B resume exit $rc"
grep -q "already running" "$T/b2.out" && ok "B resume detected existing session" || bad "B restarted instead of resuming"
grep -q "UPDATE-DONE" "$T/log/deploy-session.log" && ok "B install completed despite the drop" || bad "B work lost"
[ "$(cat "$T/log/deploy-session.exit" 2>/dev/null)" = 0 ] && ok "B marker = 0 after completion" || bad "B marker wrong"

echo "=== C) failing inner action → non-zero propagates through session ==="
cat > "$T/bin/pishkan" <<'EOF'
#!/usr/bin/env bash
echo "update: starting"; echo "update: BROKEN" >&2; exit 7
EOF
chmod +x "$T/bin/pishkan"
rm -f "$T/log/deploy-session.exit"
bash "$RD" update "" "" 0 "$SHA" main > "$T/c.out" 2>&1
rc=$?
[ "$rc" = 7 ] && ok "C exit code 7 propagated" || bad "C exit code $rc"
[ "$(cat "$T/log/deploy-session.exit" 2>/dev/null)" = 7 ] && ok "C marker = 7" || bad "C marker wrong"
grep -q "BROKEN" "$T/log/deploy-session.log" && ok "C stderr captured in session log" || bad "C stderr lost"

echo "=== D) reset kills a running session and keeps data dirs ==="
cat > "$T/bin/pishkan" <<'EOF'
#!/usr/bin/env bash
sleep 30
EOF
chmod +x "$T/bin/pishkan"
rm -f "$T/log/deploy-session.exit"
setsid bash "$RD" update "" "" 0 "$SHA" main > "$T/d1.out" 2>&1 &
DPID=$!
sleep 2
mkdir -p "$T/state/uploads"; echo "customer-file" > "$T/state/uploads/keep.txt"
bash "$RD" reset "" "" 1 "" main > "$T/d2.out" 2>&1
rc=$?
kill -HUP -"$DPID" 2>/dev/null
[ "$rc" = 0 ] && ok "D reset exit 0" || bad "D reset exit $rc"
sleep 1
if [ -f "$T/running" ] && kill -0 "$(cat "$T/running")" 2>/dev/null; then bad "D session still running after reset"; else ok "D running session killed by reset"; fi
[ ! -f "$T/state/.install-complete" ] && ok "D install lock removed" || bad "D lock still present"
[ -f "$T/state/uploads/keep.txt" ] && ok "D customer uploads preserved" || bad "D DATA LOST"

echo "=== E) reset without force is refused ==="
bash "$RD" reset "" "" 0 "" main > "$T/e.out" 2>&1
rc=$?
[ "$rc" != 0 ] && grep -q "force" "$T/e.out" && ok "E force gate enforced" || bad "E gate missing"

echo ""
echo "RESULT: PASS=$PASS FAIL=$FAIL"
rm -rf "$T"
[ "$FAIL" = 0 ]
