#!/usr/bin/env bash
# pre-spec.sh — Pre-flight check antes de iniciar una nueva spec/pipeline.
# Uso: bash .opencode/pipeline/pre-spec.sh
# Sale 0 si todo está OK, 1 si hay algún problema.

set -euo pipefail

PASS="✓"
FAIL="✗"
WARN="⚠"
ok=true

echo ""
echo "── pre-spec: verificación de estado ──────────────────────────────"

# ── Check 1: Working tree limpio ──────────────────────────────────────
dirty=$(git status --porcelain 2>/dev/null)
if [ -z "$dirty" ]; then
  echo "  $PASS Working tree limpio"
else
  echo "  $FAIL Working tree sucio — commitea o stash antes de continuar:"
  git status --short | sed 's/^/       /'
  ok=false
fi

# ── Check 2: Sin PRs abiertos ─────────────────────────────────────────
if command -v gh &>/dev/null; then
  open_prs=$(gh pr list --json number,title,headRefName 2>/dev/null || echo "[]")
  pr_count=$(echo "$open_prs" | grep -c '"number"' || true)
  if [ "$pr_count" -eq 0 ]; then
    echo "  $PASS Sin PRs abiertos"
  else
    echo "  $FAIL Hay $pr_count PR(s) abierto(s) — mergea o cierra antes de continuar:"
    echo "$open_prs" | grep -E '"number"|"title"|"headRefName"' | paste - - - | \
      sed 's/.*"number":[[:space:]]*\([0-9]*\).*"title":[[:space:]]*"\([^"]*\)".*"headRefName":[[:space:]]*"\([^"]*\)".*/       #\1  \2  (\3)/' 2>/dev/null || \
      echo "$open_prs" | sed 's/^/       /'
    ok=false
  fi
else
  echo "  $WARN gh CLI no disponible — no se pudo verificar PRs abiertos"
fi

# ── Check 3: dev no debe tener commits feature/fix huérfanos ─────────
# Busca commits no-merge en dev que no estén en origin/main.
# Merge commits de integración (merge: X → dev) son esperados y se ignoran.
#
# Clasificación: feature/fix → FAIL (necesitan PR a main)
#                 chore/learnings → WARN (artefactos de integración)
git fetch origin main --quiet 2>/dev/null || true
orphans=$(git log origin/main..dev --no-merges --oneline 2>/dev/null || true)
if [ -z "$orphans" ]; then
  echo "  $PASS Sin commits huérfanos en dev"
else
  # Clasificar los commits por tipo
  feature_orphans=""
  safe_orphans=""
  while IFS= read -r line; do
    if echo "$line" | grep -qiE '^(feat|fix|feature|bugfix)'; then
      feature_orphans="$feature_orphans$line"$'\n'
    else
      safe_orphans="$safe_orphans$line"$'\n'
    fi
  done <<< "$orphans"

  if [ -n "$feature_orphans" ]; then
    echo "  $FAIL dev tiene feature/fix commits no mergeados a main:"
    echo "$feature_orphans" | sed '/^$/d' | sed 's/^/       /'
    echo "       Estos commits deben estar en un PR hacia main antes de iniciar."
    echo "       Ejecuta: gh pr create --base main --head dev"
    ok=false
  fi

  if [ -n "$safe_orphans" ]; then
    echo "  $WARN dev tiene otros commits no-merge (chore/learnings):"
    echo "$safe_orphans" | sed '/^$/d' | sed 's/^/       /'
    echo "       Artefactos de integración — puedes ignorar o hacer push a dev."
  fi
fi

# ── Check 4: Sin cierre pendiente ────────────────────────────────────
close_pending=".opencode/pipeline/close-pending.json"
if [ -f "$close_pending" ]; then
  scope=$(grep '"scope"' "$close_pending" 2>/dev/null | sed 's/.*"scope":[[:space:]]*"\([^"]*\)".*/\1/' || echo "desconocido")
  echo "  $FAIL Cierre pendiente del scope '$scope' — ejecuta close.md antes de continuar"
  ok=false
else
  echo "  $PASS Sin cierre pendiente"
fi

# ── Check 5: dev en sync con origin/main ─────────────────────────────
dev_sha=$(git rev-parse dev 2>/dev/null || echo "no-existe")
main_sha=$(git rev-parse origin/main 2>/dev/null || echo "no-existe")
if [ "$dev_sha" = "no-existe" ]; then
  echo "  $WARN Rama 'dev' no existe localmente — se creará desde main al cerrar"
elif git merge-base --is-ancestor origin/main dev 2>/dev/null; then
  echo "  $PASS dev contiene origin/main (puede tener commits locales adicionales)"
else
  echo "  $FAIL dev está detrás de origin/main — ejecuta: git checkout dev && git merge origin/main"
  ok=false
fi

echo "──────────────────────────────────────────────────────────────────"

if [ "$ok" = true ]; then
  echo "  $PASS pre-spec OK — puedes iniciar una nueva spec"
  echo ""
  exit 0
else
  echo "  $FAIL pre-spec FALLÓ — resuelve los issues de arriba antes de continuar"
  echo ""
  exit 1
fi
