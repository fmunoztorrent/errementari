---
name: scope-orchestrator
description: Orquestador de descomposición y paralelización de scopes. Use when a spec has 3+ independent user stories (USTs) that need to be processed in parallel via task tool, or when a conversation detects multiple independent tasks that should each get their own scope. Front-loads keywords: "descomponer", "multi-scope", "paralelizar", "orquestar scopes", "spec grande", "muchas USTs".
---

# scope-orchestrator

Orquesta la ejecución de specs con **≥3 USTs independientes** descomponiéndolas en scopes paralelos. Complementa el pipeline `feature`/`bugfix` clásico: en vez de un solo flujo para el spec entero, dispara N sub-agentes (uno por UST) y sincroniza por capas topológicas.

**Cuándo invocar este skill:**
- Spec detectado con `## Dependencias entre USTs` con ≥3 USTs sin dependencias
- Conversación donde el usuario lista múltiples tareas no relacionadas
- Cualquier situación donde tratar todo como un solo flujo degradaría la calidad (contexto lleno) o velocidad (USTs independientes en serie)

**NO invocar si:**
- El spec tiene 1-2 USTs (overhead de N scopes > beneficio)
- Todas las USTs son dependientes en cascada estricta (no hay paralelización posible — un solo scope alcanza)

---

## Reglas activas

### Accionables del agente task (subagentes)

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A13** | Antes de `pnpm add`, verificar en `package.json` si la dependencia ya existe. Si existe, NO reinstalar con versión diferente. Si no existe, leer `android/build.gradle` para verificar kotlinVersion y buscar la versión máxima compatible | **ALTA** |
| **A14** | Regla: NUNCA simplificar o reemplazar archivos existentes que no están en el scope de la tarea. Si un archivo necesita cambios, aplicar la mínima modificación posible con `edit` (no `write` completo) | **ALTA** |
| **A15** | El prompt del task agent debe incluir el hash del commit base (`HEAD`) para que pueda hacer `git diff` y ver qué ya fue modificado por otros agents | **MEDIA** |

---

## Paso 1 — Análisis de dependencias

Leer la sección `## Dependencias entre USTs` del spec (si no existe, el architect la agrega primero). Construir la tabla:

| UST | Depende de | Capa |
|-----|-----------|------|
| US-01 | — | 1 |
| US-02 | — | 1 |
| US-03 | US-01 | 2 |
| US-04 | US-02 | 2 |

**Algoritmo de capas (orden topológico):**
1. Capa 1 = USTs sin dependencias (`Depende de: —`)
2. Capa N = USTs cuyas dependencias están todas en capas <N
3. Repetir hasta asignar todas las USTs a una capa

Si el spec no tiene la sección `## Dependencias entre USTs`, **agregarla antes de continuar** siguiendo el formato de la tabla. Inferir las dependencias del contexto: una UST que importa tipos, schemas o adapters de otra UST depende de ella.

---

## Paso 2 — Crear todowrite multi-scope

Cada UST en cada capa se convierte en un scope con prefijo `[scope:id]`. El `todowrite` debe tener todos los scopes visibles, con `▶` marcando el primer paso de los scopes de capa 1.

**Convención de nombres** (regex del plugin: `[\w.-]+`, no soporta `/`):
- `feature-<ust-slug>` para features
- `bugfix.<ust-slug>` para bugfixes
- Ejemplo: US-01 sobre login con Google → `[feature-login-google]`

**Ejemplo de todowrite con 4 USTs (2 capa 1 + 2 capa 2):**

```
[feature-login-google]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad
[ ] 3/6 QA (RED) → tests que fallan
[ ] 4/6 Backend → implementar
[ ] 5/6 QA (GREEN) → suite completa
[ ] 6/6 Cierre → close.md

[feature-notif-push]
[▶] 1/6 Spec Generator
[ ] 2/6 Architect
[ ] 3/6 QA (RED)
[ ] 4/6 Backend
[ ] 5/6 QA (GREEN)
[ ] 6/6 Cierre

[feature-sse-reconnect]
(depdende de feature-login-google, se procesa en capa 2)

[bugfix.price-validation]
(depdende de feature-login-google, se procesa en capa 2)
```

