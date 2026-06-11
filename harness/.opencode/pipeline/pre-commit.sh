#!/bin/bash
# Pre-commit hook for git (multi-scope)
# Blocks commits if any scope's pipeline is still in progress.
# Install: ln -sf ../../.opencode/pipeline/pre-commit.sh .git/hooks/pre-commit
# Or:     git config core.hooksPath .opencode/pipeline

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: Pipeline state file not found at $STATE_FILE"
  echo "Run the pipeline first (todowrite) before committing."
  exit 1
fi

PIPELINE_STATUS=$(python3 -c "
import json
state = json.load(open('$STATE_FILE'))
scopes = state.get('scopes', {})
# Block commit if any scope is still active (not completed)
active_scopes = [name for name, s in scopes.items() if s.get('active', False)]
if active_scopes:
    print('active:' + ','.join(active_scopes))
else:
    print('inactive')
" 2>/dev/null)

if [[ "$PIPELINE_STATUS" == active:* ]]; then
  ACTIVE_SCOPES="${PIPELINE_STATUS#active:}"
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  COMMIT BLOQUEADO: Pipeline(s) en progreso                 ║"
  echo "║  Scopes activos: $ACTIVE_SCOPES"
  echo "║                                                              ║"
  echo "║  Completa TODOS los pipelines antes de commitear.           ║"
  echo "║  Si terminaste, marca los todos como 'completed'            ║"
  echo "║  en todowrite para cerrar cada scope.                       ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi

echo "✓ Pipeline check: OK"

# ── Validación de hardcodeos ─────────────────────────────────────────────────
# Escanea archivos staged en busca de paths absolutos, sockets hardcodeados,
# y nombres de contenedor con prefijo de proyecto.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HARDCODE_SCRIPT="$ROOT/scripts/validate-hardcodes.sh"

if [ -x "$HARDCODE_SCRIPT" ]; then
  STAGED_FILES=$(git diff --cached --name-only)
  if [ -n "$STAGED_FILES" ]; then
    echo ""
    echo "--- Hardcode validation ---"
    # Pasar archivos staged al script de validación
    HARDCODE_OUTPUT=$(echo "$STAGED_FILES" | xargs "$HARDCODE_SCRIPT" 2>&1) || {
      echo "$HARDCODE_OUTPUT"
      echo ""
      echo "╔══════════════════════════════════════════════════════════════╗"
      echo "║  COMMIT BLOQUEADO: Hardcodeos detectados                   ║"
      echo "║                                                              ║"
      echo "║  Corregí los hardcodeos antes de commitear.                 ║"
      echo "║  Si un hardcodeo es legítimo, agregá:                       ║"
      echo "║    # hardcode-ok: <razón>                                   ║"
      echo "║  en el archivo afectado.                                    ║"
      echo "║  Archivos en allowlist: .claude/settings.local.json         ║"
      echo "╚══════════════════════════════════════════════════════════════╝"
      exit 1
    }
    echo "$HARDCODE_OUTPUT"
  fi
fi

exit 0
