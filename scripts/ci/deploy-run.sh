#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pishkan — runner-side orchestration for .github/workflows/deploy.yml.
#
# Reads secrets and inputs from the environment, connects to the VPS over SSH,
# uploads remote-deploy.sh, executes the requested action, cleans up, and writes
# a GitHub step summary. Key material is never printed; GitHub additionally
# masks secret values in the log.
#
# Local dry run (no connection attempted):
#   PISHKAN_CI_DRY_RUN=1 VPS_HOST=1.2.3.4 VPS_USER=root VPS_SSH_KEY=dummy \
#     ACTION=doctor bash scripts/ci/deploy-run.sh
# ---------------------------------------------------------------------------

set -Eeuo pipefail

ACTION="${ACTION:-doctor}"
REQUEST_ID="${REQUEST_ID:-}"
DOMAIN="${DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
FORCE_RAW="${FORCE:-false}"
REF_INPUT="${REF_INPUT:-}"
GITHUB_SHA="${GITHUB_SHA:-}"
BRANCH="${BRANCH:-main}"
RUN_ID="${RUN_ID:-local-$$}"
VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-}"
VPS_PORT="${VPS_PORT:-22}"
VPS_SSH_KEY="${VPS_SSH_KEY:-}"
AGENT_SSH_KEY="${AGENT_SSH_KEY:-}"
VPS_HOST_KEY="${VPS_HOST_KEY:-}"
DRY_RUN="${PISHKAN_CI_DRY_RUN:-0}"

err() { printf '✖ %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

# Resolve the target commit: an explicit input wins, otherwise the commit this
# workflow run was dispatched on. The installer/update both require a full SHA.
REF="${REF_INPUT:-$GITHUB_SHA}"

FORCE=0
case "$FORCE_RAW" in
  true|1) FORCE=1 ;;
  false|0|"") FORCE=0 ;;
  *) die "FORCE must be true or false, got '$FORCE_RAW'" ;;
esac

# --- restricted agent session (post-revocation, approval-gated) --------------
# ACTION=agent NEVER uses the full deploy key. It connects as the locked-down
# `pishkan-agent` user whose SSH key only exists during an operator-approved
# window (OpenSSH expiry-time) and whose forced command runs read-only
# diagnostics. This is the path the agent uses AFTER the operator revokes the
# main secret; while the main secret is valid the agent uses normal actions.
if [ "$ACTION" = "agent" ]; then
  [ -n "$VPS_HOST" ] || die "VPS_HOST secret is required for action=agent"
  [ -n "$AGENT_SSH_KEY" ] || die "AGENT_SSH_KEY secret is required for action=agent (run: pishkan-agent-bootstrap setup)"
  [[ "$VPS_PORT" =~ ^[0-9]{1,5}$ ]] || die "VPS_PORT must be numeric, got '$VPS_PORT'"
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY RUN — agent session: ssh -p ${VPS_PORT} pishkan-agent@${VPS_HOST} (forced read-only diagnostics)"
    exit 0
  fi
  WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
  KEY="$WORK/id_agent"; KNOWN="$WORK/known_hosts"
  printf '%s\n' "$AGENT_SSH_KEY" > "$KEY"; chmod 600 "$KEY"
  if [ -n "$VPS_HOST_KEY" ]; then
    printf '%s\n' "$VPS_HOST_KEY" > "$KNOWN"
  else
    ssh-keyscan -p "$VPS_PORT" -t ed25519,rsa "$VPS_HOST" > "$KNOWN" 2>/dev/null || true
  fi
  [ -s "$KNOWN" ] || die "no host key for agent session — set VPS_HOST_KEY or check VPS_HOST/VPS_PORT."
  chmod 600 "$KNOWN"
  echo "── Agent session (read-only, operator-approved window) ──"
  rc=0
  ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile="$KNOWN" -o ConnectTimeout=20 -p "$VPS_PORT" \
      "pishkan-agent@$VPS_HOST" "agent ${REQUEST_ID}" || rc=$?
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## نشست تشخیصی عامل (فقط-خواندنی)"
      echo ""
      if [ "$rc" -eq 0 ]; then
        echo "✅ انجام شد — پنجرهٔ تأییدشدهٔ اپراتور."
      else
        echo "❌ ناموفق (کد $rc) — احتمالاً درخواست تأیید نشده یا پنجرهٔ دسترسی بسته/منقضی است."
      fi
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit "$rc"
fi

# --- required secrets ---------------------------------------------------------
missing=()
[ -n "$VPS_HOST" ] || missing+=("VPS_HOST")
[ -n "$VPS_USER" ] || missing+=("VPS_USER")
[ -n "$VPS_SSH_KEY" ] || missing+=("VPS_SSH_KEY")
if [ "${#missing[@]}" -gt 0 ]; then
  err "Missing GitHub repository secrets: ${missing[*]}"
  err "Add them under Settings → Secrets and variables → Actions → New repository secret."
  err "Step-by-step guide: docs/DEPLOY-GITHUB-ACTIONS-FA.md"
  exit 1
