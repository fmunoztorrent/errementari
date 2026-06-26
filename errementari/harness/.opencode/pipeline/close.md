# Close checklist

Ejecutar **inmediatamente** cuando el último todo de un scope se marca como `completed`.

## Pasos

> **Precondición:** El paso **5b/6 Validación Empírica** (`.opencode/pipeline/validate-empirica.md`) debe haberse ejecutado y pasado todos los checks antes de iniciar el cierre. Si 5b falló, el pipeline volvió a QA RED y NO se debe cerrar.

### 1. Actualizar spec (si aplica)

- Buscar el spec relacionado en `spec/` por fecha/asunto (formato: `<YYYY-MM-DD>-<slug>.spec.xml`)
- Agregar entradas en `<result>`:
  - `<completed-at>`: fecha de finalización
  - `<implemented>`: USTs completadas con `[x]`
  - `<deviations>`: si las hay
  - `<tests>`: resumen de resultados
- Cambiar `spec@status` de `draft` a `completed`
- Marcar `<meta>/<archived>` como `true`
- Incrementar `spec@revision` y agregar `<revision>` en `<history>`
- **Mover el archivo** de `spec/<archivo>.spec.md` a `spec/archived/<archivo>.spec.md`
- Si no hay spec asociado, saltar este paso

### 2. Fusionar rama actual en `dev` local (integración)

> **⚠️ `dev` es permanente.** La rama `dev` **nunca** se elimina. Al limpiar
> ramas después de una consolidación, solo se borran feature/bugfix/chore;
> `dev` y `main` se preservan siempre.

- **Objetivo:** integrar la rama actual a la rama `dev` local como punto de
  integración temprana, antes de que el PR entre a review.
- Ejecutar el helper: `.opencode/pipeline/merge-to-dev.sh`
- El script se encarga de:
  - Si la rama actual es `main` o `dev`: no hacer nada (evita noop).
  - Si `dev` no existe: crearla desde `main` (`git branch dev main`).
  - Si `dev` existe: hacer `git merge --no-ff` de la rama actual hacia `dev`.
  - Si hay conflicto: aborta el merge (`git merge --abort`) y devuelve exit 2.
- **⛔ Si `merge-to-dev.sh` retorna exit 2 (conflicto): STOP — no continuar al
  paso 2b ni al 3.** Resolver el conflicto primero, luego reanudar desde este paso.
- Al terminar sin conflicto, el worktree vuelve a la rama original automáticamente.
- **Solo local:** este paso no hace `git push`. El push queda para cuando
  se decida sincronizar el remoto (no se hace por defecto en el cierre).
- Si se trabajó directamente en `main` sin spec, saltar este paso.

### 2b. Verificar cobertura del PR (commits capturados)

> Este paso previene commits huérfanos en `dev` — el problema donde trabajo
> hecho post-merge nunca llega a un PR.

```bash
git log origin/main..HEAD --no-merges --oneline
```

- Si la lista está **vacía**: no hay nada nuevo que subir — el PR no es necesario
  (solo cambios de integración), saltar al paso 3 y omitir el push.
- Si la lista tiene commits: **confirmar que todos están relacionados con esta feature**.
  - Si hay commits que no deberían estar en esta rama (ej. se hicieron en `dev`
    y no en la feature branch): **STOP** — mover esos commits a la rama correcta
    antes de crear el PR.
- Registrar mentalmente los commits para verificar que el PR los incluye todos.

### 3. Crear Pull Request

- Si se trabajó en una rama ad-hoc (no `main`):
  - `git push -u origin HEAD`
  - Abrir PR en GitHub/GitLab usando `gh` o el navegador
  - Asegurar que el PR apunte a `main` (no a `dev` — `dev` es solo integración local)
- Si se trabajó directamente en `main` (solo cambios triviales sin spec), saltar este paso
- No mergear el PR aún — marcar como "ready for review"

### 3b. Post-merge: sincronizar dev con main

Ejecutar **después de que el PR sea mergeado a `main`** (puede ser inmediato o diferido):

```bash
git fetch origin main
git checkout dev
git merge origin/main --no-edit
```

Luego verificar que no quedaron commits huérfanos:

```bash
git log origin/main..dev --no-merges --oneline
```

