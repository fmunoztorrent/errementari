#!/bin/bash
# merge-to-dev.sh
# Fusiona la rama actual hacia la rama local 'dev', creándola desde 'main' si no existe.
# Uso: .opencode/pipeline/merge-to-dev.sh
#
# Comportamiento:
#   - Si estamos en 'main' o 'dev': no hace nada (no se mergea a sí mismo).
#   - Si 'dev' no existe: la crea desde 'main' (rama de integración nueva).
#   - Si 'dev' existe: hace merge --no-ff de la rama actual hacia 'dev'.
#   - Si hay conflicto: aborta el merge y devuelve exit != 0.
#   - Al final, devuelve al worktree a la rama original.
#
# Diseñado para ejecutarse en el paso 3 del close.md (cierre de spec).

set -euo pipefail

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Guard: no tiene sentido mergear a sí mismo
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "dev" ]; then
  echo "[merge-to-dev] Estás en '$CURRENT_BRANCH'; no se hace merge a 'dev'."
  exit 0
fi

# Verificar que hay commits sobre los que mergear (defensa básica)
if ! git show-ref --verify --quiet "refs/heads/$CURRENT_BRANCH"; then
  echo "[merge-to-dev] ERROR: rama '$CURRENT_BRANCH' no encontrada." >&2
  exit 1
fi

echo "[merge-to-dev] Rama actual: $CURRENT_BRANCH"

if git show-ref --verify --quiet refs/heads/dev; then
  echo "[merge-to-dev] 'dev' ya existe; haciendo merge --no-ff de '$CURRENT_BRANCH' a 'dev'..."
  git checkout dev
  if ! git merge --no-ff "$CURRENT_BRANCH" -m "merge: $CURRENT_BRANCH into dev"; then
    echo "" >&2
    echo "[merge-to-dev] CONFLICTO al fusionar '$CURRENT_BRANCH' en 'dev'." >&2
    echo "[merge-to-dev] Merge abortado. Resolver manualmente antes de continuar." >&2
    git merge --abort 2>/dev/null || true
    git checkout "$CURRENT_BRANCH"
    exit 2
  fi
else
  echo "[merge-to-dev] 'dev' no existe; creándola desde 'main'..."
  git branch dev main
  echo "[merge-to-dev] 'dev' creada. Ahora fusionando '$CURRENT_BRANCH'..."
  git checkout dev
  if ! git merge --no-ff "$CURRENT_BRANCH" -m "merge: $CURRENT_BRANCH into dev (initial)"; then
    echo "" >&2
    echo "[merge-to-dev] CONFLICTO al fusionar '$CURRENT_BRANCH' en 'dev' recién creada." >&2
    echo "[merge-to-dev] Merge abortado. Resolver manualmente antes de continuar." >&2
    git merge --abort 2>/dev/null || true
    git checkout "$CURRENT_BRANCH"
    exit 2
  fi
fi

git checkout "$CURRENT_BRANCH"
echo "[merge-to-dev] OK — '$CURRENT_BRANCH' fusionada en 'dev'. Volviendo a '$CURRENT_BRANCH'."
