#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Hook PreToolUse(Bash) de Claude Code → coordinación de sesiones.
#
# Claude Code entrega el input del tool como JSON por stdin:
#   { "tool_name": "Bash", "tool_input": { "command": "..." }, ... }
#
# Extrae el comando, hace heartbeat de la sesión 'claude' y delega en
# coordination.sh guard-git. Si guard-git devuelve 2, este hook devuelve 2 y
# Claude Code BLOQUEA la ejecución del comando, mostrando stderr al modelo.
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

# Heartbeat (nunca bloquea)
bash "$DIR/coordination.sh" heartbeat claude >/dev/null 2>&1 || true

[ -z "$cmd" ] && exit 0

bash "$DIR/coordination.sh" guard-git "$cmd"
exit $?