fi
[[ "$VPS_PORT" =~ ^[0-9]{1,5}$ ]] || die "VPS_PORT must be numeric, got '$VPS_PORT'"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_SRC="$SCRIPT_DIR/remote-deploy.sh"
[ -f "$REMOTE_SRC" ] || die "remote-deploy.sh not found next to deploy-run.sh"

TARGET="$VPS_USER@$VPS_HOST"
REMOTE_PATH="/tmp/pishkan-remote-deploy-${RUN_ID}.sh"

# printf %q makes every input shell-safe for the remote command; the remote
# script additionally validates each value against a strict pattern.
if [ -n "$REQUEST_ID" ]; then
  REMOTE_ARGS="$(printf '%q ' "$ACTION" "$DOMAIN" "$ACME_EMAIL" "$FORCE" "$REF" "$BRANCH" "$REQUEST_ID")"
else
  REMOTE_ARGS="$(printf '%q ' "$ACTION" "$DOMAIN" "$ACME_EMAIL" "$FORCE" "$REF" "$BRANCH")"
fi
REMOTE_CMD="bash ${REMOTE_PATH} ${REMOTE_ARGS}"

# Dry run is fully offline: it must never touch the network (no keyscan, no SSH).
if [ "$DRY_RUN" = "1" ]; then
  echo "DRY RUN (PISHKAN_CI_DRY_RUN=1) — no connection attempted."
  echo "would upload: $REMOTE_SRC -> ${TARGET}:${REMOTE_PATH}"
  echo "would run:    ssh -p ${VPS_PORT} ${TARGET} \"${REMOTE_CMD}\""
  exit 0
fi

# --- SSH material (temporary, removed on exit) ---------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
KEY="$WORK/id_deploy"
KNOWN="$WORK/known_hosts"
printf '%s\n' "$VPS_SSH_KEY" >"$KEY"
chmod 600 "$KEY"

if [ -n "$VPS_HOST_KEY" ]; then
  printf '%s\n' "$VPS_HOST_KEY" >"$KNOWN"
  echo "Host key: pinned from the VPS_HOST_KEY secret (strict verification)."
else
  echo "::warning::VPS_HOST_KEY secret is not set — using ssh-keyscan (trust-on-first-use). Pin the host key for production; see docs/DEPLOY-GITHUB-ACTIONS-FA.md."
  ssh-keyscan -p "$VPS_PORT" -t ed25519,rsa "$VPS_HOST" >"$KNOWN" 2>/dev/null || true
  [ -s "$KNOWN" ] || die "ssh-keyscan returned no host keys — check VPS_HOST, VPS_PORT and the server firewall."
fi
chmod 600 "$KNOWN"

SSH_BASE=(-i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
         -o UserKnownHostsFile="$KNOWN" -o ServerAliveInterval=30
         -o ServerAliveCountMax=10 -o ConnectTimeout=20)

echo "── Preflight ──"
ssh "${SSH_BASE[@]}" -p "$VPS_PORT" "$TARGET" \
  'hostname; grep PRETTY_NAME /etc/os-release; df -h /var | tail -1; if [ -f /var/lib/pishkan/.install-complete ]; then echo "pishkan: INSTALLED"; else echo "pishkan: NOT_INSTALLED"; fi'

echo "── Uploading deployment script ──"
scp "${SSH_BASE[@]}" -P "$VPS_PORT" "$REMOTE_SRC" "$TARGET:$REMOTE_PATH"

echo "── Running action: ${ACTION} ──"
rc=0
ssh "${SSH_BASE[@]}" -p "$VPS_PORT" "$TARGET" "$REMOTE_CMD" || rc=$?

echo "── Cleanup ──"
ssh "${SSH_BASE[@]}" -p "$VPS_PORT" "$TARGET" "rm -f '$REMOTE_PATH'" || true

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## استقرار تک پیشخوان روی VPS"
    echo ""
    echo "| مورد | مقدار |"
    echo "| --- | --- |"
    echo "| عملیات | \`$ACTION\` |"
    if [ "$rc" -eq 0 ]; then echo "| نتیجه | ✅ موفق |"; else echo "| نتیجه | ❌ ناموفق (کد $rc) |"; fi
    echo "| commit | \`${REF:0:12}\` |"
    echo "| شاخه | \`$BRANCH\` |"
    echo ""
    echo "گزارش کامل نصب روی سرور: \`/var/log/pishkan/install-report.md\`"
    echo "راهنما: \`docs/DEPLOY-GITHUB-ACTIONS-FA.md\`"
  } >>"$GITHUB_STEP_SUMMARY"
fi

exit "$rc"
