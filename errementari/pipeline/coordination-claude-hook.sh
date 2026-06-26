#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Claude Code PreToolUse(Bash) hook → session coordination.
#
# Claude Code provides the tool input as JSON on stdin:
#   { "tool_name": "Bash", "tool_input": { "command": "..." }, ... }
#
# Extracts the command, heartbeats the 'claude' session and delegates to
# coordination.sh guard-git. If guard-git returns 2, this hook returns 2 and
# Claude Code BLOCKS the command execution, showing stderr to the model.
# ─────────────────────────────────────────────────────────────────────────────

DIR="$(cd "$(dirname "$0")" && pwd)"
input="$(cat)"

cmd=""
if command -v python3 >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception:
    pass' 2>/dev/null)"
fi

# Heartbeat (never blocks)
bash "$DIR/coordination.sh" heartbeat claude >/dev/null 2>&1 || true

[ -z "$cmd" ] && exit 0

bash "$DIR/coordination.sh" guard-git "$cmd"
exit $?
