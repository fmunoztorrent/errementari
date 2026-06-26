#!/usr/bin/env bash
# pre-spec.sh — Pre-flight check before starting a new spec/pipeline.
# Usage: bash .opencode/pipeline/pre-spec.sh
# Exits 0 if everything is OK, 1 if there is any problem.

set -euo pipefail

PASS="✓"
FAIL="✗"
WARN="⚠"
ok=true

# ── Repo topology detection ───────────────────────────────────────────
# New/local-only projects may have no 'origin' remote and may use a default
# branch other than 'main'. Checks degrade to warnings instead of failing.
HAS_REMOTE=false
if git remote get-url origin >/dev/null 2>&1; then
  HAS_REMOTE=true
fi

MAIN_BRANCH="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)"
if [ -z "$MAIN_BRANCH" ]; then
  for b in main master; do
    if git show-ref --verify --quiet "refs/heads/$b"; then
      MAIN_BRANCH="$b"
      break
    fi
  done
fi
if [ -z "$MAIN_BRANCH" ]; then
  MAIN_BRANCH="main"
fi

# Best ref to compare against: origin/<main> if reachable, local <main> otherwise.
MAIN_REF=""
if [ "$HAS_REMOTE" = true ]; then
  git fetch origin "$MAIN_BRANCH" --quiet 2>/dev/null || true
  if git rev-parse --verify "origin/$MAIN_BRANCH" >/dev/null 2>&1; then
    MAIN_REF="origin/$MAIN_BRANCH"
  fi
fi
if [ -z "$MAIN_REF" ]; then
  if git rev-parse --verify "$MAIN_BRANCH" >/dev/null 2>&1; then
    MAIN_REF="$MAIN_BRANCH"
  fi
fi

echo ""
echo "── pre-spec: state verification ──────────────────────────────────"

# ── Check 1: Clean working tree ───────────────────────────────────────
dirty=$(git status --porcelain 2>/dev/null)
if [ -z "$dirty" ]; then
  echo "  $PASS Clean working tree"
else
  echo "  $FAIL Dirty working tree — commit or stash before continuing:"
  git status --short | sed 's/^/       /'
  ok=false
fi

# ── Check 2: No open pipeline PRs ─────────────────────────────────────
# Only PRs from harness branches (feature/*, fix/*, chore/*, dev) block a new
# spec. Unrelated PRs (dependabot, teammates' work) are reported, not blocking.
if [ "$HAS_REMOTE" != true ]; then
  echo "  $WARN No 'origin' remote — skipping PR check (local-only repo)"
elif command -v gh &>/dev/null; then
  pipeline_prs=$(gh pr list --json number,title,headRefName \
    --jq '.[] | select(.headRefName | test("^(feature|fix|chore)/|^dev$")) | "#\(.number)  \(.title)  (\(.headRefName))"' \
    2>/dev/null || echo "__gh_failed__")
  if [ "$pipeline_prs" = "__gh_failed__" ]; then
    echo "  $WARN Could not query open PRs (gh error) — check manually"
  elif [ -n "$pipeline_prs" ]; then
    echo "  $FAIL Open pipeline PR(s) — merge or close before continuing:"
    echo "$pipeline_prs" | sed 's/^/       /'
    ok=false
  else
    other_count=$(gh pr list --json number --jq 'length' 2>/dev/null || echo 0)
    if [ "$other_count" -gt 0 ]; then
      echo "  $PASS No open pipeline PRs ($other_count unrelated PR(s) open — not blocking)"
    else
      echo "  $PASS No open PRs"
    fi
  fi
else
  echo "  $WARN gh CLI not available — could not check for open PRs"
fi

# ── Check 3: dev must not have orphan feature/fix commits ─────────────
# Looks for non-merge commits in dev that are not in the main branch.
# Integration merge commits (merge: X → dev) are expected and ignored.
#
# Classification: feature/fix → FAIL (they need a PR to main)
#                 chore/learnings → WARN (integration artifacts)
if [ -z "$MAIN_REF" ]; then
  echo "  $WARN No '$MAIN_BRANCH' branch yet — skipping orphan-commit check"
  orphans=""
else
  orphans=$(git log "$MAIN_REF"..dev --no-merges --oneline 2>/dev/null || true)
fi
if [ -z "$orphans" ]; then
  if [ -n "$MAIN_REF" ]; then
    echo "  $PASS No orphan commits in dev"
  fi
else
  # Classify commits by type
  feature_orphans=""
  safe_orphans=""
  while IFS= read -r line; do
    # --oneline prefixes the SHA: match the type after "<sha> "
    if echo "$line" | grep -qiE '^[0-9a-f]+[[:space:]]+(feat|fix|feature|bugfix)'; then
      feature_orphans="$feature_orphans$line"$'\n'
    else
      safe_orphans="$safe_orphans$line"$'\n'
    fi
  done <<< "$orphans"

  if [ -n "$feature_orphans" ]; then
    echo "  $FAIL dev has feature/fix commits not merged into $MAIN_BRANCH:"
    echo "$feature_orphans" | sed '/^$/d' | sed 's/^/       /'
    if [ "$HAS_REMOTE" = true ]; then
      echo "       These commits must be in a PR to $MAIN_BRANCH before starting."
      echo "       Run: gh pr create --base $MAIN_BRANCH --head dev"
    else
      echo "       Merge them into $MAIN_BRANCH before starting:"
      echo "       git checkout $MAIN_BRANCH && git merge dev"
    fi
    ok=false
  fi

  if [ -n "$safe_orphans" ]; then
    echo "  $WARN dev has other non-merge commits (chore/learnings):"
    echo "$safe_orphans" | sed '/^$/d' | sed 's/^/       /'
    echo "       Integration artifacts — you can ignore them or push to dev."
  fi
fi

# ── Check 4: No pending close ─────────────────────────────────────────
close_pending=".opencode/pipeline/close-pending.json"
if [ -f "$close_pending" ]; then
  scope=$(grep '"scope"' "$close_pending" 2>/dev/null | sed 's/.*"scope":[[:space:]]*"\([^"]*\)".*/\1/' || echo "unknown")
  echo "  $FAIL Pending close for scope '$scope' — run close.md before continuing"
  ok=false
else
  echo "  $PASS No pending close"
fi

# ── Check 5: dev in sync with the main branch ─────────────────────────
# --verify is required: plain `git rev-parse dev` echoes "dev" to stdout
# even when the branch does not exist.
dev_sha=$(git rev-parse --verify --quiet refs/heads/dev 2>/dev/null || echo "missing")
if [ "$dev_sha" = "missing" ]; then
  echo "  $WARN Branch 'dev' does not exist locally — it will be created from $MAIN_BRANCH at close"
elif [ -z "$MAIN_REF" ]; then
  echo "  $WARN No '$MAIN_BRANCH' branch to compare against — skipping dev sync check"
elif git merge-base --is-ancestor "$MAIN_REF" dev 2>/dev/null; then
  echo "  $PASS dev contains $MAIN_REF (it may have additional local commits)"
else
  echo "  $FAIL dev is behind $MAIN_REF — run: git checkout dev && git merge $MAIN_REF"
  ok=false
fi

echo "──────────────────────────────────────────────────────────────────"

if [ "$ok" = true ]; then
  echo "  $PASS pre-spec OK — you can start a new spec"
  echo ""
  exit 0
else
  echo "  $FAIL pre-spec FAILED — resolve the issues above before continuing"
  echo ""
  exit 1
fi
