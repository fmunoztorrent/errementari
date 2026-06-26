#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Coordinación de sesiones Claude Code ↔ opencode sobre el MISMO working tree.
#
# Problema que resuelve: dos herramientas agénticas (Claude Code y opencode)
# operan sobre el mismo árbol de trabajo. Una operación git destructiva en una
# (checkout -f, reset --hard, clean -f, ...) descarta cambios sin commitear o
# borra archivos untracked de la otra. Esto causó pérdida de trabajo real.
#
# Estado compartido: coordination.json (gitignored, por máquina). Registra qué
# herramienta tiene una sesión viva y en qué rama. El guard NO se basa solo en
# el registro: la protección de fondo es "¿el árbol está sucio?" — y el árbol es
# compartido, así que protege a ambas herramientas por construcción.
#
# Uso:
#   coordination.sh register  <tool> [task]   # alta/heartbeat de sesión
#   coordination.sh heartbeat <tool>          # actualiza heartbeat
#   coordination.sh release   <tool>          # baja de sesión
#   coordination.sh list                      # imprime el estado compartido
#   coordination.sh guard-git "<comando>"     # exit 2 si destruiría cambios
#
# Override puntual: COORD_OVERRIDE=1 <comando-que-se-bloquearía>
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COORD_FILE="$SCRIPT_DIR/coordination.json"
TTL_SECONDS=1800   # 30 min sin heartbeat ⇒ sesión muerta (se purga)
PY="$(command -v python3 || true)"

now_iso()     { date -u +%Y-%m-%dT%H:%M:%SZ; }
repo_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?"; }
ensure_file() { [ -f "$COORD_FILE" ] || echo '{"sessions":{}}' > "$COORD_FILE"; }

cmd="${1:-}"; shift 2>/dev/null || true

case "$cmd" in
  register|heartbeat)
    [ -z "$PY" ] && exit 0   # sin python3 no coordinamos, pero no rompemos nada
    ensure_file
    TOOL="${1:-unknown}" TASK="${2:-}" BRANCH="$(repo_branch)" PID="${PPID:-0}" \
    NOW="$(now_iso)" TTL="$TTL_SECONDS" "$PY" - "$COORD_FILE" <<'PY'
import json, os, sys, datetime
f = sys.argv[1]
try:
    d = json.load(open(f))
except Exception:
    d = {"sessions": {}}
s = d.setdefault("sessions", {})

def age(ts):
    try:
        t = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
        return (datetime.datetime.utcnow() - t).total_seconds()
    except Exception:
        return 1e18

ttl = float(os.environ["TTL"])
for k in list(s):
    if age(s[k].get("heartbeat", "")) > ttl:
        del s[k]

tool = os.environ["TOOL"]
now = os.environ["NOW"]
e = s.setdefault(tool, {})
e["tool"] = tool
e["pid"] = int(os.environ["PID"])
e["branch"] = os.environ["BRANCH"]
e["heartbeat"] = now
e.setdefault("registered_at", now)
if os.environ.get("TASK"):
    e["task"] = os.environ["TASK"]
json.dump(d, open(f, "w"), indent=2)
PY
    ;;

  release)
    [ -z "$PY" ] && exit 0
    ensure_file
    TOOL="${1:-unknown}" "$PY" - "$COORD_FILE" <<'PY'
import json, os, sys
f = sys.argv[1]
try:
    d = json.load(open(f))
except Exception:
    d = {"sessions": {}}
d.get("sessions", {}).pop(os.environ["TOOL"], None)
json.dump(d, open(f, "w"), indent=2)
PY
    ;;

  list)
    ensure_file
    cat "$COORD_FILE"
    ;;

  guard-git)
    full="$*"

    # ¿Operación git destructiva para el working tree?
    # El git destructivo debe estar en POSICIÓN DE COMANDO (inicio de línea o
    # tras ; && || | ( ) para no matchear menciones dentro de comillas, p.ej.
    # echo "git reset --hard" o un mensaje de commit. grep procesa línea a línea.
    boundary='(^|[;&|(])[[:space:]]*'
    destructive_re="${boundary}git[[:space:]]+(reset[[:space:]]+--hard|clean[[:space:]]+-[a-zA-Z]*f|checkout[[:space:]]+-f|checkout[[:space:]]+--([[:space:]]|\$)|checkout[[:space:]]+\.|switch[[:space:]]+(-f|--discard-changes)|stash([[:space:]]|\$))"
    if ! printf '%s' "$full" | grep -Eq "$destructive_re"; then
      exit 0   # no destructiva → permitir
    fi

    dirty="$(git status --porcelain 2>/dev/null)"
    [ -z "$dirty" ] && exit 0   # árbol limpio → nada que perder

    # Info de otras sesiones vivas (solo para enriquecer el mensaje)
    others=""
    if [ -n "$PY" ] && [ -f "$COORD_FILE" ]; then
      others="$(THIS="$(repo_branch)" "$PY" - "$COORD_FILE" <<'PY'
import json, os, sys, datetime
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
def age(ts):
    try:
        t = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
        return (datetime.datetime.utcnow() - t).total_seconds()
    except Exception:
        return 1e18
out = []
for k, v in d.get("sessions", {}).items():
    if age(v.get("heartbeat", "")) <= 1800:
        out.append(f"  • {v.get('tool', k)} en rama '{v.get('branch','?')}' (heartbeat {v.get('heartbeat','?')})")
print("\n".join(out))
PY
)"
    fi

    # stash es recuperable (git stash list) → solo aviso, no bloqueo
    if printf '%s' "$full" | grep -Eq "${boundary}git[[:space:]]+stash"; then
      echo "[coordination] AVISO: '$full' con árbol sucio; stash es recuperable con 'git stash list'." >&2
      exit 0
    fi

    if [ "${COORD_OVERRIDE:-0}" = "1" ]; then
      echo "[coordination] OVERRIDE activo — se permite '$full' pese al árbol sucio." >&2
      exit 0
    fi

    {
      echo "[coordination] BLOQUEADO: '$full' destruiría cambios sin commitear del working tree compartido."
      echo
      echo "Cambios en riesgo:"
      printf '%s\n' "$dirty" | sed 's/^/  /'
      if [ -n "$others" ]; then
        echo
        echo "Sesiones vivas detectadas:"
        printf '%s\n' "$others"
      fi
      echo
      echo "Esto es lo que causó pérdida de trabajo entre sesiones Claude/opencode."
      echo "Antes de continuar, preservá el trabajo:"
      echo "  • git add -A && git commit -m '...'   (recomendado), o"
      echo "  • git stash -u                        (recuperable con git stash list)"
      echo
      echo "Forzar de todos modos: COORD_OVERRIDE=1 <comando>"
    } >&2
    exit 2
    ;;

  *)
    echo "uso: coordination.sh {register|heartbeat|release|list|guard-git} ..." >&2
    exit 1
    ;;
esac
