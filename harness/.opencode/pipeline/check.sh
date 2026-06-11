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

PIPELINE_ACTIVE=$(python3 -c "
import json
state = json.load(open('$STATE_FILE'))
# Check if ANY scope is active
scopes = state.get('scopes', {})
active = any(s.get('active', False) for s in scopes.values())
print(active)
" 2>/dev/null)

if [ "$PIPELINE_ACTIVE" = "True" ]; then
  exit 0
else
  echo "ERROR: Pipeline is not active. Run todowrite with pipeline steps first."
  echo ""
  echo "Para tareas múltiples, usa scopes:"
  echo "  [feature.mi-feature]"
  echo "  [▶] 1/6 Spec Generator ..."
  echo "  [bugfix.mi-fix]"
  echo "  [▶] 1/5 Triage ..."
  exit 1
fi
