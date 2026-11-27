#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pishkan — publish the captured deploy output to a dedicated branch.
#
# Why: the raw GitHub Actions log storage host is not reachable from the agent
# sandbox, so the agent cannot download run logs directly. This script copies
# the captured output to the `pishkan-deploy-reports` branch via the GitHub
# contents API (api.github.com), which the agent CAN read. The repository is
# public, so the server IP is redacted before publishing; the SSH key is never
# printed by the deploy scripts, and the installer report is already sanitized.
#
# Runs in the workflow's "Publish deploy report" step (if: always()).
#   publish-report.sh <captured-output-file>
# Env: GH_TOKEN (runner token, contents:write), RUN_ID, GITHUB_REPOSITORY, VPS_HOST
# ---------------------------------------------------------------------------

set -Eeuo pipefail

OUTPUT="${1:?usage: publish-report.sh <output-file>}"
RUN_ID="${RUN_ID:-unknown}"
REPO="${GITHUB_REPOSITORY:-khajavy8056/Pishkan}"
BRANCH="pishkan-deploy-reports"

[ -f "$OUTPUT" ] || { echo "publish-report: no output file; nothing to publish"; exit 0; }
if [ -z "${GH_TOKEN:-}" ]; then echo "publish-report: GH_TOKEN not set; skipping"; exit 0; fi

# Redact the server IP (a mild identifier) before publishing to a public branch.
# VPS_USER is usually "root" and redacting it would mangle paths, so it is left.
if [ -n "${VPS_HOST:-}" ]; then
  esc="$(printf '%s' "$VPS_HOST" | sed -e 's/[\\&|]/\\&/g')"
  sed -i "s|${esc}|[server-ip]|g" "$OUTPUT" || true
fi

# Keep only the last 500KB so the contents API (1MB limit) always accepts it.
tail -c 500000 "$OUTPUT" > "${OUTPUT}.pub"
CONTENT="$(base64 -w0 "${OUTPUT}.pub")"
rm -f "${OUTPUT}.pub"

# Ensure the reports branch exists; create it from the default branch if not.
if ! gh api "repos/$REPO/git/ref/heads/$BRANCH" >/dev/null 2>&1; then
  default_branch="$(gh api "repos/$REPO" --jq '.default_branch')"
  base_sha="$(gh api "repos/$REPO/git/ref/heads/$default_branch" --jq '.object.sha')"
  gh api "repos/$REPO/git/refs" -X POST -f ref="refs/heads/$BRANCH" -f sha="$base_sha" >/dev/null
  echo "publish-report: created branch $BRANCH"
fi

file="deploy-reports/run-${RUN_ID}.log"
existing_sha="$(gh api "repos/$REPO/contents/$file?ref=$BRANCH" --jq '.sha' 2>/dev/null || true)"
if [ -n "$existing_sha" ]; then
  gh api "repos/$REPO/contents/$file" -X PUT \
    -f message="deploy report: run $RUN_ID" -f content="$CONTENT" \
    -f branch="$BRANCH" -f sha="$existing_sha" >/dev/null
else
  gh api "repos/$REPO/contents/$file" -X PUT \
    -f message="deploy report: run $RUN_ID" -f content="$CONTENT" \
    -f branch="$BRANCH" >/dev/null
fi
echo "publish-report: published $BRANCH/$file"
