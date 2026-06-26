#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# validate-hardcodes.sh
# Escanea archivos en busca de hardcodeos prohibidos (paths absolutos,
# sockets hardcodeados, nombres de contenedor con prefijo).
#
# Uso:
#   bash scripts/validate-hardcodes.sh archivo1.txt archivo2.js
#   git diff --cached --name-only | xargs bash scripts/validate-hardcodes.sh
#
# Patrones definidos en: .opencode/pipeline/hardcode-patterns.json
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PATTERNS_FILE="$ROOT/.opencode/pipeline/hardcode-patterns.json"
FOUND_HARDCODE=0

# ── Carga de patrones desde JSON ────────────────────────────────────────────

if [ ! -f "$PATTERNS_FILE" ]; then
  echo "ERROR: Archivo de patrones no encontrado: $PATTERNS_FILE" >&2
  exit 1
fi

# Extrae los patrones del JSON usando python3
# Usa § como delimitador porque | aparece en las regex
PATTERNS=$(python3 -c "
import json, sys
with open('$PATTERNS_FILE') as f:
    data = json.load(f)
for p in data['patterns']:
    print(f\"{p['id']}§{p['regex']}§{p['suggestion']}\")
")

# Extrae la allowlist de archivos
ALLOWLIST_FILES=$(python3 -c "
import json
with open('$PATTERNS_FILE') as f:
    data = json.load(f)
for f in data['allowlist']['files']:
    print(f)
" 2>/dev/null || echo "")

ALLOWLIST_COMMENTS=$(python3 -c "
import json
with open('$PATTERNS_FILE') as f:
    data = json.load(f)
for c in data['allowlist']['comments']:
    print(c)
" 2>/dev/null || echo "")

# ── Funciones ────────────────────────────────────────────────────────────────

# Verifica si un archivo está en la allowlist (solo por nombre de archivo)
is_allowlisted() {
  local file="$1"

  # Allowlist por nombre de archivo
  for allowed in $ALLOWLIST_FILES; do
    if [[ "$file" == *"$allowed"* ]]; then
      return 0
    fi
  done

  return 1
}

# Escanea un archivo contra los patrones cargados
scan_file() {
  local file="$1"

  if [ ! -f "$file" ]; then
    echo "  [skip] $file (no existe)"
    return
  fi

  if is_allowlisted "$file"; then
    echo "  [ ok ] $file (allowlist)"
    return
  fi

  local file_had_hardcode=0

  while IFS='§' read -r id regex suggestion; do
    if [ -z "$id" ]; then continue; fi

    # Busca el patrón en el archivo, excluyendo líneas con allowlist comments
    local matches
    matches=$(grep -nE "$regex" "$file" 2>/dev/null | grep -v "$ALLOWLIST_COMMENTS" || true)

    if [ -n "$matches" ]; then
      while IFS= read -r line; do
        local lineno="${line%%:*}"
        echo "  [FAIL] $file:$lineno — $id"
        echo "         $suggestion"
        FOUND_HARDCODE=1
        file_had_hardcode=1
      done <<< "$matches"
    fi
  done <<< "$PATTERNS"

  if [ "$file_had_hardcode" -eq 0 ]; then
    echo "  [ ok ] $file"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

if [ $# -eq 0 ]; then
  echo "Uso: validate-hardcodes.sh <archivo1> [archivo2 ...]"
  echo ""
  echo "Escanea archivos en busca de hardcodeos prohibidos."
  echo "Patrones definidos en: $PATTERNS_FILE"
  echo ""
  echo "También se puede usar con git diff:"
  echo "  git diff --cached --name-only | xargs $0"
  exit 0
fi

echo "=== validate-hardcodes ==="

# Si se pasa "-" como argumento, leer archivos de stdin
if [ "$1" = "-" ]; then
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    scan_file "$file"
  done
else
  for file in "$@"; do
    scan_file "$file"
  done
fi

echo ""

if [ "$FOUND_HARDCODE" -eq 0 ]; then
  echo "✅ Sin hardcodeos detectados."
  exit 0
else
  echo "❌ Se encontraron hardcodeos. Corregilos antes de commitear."
  echo ""
  echo "Reglas documentadas en: CLAUDE.md §Validaciones automáticas"
  exit 1
fi
