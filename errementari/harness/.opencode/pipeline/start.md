# Start checklist — Paso 0 del pipeline

Ejecutar **antes de crear el spec** (antes del Paso 1/6).
Aplica tanto a `feature` como a `bugfix`.

## Pasos

### 1. Pre-flight check

```bash
bash .opencode/pipeline/pre-spec.sh
```

Si el script sale con error, **detener aquí**. Resolver cada issue antes de continuar:

| Issue | Cómo resolverlo |
|---|---|
| Working tree sucio | `git add . && git commit` o `git stash -u` |
| PRs abiertos | Mergear, cerrar o esperar decisión del equipo |
| Commits huérfanos en dev (feat/fix) | Crear PR para capturarlos: `gh pr create --base main --head dev`. Son un **FAIL duro** — no se puede iniciar un spec hasta que dev esté limpio de feature work no mergeado a main |
| Commits huérfanos (chore/learnings) | Ignorar — son artefactos de integración, no feature work |
| Cierre pendiente | Ejecutar `close.md` para el scope indicado |
| dev detrás de origin/main | `git checkout dev && git merge origin/main --no-edit` |

### 2. Crear rama desde `origin/main`

```bash
git fetch origin main
git checkout -b <tipo>/<slug> origin/main
```

**Convención de nombre:**
- `feature/<descripcion-corta-kebab>`
- `fix/<descripcion-corta-kebab>`
- `chore/<descripcion-corta-kebab>`

⚠️ **Nunca** desde `dev`, `main` local, ni desde otra feature branch.
Branching desde `dev` hereda commits de otras features y causa conflictos pesados al mergear a `main`.

### 3. Continuar con el pipeline normal

- **feature/bugfix:** avanzar al Paso 1/6 (`/spec-generator` o triage)
- **chore:** ejecutar directamente (`scope → ejecutar → verify → close`)
