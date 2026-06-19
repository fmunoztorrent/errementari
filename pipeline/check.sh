#!/bin/bash
# Pipeline state checker (multi-scope)
# Returns 0 if ANY scope is active (allows edits/commits)
# Returns 1 if no scope is active (blocks edits/commits)
# Usage: .opencode/pipeline/check.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: Pipeline state file not found. Run todowrite first."
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PIPELINE_ACTIVE=$(python3 -c "
import json
state = json.load(open('$STATE_FILE'))
# Check if ANY scope is active
scopes = state.get('scopes', {})
active = any(s.get('active', False) for s in scopes.values())
print(active)
" 2>/dev/null)
elif command -v node >/dev/null 2>&1; then
  PIPELINE_ACTIVE=$(node -e "
const s = require(process.argv[1]);
const active = Object.values(s.scopes || {}).some((v) => v && v.active);
console.log(active ? 'True' : 'False');
" "$STATE_FILE" 2>/dev/null)
else
  echo "ERROR: neither python3 nor node available — cannot read pipeline state."
  exit 1
fi

if [ "$PIPELINE_ACTIVE" = "True" ]; then
  exit 0
else
  echo "ERROR: Pipeline is not active. Run todowrite with pipeline steps first."
  echo ""
  echo "For multiple tasks, use scopes:"
  echo "  [feature.my-feature]"
  echo "  [▶] 1/6 Spec Generator ..."
  echo "  [bugfix.my-fix]"
  echo "  [▶] 1/5 Triage ..."
  exit 1
fi