---

## Paso 3 — Procesar capa 1 en paralelo

Para cada scope de capa 1, invocar el `task` tool de opencode en **una sola respuesta** (paralelismo a nivel de tool calls).

**Prompt template para el sub-agente:**

```text
Eres un sub-agente del orquestador multi-scope. Tu scope es: {SCOPE_NAME}

Spec: {SPEC_PATH}
USTs a implementar: {UST_IDS} (ej. US-01, US-02)
Dependencias satisfechas: {LISTA DE USTs YA COMPLETADAS, vacío si es capa 1}
Archivos esperados a modificar: {LISTA DE ARCHIVOS O CARPETAS DEL SPEC}

Pasos obligatorios (ejecutar en orden, no saltar ninguno):
1. Crea tu propio todowrite con prefijo [{SCOPE_NAME}] y los 6 pasos del pipeline feature
2. Lee {SPEC_PATH} completo y enfócate solo en las USTs {UST_IDS}
3. Pasa por architect → qa (RED) → implementación → qa (GREEN) → cierre
4. Al cerrar, sigue las instrucciones de .opencode/pipeline/close.md
5. NO modifiques archivos fuera de los listados arriba
6. Si necesitas claridad, pregunta al agente padre antes de implementar

Devuelve un resumen al terminar: USTs implementadas, archivos creados/modificados, tests pasando.
```

**Sincronización:** el `task` tool bloquea hasta que el sub-agente termina. Cuando todos los `task` de capa 1 retornan, el agente padre continúa con la capa 2.

---

## Paso 4 — Procesar capas siguientes

Para cada capa N > 1, repetir paso 3 con los scopes de esa capa. El prompt del sub-agente debe incluir la lista de USTs ya completadas (las dependencias satisfechas) para que sepa que puede proceder.

**Sincronización entre capas:** leer `.opencode/pipeline/state.json` para confirmar que los scopes de la capa anterior tienen `completed_at`. Si falta alguno, **no procesar la capa N hasta que la capa N-1 esté completa**.

---

## Paso 5 — Cierre de todos los scopes

Cuando la última capa termina, **cada sub-agente ejecuta su propio close.md** (merge a dev, PR, etc.). El agente padre no necesita repetirlo.

**Anuncio final al usuario:**

```
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Spec procesado · N scopes completados
  Capa 1: US-01 ✓, US-02 ✓ (paralelo)
  Capa 2: US-03 ✓, US-04 ✓ (paralelo, después de capa 1)
  PRs abiertos: N
  Próximo: revisar PRs y mergear
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

---

## Limitaciones y fallbacks

- **El `task` tool no existe en Claude Code** — este skill solo aplica a opencode. En Claude Code, tratar el spec como un solo scope.
- **El plugin `pipeline-enforcer` debe estar arreglado** (hook `todo.updated` → `tool.execute.after`) para que el `state.json` se actualice correctamente. Si no, el `pipeline_active` flag nunca se activa y los `edit`/`write` se bloquean.
- **Sub-agentes no heredan el contexto conversacional** — pasar el spec path y los archivos esperados en el prompt.
- **Race conditions en `state.json`**: el plugin usa `writeFileSync` síncrono, así que debería ser seguro, pero si se observa corrupción, agregar un mutex simple.
- **Si una UST falla en su scope**: marcar el scope como `blocked` en su todowrite, no procesar las USTs que dependen de ella, reportar al usuario.

---

## Ejemplo de invocación

```text
/usar scope-orchestrator

El spec spec/2026-06-04-foo.spec.md tiene 4 USTs:
- US-01: login con Google (independiente)
- US-02: notificaciones push (independiente)
- US-03: SSE reconnect (depende de US-01)
- US-04: validación de precio (depende de US-02)

Procesar capa 1 (US-01, US-02) en paralelo. Cuando ambos terminen,
procesar capa 2 (US-03, US-04) en paralelo.
```