- Si la lista está **vacía**: dev está limpio. ✓
- Si hay commits de feature/fix: son huérfanos — crear un PR adicional para capturarlos.
- Si hay commits de chore/learnings (archivar specs, auto-update hooks): son artefactos
  legítimos de integración, no requieren PR adicional.

### 4. Entrada en LEARNINGS.md

- Abrir `.claude/LEARNINGS.md`
- Agregar entrada al final con el template estándar:

```markdown
---
date: YYYY-MM-DD
agent: agent-type
category: setup | pattern | api-gotcha | test-strategy | security-finding | spec-process | user-feedback
tags: [tag1, tag2]
slug: descripcion-corta-en-kebab-case
---

**Contexto**: qué estaba haciendo cuando lo descubrí.
**Qué pasó**: el comportamiento sorpresivo, el error, o la decisión.
**Lección**: qué hacer / no hacer en el futuro.
**Cómo aplicar**: en qué situaciones específicas recordar esto.
```

- Preguntar al usuario si quiere agregar algo
- Solo agregar si hay una lección no obvia

### 4b. Extraer learning a skill de agente

- Ejecutar la extracción automática: `npx tsx scripts/extract-learnings.ts`
- Esto lee la última entrada de LEARNINGS.md y actualiza el skill correspondiente en `.claude/skills/{agent}-learnings/SKILL.md`
- Si una lección aparece por segunda vez, el script la promueve automáticamente a "Reglas activas"
- Si una lección aparece por tercera vez, el script la agrega a "Accionables bloqueantes" en `.claude/AGENTS.md`
- La extracción también se ejecuta automáticamente vía hooks del plugin y de Claude Code. Este paso manual es un fallback.

### 4c. Automejora post-cierre (Paso 7)

El paso 4b ejecuta `extract-learnings.ts`, que implementa 3 niveles de
promoción automática de aprendizajes:

| Nivel | Condición | Acción | Archivo afectado |
|-------|-----------|--------|-----------------|
| **1** | 1ª ocurrencia de un slug | Agrega a "Lecciones recientes" | `.claude/skills/{agent}-learnings/SKILL.md` |
| **2** | 2ª ocurrencia (≥2) | Mueve a "Reglas activas" con marcador `(x2,)` | `.claude/skills/{agent}-learnings/SKILL.md` |
| **3** | 3ª ocurrencia (≥3) | Agrega a "Accionables bloqueantes" | `.claude/AGENTS.md` |

Después de ejecutar `npx tsx scripts/extract-learnings.ts`, revisar la salida:

- Si la salida menciona **"level 3"** o **"AGENTS.md"**: revisar `.claude/AGENTS.md`
  para confirmar que la entrada se agregó correctamente en la tabla de
  `## Accionables bloqueantes (Nivel 3 — Auto-generados)`.
- Si la salida menciona **"level 2"** o **"Reglas activas"**: revisar el skill
  correspondiente en `.claude/skills/{agent}-learnings/SKILL.md`.
- Si la salida menciona **"level 1"**: es una lección nueva, sin acción adicional.

Commitear los cambios generados (skills actualizados + `AGENTS.md` si aplica).
Si no hubo promociones (salida "nothing to do" o "skipping"), este paso no produce cambios.

El pipeline se vuelve más estricto con cada error que se repite 3 veces:
la tabla de accionables bloqueantes sirve como referencia para futuros
agentes y puede integrarse en validaciones automáticas.

### 6. Revisar CLAUDE.md

- ¿Cambió algo en la estructura del proyecto?
- ¿Nuevos comandos que documentar?
- ¿Nuevas convenciones o patrones?
- ¿Nuevos skills configurados?
- Actualizar solo si es relevante

### 7. Limpiar close-pending

- **Eliminar** `.opencode/pipeline/close-pending.json`:
  ```bash
  rm -f .opencode/pipeline/close-pending.json
  git add .opencode/pipeline/close-pending.json
  ```
- El historial de cierre queda en git (el commit que elimina el archivo) — no se necesita preservar el JSON.
- Marcar `completed_at` en state.json para el scope cerrado.

### 8. Anunciar cierre

```
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Cierre completado · <scope>
  Spec: actualizado | no aplica
  Merge a dev: OK | no aplica | conflict|reportado a usuario
  PR: abierto | no aplica
  LEARNINGS.md: entrada agregada | sin cambios
  CLAUDE.md: actualizado | sin cambios
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```
