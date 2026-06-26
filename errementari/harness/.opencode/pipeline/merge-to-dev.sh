#!/bin/bash
# merge-to-dev.sh
# Merges the current branch into the local 'dev' branch, creating it from 'main' if it does not exist.
# Usage: .opencode/pipeline/merge-to-dev.sh
#
# Behavior:
#   - If we are on 'main' or 'dev': does nothing (no self-merge).
#   - If 'dev' does not exist: creates it from 'main' (new integration branch).
#   - If 'dev' exists: merge --no-ff of the current branch into 'dev'.
#   - On conflict: aborts the merge and returns exit != 0.
#   - At the end, returns the worktree to the original branch.
#
# Designed to run in step 3 of close.md (spec close).

set -euo pipefail

# Guard: repo with no commits yet (unborn HEAD) — nothing to merge
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "[merge-to-dev] The repository has no commits yet; nothing to merge."
  exit 0
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Default branch detection: origin/HEAD if set, else main, else master.
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
  echo "[merge-to-dev] ERROR: no 'main' or 'master' branch found to create 'dev' from." >&2
  exit 1
fi

# Guard: merging into itself makes no sense
if [ "$CURRENT_BRANCH" = "$MAIN_BRANCH" ] || [ "$CURRENT_BRANCH" = "dev" ]; then
  echo "[merge-to-dev] You are on '$CURRENT_BRANCH'; no merge into 'dev' is performed."
  exit 0
fi

# Verify there are commits to merge (basic defense)
if ! git show-ref --verify --quiet "refs/heads/$CURRENT_BRANCH"; then
  echo "[merge-to-dev] ERROR: branch '$CURRENT_BRANCH' not found." >&2
  exit 1
fi

echo "[merge-to-dev] Current branch: $CURRENT_BRANCH"

if git show-ref --verify --quiet refs/heads/dev; then
  echo "[merge-to-dev] 'dev' already exists; merging --no-ff '$CURRENT_BRANCH' into 'dev'..."
  git checkout dev
  if ! git merge --no-ff "$CURRENT_BRANCH" -m "merge: $CURRENT_BRANCH into dev"; then
    echo "" >&2
    echo "[merge-to-dev] CONFLICT merging '$CURRENT_BRANCH' into 'dev'." >&2
    echo "[merge-to-dev] Merge aborted. Resolve manually before continuing." >&2
    git merge --abort 2>/dev/null || true
    git checkout "$CURRENT_BRANCH"
    exit 2
  fi
else
  echo "[merge-to-dev] 'dev' does not exist; creating it from '$MAIN_BRANCH'..."
  git branch dev "$MAIN_BRANCH"
  echo "[merge-to-dev] 'dev' created. Now merging '$CURRENT_BRANCH'..."
  git checkout dev
  if ! git merge --no-ff "$CURRENT_BRANCH" -m "merge: $CURRENT_BRANCH into dev (initial)"; then
    echo "" >&2
    echo "[merge-to-dev] CONFLICT merging '$CURRENT_BRANCH' into freshly created 'dev'." >&2
    echo "[merge-to-dev] Merge aborted. Resolve manually before continuing." >&2
    git merge --abort 2>/dev/null || true
    git checkout "$CURRENT_BRANCH"
    exit 2
  fi
fi

git checkout "$CURRENT_BRANCH"
echo "[merge-to-dev] OK — '$CURRENT_BRANCH' merged into 'dev'. Returning to '$CURRENT_BRANCH'."
