#!/usr/bin/env bash
# Validación de accionables US-03 — QA RED
# Este script verifica que los 22 accionables estén correctamente asignados
# a los 7 agentes en AGENTS.md y skills/SKILL.md
#
# Debe FALLAR (exit != 0) si algún accionable falta o está mal asignado.

set -eo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FAILURES=0
PASSES=0

pass() { echo "  ✅ $1"; PASSES=$((PASSES + 1)); }
fail() { echo "  ❌ $1"; FAILURES=$((FAILURES + 1)); }

echo ""
echo "=== Validación US-03: 22 Accionables por Agente ==="
echo ""

# ── Test 1: AGENTS.md existe ──────────────────────────────────────────────
echo "── AGENTS.md"
if [ -f ".claude/AGENTS.md" ]; then
  pass "AGENTS.md existe"
else
  fail "AGENTS.md NO existe"
  echo "ABORT: AGENTS.md es requerido"
  exit 1
fi

# ── Test 2: AGENTS.md tiene los 22 accionables ────────────────────────────
for id in A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15 A16 A17 A18 A19 A20 A21 A22; do
  if grep -q "\*\*$id\*\*" .claude/AGENTS.md; then
    pass "AGENTS.md contiene $id"
  else
    fail "AGENTS.md NO contiene $id"
  fi
done

# ── Test 3: Referencia cruzada ────────────────────────────────────────────
echo ""
echo "── Referencia cruzada agentes → accionables"

check_crossref() {
  local agent="$1"
  shift
  for acc in "$@"; do
    if grep -A1 "$agent" .claude/AGENTS.md | grep -q "$acc"; then
      pass "Crossref: $agent ← $acc"
    else
      fail "Crossref: $agent NO tiene $acc en tabla"
    fi
  done
}

check_crossref "explore" A1 A2 A3
check_crossref "architect" A4 A5 A6
check_crossref "qa" A7 A8 A9
check_crossref "backend / frontend" A10 A11 A12
check_crossref "task" A13 A14 A15
check_crossref "pipeline-enforcer" A16 A17
check_crossref "principal" A18 A19 A20 A21 A22

# ── Test 4: architect-learnings tiene A4, A5, A6 ──────────────────────────
echo ""
echo "── architect-learnings/SKILL.md"
for id in A4 A5 A6; do
  if grep -q "\*\*$id\*\*" .claude/skills/architect-learnings/SKILL.md; then
    pass "architect-learnings contiene $id"
  else
    fail "architect-learnings NO contiene $id"
  fi
done

# ── Test 5: qa-learnings tiene A7, A8, A9 ─────────────────────────────────
echo ""
echo "── qa-learnings/SKILL.md"
for id in A7 A8 A9; do
  if grep -q "\*\*$id\*\*" .claude/skills/qa-learnings/SKILL.md; then
    pass "qa-learnings contiene $id"
  else
    fail "qa-learnings NO contiene $id"
  fi
done

# ── Test 6: backend-learnings tiene A10, A11, A12 ─────────────────────────
echo ""
echo "── backend-learnings/SKILL.md"
for id in A10 A11 A12; do
  if grep -q "\*\*$id\*\*" .claude/skills/backend-learnings/SKILL.md; then
    pass "backend-learnings contiene $id"
  else
    fail "backend-learnings NO contiene $id"
  fi
done

# ── Test 7: frontend-learnings tiene A10, A11, A12 ────────────────────────
echo ""
echo "── frontend-learnings/SKILL.md"
for id in A10 A11 A12; do
  if grep -q "\*\*$id\*\*" .claude/skills/frontend-learnings/SKILL.md; then
    pass "frontend-learnings contiene $id"
  else
    fail "frontend-learnings NO contiene $id"
  fi
done

# Verificar que frontend-learnings NO tiene A14 (es de task agent)
if grep -q "A14" .claude/skills/frontend-learnings/SKILL.md; then
  fail "frontend-learnings contiene A14 incorrectamente (A14 es de task agent)"
fi

# ── Test 8: pipeline-enforcer.js tiene A16 ─────────────────────────────────
echo ""
echo "── pipeline-enforcer.js A16 (merge exception)"
if grep -q "hasUnmergedFiles" .opencode/plugins/pipeline-enforcer.js; then
  pass "pipeline-enforcer.js tiene hasUnmergedFiles()"
else
  fail "pipeline-enforcer.js NO tiene hasUnmergedFiles()"
fi

# ── Test 9: pipeline-enforcer.js tiene A17 ─────────────────────────────────
echo ""
echo "── pipeline-enforcer.js A17 (ignore state.json)"

# Extraer el bloque tool.execute.before para inspeccionarlo
TOOL_BEFORE_BLOCK=$(awk '/"tool\.execute\.before".*async.*=>/,/^\s*\},/' .opencode/plugins/pipeline-enforcer.js)

if echo "$TOOL_BEFORE_BLOCK" | grep -q "state.json\|close-pending"; then
  pass "pipeline-enforcer.js A17: ignora state.json/close-pending en tool.execute.before"
else
  fail "pipeline-enforcer.js A17: NO ignora state.json en tool.execute.before"
fi

# ── Resumen ────────────────────────────────────────────────────────────────
echo ""
echo "====================================="
echo "  Resultado: $PASSES passed, $FAILURES failed"
echo "====================================="

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "⚠️  US-03 QA RED: $FAILURES accionables faltan o están mal asignados."
  echo "    Las condiciones de aceptación NO se cumplen."
  exit 1
else
  echo ""
  echo "✅ US-03 QA GREEN: todos los accionables están correctamente asignados."
  exit 0
fi
