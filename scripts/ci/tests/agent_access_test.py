#!/usr/bin/env python3
"""Tests for the post-revocation agent access model (approval windows + key expiry).

Run: python3 scripts/ci/tests/agent_access_test.py
No root needed: functions are imported directly and all paths are overridden via
env vars; fetch_requests is mocked so no network is touched.
"""
import importlib.machinery
import importlib.util
import io
import contextlib
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLI = os.path.join(ROOT, "pishkan-agent-requests")

tmp = tempfile.mkdtemp(prefix="pishkan-agent-test-")
state = os.path.join(tmp, "state")
pubkey = os.path.join(tmp, "agent_ed25519.pub")
authkeys = os.path.join(tmp, "authorized_keys")
os.makedirs(state, exist_ok=True)
with open(pubkey, "w") as fh:
    fh.write("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItestkeytestkeytestkeytestkey pishkan-agent\n")
os.environ["PISHKAN_STATE_DIR"] = state
os.environ["PISHKAN_AGENT_PUBKEY"] = pubkey
os.environ["PISHKAN_AGENT_AUTHKEYS"] = authkeys
os.environ["PISHKAN_AGENT_SHELL"] = "/usr/local/bin/pishkan-agent-shell"

loader = importlib.machinery.SourceFileLoader("par", CLI)
spec = importlib.util.spec_from_loader("par", loader)
par = importlib.util.module_from_spec(spec)
loader.exec_module(par)

PASS = 0
FAIL = 0


def ok(name):
    global PASS
    PASS += 1
    print("PASS:", name)


def bad(name, extra=""):
    global FAIL
    FAIL += 1
    print("FAIL:", name, extra)


def expect(cond, name, extra=""):
    ok(name) if cond else bad(name, extra)


now = datetime.now(timezone.utc)
future = (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
past = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")


def set_requests(items):
    par.fetch_requests = lambda: items


def quiet(fn, *a, **k):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*a, **k)
    return buf.getvalue()


# --- 1) approve uses the agent's requested minutes by default ----------------
set_requests([{"id": "req-aaa-111", "action": "agent", "reason": "بررسی وضعیت پس از نصب",
               "requested_minutes": 20, "created_at": par.iso(now), "expires_at": future}])
quiet(par.approve, "req-aaa-111")
ap = par.read_approval("req-aaa-111")
expect(ap["MINUTES"] == "20", "approve defaults to requested_minutes (20)", str(ap))
expect(ap["EXPIRES_AT"] > par.iso(now), "approval window is in the future")
expect("USED" not in ap, "window semantics: no single-use USED flag")

# --- 2) authorized_keys installed with forced command + expiry-time ----------
with open(authkeys) as fh:
    line = fh.read()
expect('command="/usr/local/bin/pishkan-agent-shell"' in line, "forced command present")
expect("restrict" in line, "restrict option present")
expect("expiry-time=" in line, "expiry-time present")
expect("ssh-ed25519" in line, "agent pubkey installed")
# expiry-time should be ~20 minutes ahead, formatted YYYYMMDDHHMMSS
import re
m = re.search(r'expiry-time="(\d{14})"', line)
expect(m is not None, "expiry-time format YYYYMMDDHHMMSS")
if m:
    exp = datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    delta = (exp - now).total_seconds() / 60
    expect(18 <= delta <= 22, "expiry ~20 minutes ahead", f"delta={delta}")

# --- 3) custom minutes override (y 120) --------------------------------------
quiet(par.approve, "req-aaa-111", 120)
ap = par.read_approval("req-aaa-111")
expect(ap["MINUTES"] == "120", "custom minutes override (120)")
with open(authkeys) as fh:
    line2 = fh.read()
m2 = re.search(r'expiry-time="(\d{14})"', line2)
exp2 = datetime.strptime(m2.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
delta2 = (exp2 - now).total_seconds() / 60
expect(118 <= delta2 <= 122, "expiry ~120 minutes ahead", f"delta={delta2}")

# --- 4) minutes clamped to ceiling -------------------------------------------
quiet(par.approve, "req-aaa-111", 99999)
expect(par.read_approval("req-aaa-111")["MINUTES"] == str(par.MAX_MINUTES), "minutes clamped to MAX")

# --- 5) revoke empties the key immediately -----------------------------------
quiet(par.revoke, "req-aaa-111")
expect(par.read_approval("req-aaa-111") is None, "revoke removes approval")
with open(authkeys) as fh:
    expect(fh.read() == "", "revoke empties authorized_keys (key inert)")

# --- 6) expired request refused ----------------------------------------------
set_requests([{"id": "req-old-222", "action": "agent", "reason": "x", "requested_minutes": 10,
               "created_at": par.iso(now), "expires_at": past}])
try:
    par.approve("req-old-222")
    bad("expired request refused")
except SystemExit as e:
    expect("منقضی" in str(e), "expired request refused")

# --- 7) unknown id refused ----------------------------------------------------
try:
    par.approve("req-nope-999")
    bad("unknown id refused")
except SystemExit:
    ok("unknown id refused")

# --- 8) path traversal refused ------------------------------------------------
try:
    par.approval_path("../evil")
    bad("path traversal refused")
except SystemExit:
    ok("path traversal refused")

# --- 9) prune drops expired approvals + rebuilds key -------------------------
set_requests([{"id": "req-bbb-333", "action": "agent", "reason": "y", "requested_minutes": 5,
               "created_at": par.iso(now), "expires_at": future}])
quiet(par.approve, "req-bbb-333")
# forge an expired approval on disk
exp_path = par.approval_path("req-exp-444")
with open(exp_path, "w") as fh:
    fh.write(f"REQUEST_ID=req-exp-444\nACTION=agent\nEXPIRES_AT={past}\nMINUTES=5\n")
quiet(par.prune)
expect(not os.path.isfile(exp_path), "prune removed expired approval")
expect(os.path.isfile(par.approval_path("req-bbb-333")), "prune kept active approval")
with open(authkeys) as fh:
    expect("ssh-ed25519" in fh.read(), "prune rebuilt key for remaining active window")

# --- 10) requested_minutes fallback + clamp ----------------------------------
expect(par.requested_minutes_of({}) == par.DEFAULT_MINUTES, "missing requested_minutes → default 15")
expect(par.requested_minutes_of({"requested_minutes": "abc"}) == par.DEFAULT_MINUTES, "invalid requested_minutes → default")
expect(par.requested_minutes_of({"requested_minutes": 0}) == 1, "zero requested_minutes → 1")

print()
print(f"RESULT: PASS={PASS} FAIL={FAIL}")
import shutil
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if FAIL else 0)
