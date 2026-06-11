import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { spawn, execSync } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_PATH = join(__dirname, "..", "pipeline", "state.json")
const CLOSE_PENDING_PATH = join(__dirname, "..", "pipeline", "close-pending.json")
const PATTERNS_PATH = join(__dirname, "..", "pipeline", "hardcode-patterns.json")
const REPO_ROOT = dirname(dirname(__dirname))

const SCOPE_REGEX = /^\[([\w.-]+)\]\s*/

const EDIT_TOOLS = new Set(["edit", "write"])

// ── Hardcode detection ────────────────────────────────────────────────────────
// Patterns defined in .opencode/pipeline/hardcode-patterns.json
// Shared source of truth with scripts/validate-hardcodes.sh

let hardcodePatterns = null
let allowlistFiles = []

function loadHardcodePatterns() {
  if (hardcodePatterns) return // cached
  try {
    if (existsSync(PATTERNS_PATH)) {
      const data = JSON.parse(readFileSync(PATTERNS_PATH, "utf-8"))
      hardcodePatterns = (data.patterns || []).map((p) => ({
        id: p.id,
        regex: new RegExp(p.regex, "gm"),
        suggestion: p.suggestion,
      }))
      allowlistFiles = data.allowlist?.files || []
    }
  } catch (e) {
    // Silently fail — don't block pipeline on pattern load error
    console.error("[pipeline-enforcer] Could not load hardcode patterns:", e.message)
  }
}

function isAllowlisted(filePath) {
  if (!allowlistFiles.length) return false
  return allowlistFiles.some((f) => filePath.includes(f))
}

function scanForHardcodes(content, filePath) {
  if (!hardcodePatterns || hardcodePatterns.length === 0) return []
  if (isAllowlisted(filePath)) return []
  // Files with an explicit # hardcode-ok comment opt out entirely
  if (/^\s*#\s*hardcode-ok:/m.test(content)) return []

  const found = []
  for (const pattern of hardcodePatterns) {
    pattern.regex.lastIndex = 0
    const match = pattern.regex.exec(content)
    if (match) {
      // Find line number
      const lineNum = content.substring(0, match.index).split("\n").length
      found.push({
        patternId: pattern.id,
        line: lineNum,
        suggestion: pattern.suggestion,
      })
    }
  }
  return found
}

function buildHardcodeErrorMessage(found, filePath) {
  const lines = found
    .map(
      (f) =>
        `  - ${filePath}:${f.line} — ${f.patternId}\n` +
        `    ${f.suggestion}`
    )
    .join("\n")

  return `Pipeline enforcement: hardcodeo(s) detectado(s) en ${filePath}.

${lines}

Reglas de portabilidad:
  - Usá rutas relativas o $(git rev-parse --show-toplevel)
  - Usá make infra o detección dinámica de motor de contenedores
  - Usá $COMPOSE exec <servicio>, no nombres de contenedor con prefijo

Si el hardcodeo es legítimo, agregá al archivo:
  # hardcode-ok: <razón>

Archivos en allowlist: ${allowlistFiles.join(", ") || "ninguno"}
`
}
// ── End hardcode detection ────────────────────────────────────────────────────

// A16: Permitir ediciones durante resolución de conflictos de merge
function hasUnmergedFiles() {
  try {
    const status = execSync("git status --porcelain", { encoding: "utf8", cwd: REPO_ROOT })
    return status.split("\n").some((line) => line.startsWith("UU "))
  } catch {
    return false
  }
}

// Pre-spec guard: corre pre-spec.sh cuando un scope nuevo se activa.
// Lanza error si el check falla — bloquea la activación del pipeline.
const PRE_SPEC_PATH = join(__dirname, "..", "pipeline", "pre-spec.sh")

function runPreSpecCheck(scopeName) {
  if (!existsSync(PRE_SPEC_PATH)) return // script aún no existe — graceful

  try {
    execSync(`bash "${PRE_SPEC_PATH}"`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "")
    throw new Error(
      `Pre-spec check falló al activar el scope '${scopeName}'.\n` +
      `Resuelve los issues antes de iniciar el pipeline:\n\n` +
      out +
      `\nEjecuta: bash .opencode/pipeline/pre-spec.sh para ver el detalle completo.\n`
    )
  }
}

function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, "utf-8"))
    }
  } catch (e) {}
  return {
    global: { pipeline_active: false },
    scopes: {
      main: { active: false, type: null, step: 0, started_at: null, completed_at: null },
    },
  }
}

function saveState(state) {
  const dir = dirname(STATE_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function parseScopeGroups(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return null

  const groups = {}
  const order = []

  for (const todo of todos) {
    const match = todo.content.match(SCOPE_REGEX)
    const name = match ? match[1] : "main"
    if (!groups[name]) {
      groups[name] = { name, todos: [], hasActive: false, allDone: true }
      order.push(name)
    }
    groups[name].todos.push(todo)
    if (todo.status === "in_progress") groups[name].hasActive = true
    if (todo.status !== "completed" && todo.status !== "cancelled") {
      groups[name].allDone = false
    }
  }

  return { groups, order }
}

function detectPipelineType(todos) {
  const content = todos.map((t) => t.content).join(" ")
  if (/feature|spec|generator|architect/i.test(content)) return "feature"
  if (/bugfix|fix|triage|reproducir/i.test(content)) return "bugfix"
  if (/debug|investigar/i.test(content)) return "debug"
  if (/chore|scope|renombrar/i.test(content)) return "chore"
  return "unknown"
}

function detectCurrentStep(scopeTodos) {
  let maxStep = 0
  for (const t of scopeTodos) {
    if (t.status !== "in_progress") continue
    const m = t.content.match(/(\d+)\/\d+/)
    if (m) maxStep = Math.max(maxStep, parseInt(m[1]))
  }
  return maxStep
}

function writeClosePending(scopeName, state) {
  const dir = dirname(CLOSE_PENDING_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const payload = {
    scope: scopeName,
    type: state.scopes[scopeName]?.type || "unknown",
    completed_at: new Date().toISOString(),
  }
  writeFileSync(CLOSE_PENDING_PATH, JSON.stringify(payload, null, 2))
}

// ── Learnings extraction hook ────────────────────────────────────────────────

/**
 * Spawnea `npx tsx scripts/extract-learnings.ts` después de que un scope
 * se cierra, para extraer la última lección de LEARNINGS.md al skill del
 * agente correspondiente.
 *
 * No bloquea el pipeline si falla — solo loggea warnings.
 */
function extractLearningsAfterClose() {
  // Guard: solo si close-pending.json existe y es reciente (< 5 min)
  if (!existsSync(CLOSE_PENDING_PATH)) return

  try {
    const pendingData = JSON.parse(readFileSync(CLOSE_PENDING_PATH, "utf-8"))
    const completedAt = new Date(pendingData.completed_at).getTime()
    const fiveMinAgo = Date.now() - 5 * 60 * 1000

    if (completedAt < fiveMinAgo) {
      // close-pending es viejo (> 5 min) — probablemente ya se procesó
      return
    }
  } catch (e) {
    // Si no se puede leer el archivo, salir silenciosamente
    return
  }

  // Spawn npx tsx scripts/extract-learnings.ts con timeout de 10s
  const repoRoot = dirname(dirname(__dirname))
  const child = spawn("npx", ["tsx", "scripts/extract-learnings.ts"], {
    cwd: repoRoot,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  })

  let stderr = ""
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString()
  })

  child.on("error", (err) => {
    console.warn(
      `[pipeline-enforcer] Could not spawn extract-learnings.ts: ${err.message}`
    )
  })

  child.on("close", (code) => {
    if (code !== 0) {
      console.warn(
        `[pipeline-enforcer] extract-learnings.ts exited with code ${code}:\n${stderr.trim()}`
      )
    }
  })
}

export default async () => {
  let previousScopeState = {}

  // Helper: extrae la lógica de update de state (usada por el hook de tracking)
  // Lê todos de múltiples paths defensivamente porque la forma exacta del input
  // de tool.execute.after no está 100% documentada en opencode.
  const updateStateFromTodos = (todos) => {
    if (!Array.isArray(todos) || todos.length === 0) return

    const parsed = parseScopeGroups(todos)
    if (!parsed) return

    const { groups, order } = parsed
    const state = loadState()
    const prevScopes = { ...previousScopeState }

    // Ensure all current scopes exist in state
    for (const name of order) {
      if (!state.scopes[name]) {
        state.scopes[name] = {
          active: false,
          type: null,
          step: 0,
          started_at: null,
          completed_at: null,
        }
      }
    }

    // Detect transitions and update state per scope
    for (const [name, data] of Object.entries(groups)) {
      const wasActive = prevScopes[name]?.hasActive || state.scopes[name]?.active || false
      const nowActive = data.hasActive

      // Transition: was active → now all completed → trigger close
      if (wasActive && !nowActive && data.allDone && !state.scopes[name]?.completed_at) {
        state.scopes[name].type = state.scopes[name]?.type || detectPipelineType(data.todos)
        state.scopes[name].completed_at = new Date().toISOString()
        state.scopes[name].active = false
        state.scopes[name].step = 6
        writeClosePending(name, state)
        extractLearningsAfterClose()
      } else {
        // Normal update
        state.scopes[name].active = nowActive
        if (nowActive) {
          state.scopes[name].type = state.scopes[name]?.type || detectPipelineType(data.todos)
          state.scopes[name].started_at = state.scopes[name]?.started_at || new Date().toISOString()
          state.scopes[name].completed_at = null
        }
        if (data.allDone && !state.scopes[name]?.completed_at) {
          state.scopes[name].completed_at = new Date().toISOString()
          state.scopes[name].active = false
          state.scopes[name].step = 6
        }
        if (!data.allDone && data.hasActive) {
          state.scopes[name].step = detectCurrentStep(data.todos)
        }
      }
    }

    // Remove stale scopes from state
    for (const name of Object.keys(state.scopes)) {
      if (!groups[name] && name !== "main") {
        delete state.scopes[name]
      }
    }

    // Global active flag: true if ANY scope is active
    state.global.pipeline_active = Object.values(state.scopes).some((s) => s.active)

    // Mark global completed if all scopes done
    const allScopesDone = Object.values(state.scopes).every((s) => s.completed_at)
    if (allScopesDone && Object.keys(state.scopes).length > 0) {
      state.global.pipeline_active = false
    }

    saveState(state)

    // Track current state for next transition detection
    previousScopeState = {}
    for (const [name, data] of Object.entries(groups)) {
      previousScopeState[name] = { hasActive: data.hasActive, allDone: data.allDone }
    }
  }

  return {
    // Hook de tracking de scopes. Reemplaza el antiguo "todo.updated" (que
    // no era un evento válido en opencode). Ahora disparamos desde
    // tool.execute.after del tool `todowrite` con la lista actualizada.
    "tool.execute.after": async (input, output) => {
      if (input?.tool !== "todowrite") return
      // El tool todowrite recibe { todos: [...] } como arg. Leemos de
      // múltiples paths por si la forma exacta varía entre versiones de opencode.
      const todos =
        input?.args?.todos ??
        output?.args?.todos ??
        input?.output?.todos ??
        output?.output?.todos ??
        []
      updateStateFromTodos(todos)
      const model = process.env.OPENCODE_MODEL || process.env.MODEL || "desconocido"
      console.log(`── Modelo activo: ${model} ──`)
    },

    // A17: Ignorar cambios en state.json — archivo interno del plugin
    "todo.updated": async (input) => {
      const filePath = input?.filePath || input?.path || ""
      if (filePath.includes(".opencode/pipeline/state.json")) return
    },

    "tool.execute.before": async (input, output) => {
      // ── Pre-spec check: bloquear activación de nuevo scope ─────────────
      if (input?.tool === "todowrite") {
        const todos = input?.args?.todos || []
        const parsed = parseScopeGroups(todos)
        if (parsed) {
          for (const [name, data] of Object.entries(parsed.groups)) {
            const wasActive = previousScopeState[name]?.hasActive || false
            const nowActive = data.hasActive
            // Solo bloquear cuando un scope pasa de inactivo a activo (nueva activación)
            if (!wasActive && nowActive) {
              runPreSpecCheck(name) // lanza si falla
            }
          }
        }
        return // todowrite no necesita los checks de edit/write
      }
      // ── End pre-spec check ─────────────────────────────────────────────

      if (!EDIT_TOOLS.has(input?.tool)) return

      // ── Hardcode detection (runs regardless of pipeline state) ─────────
      loadHardcodePatterns()
      let contentToCheck = ""
      let filePath = input?.args?.filePath || ""

      if (input.tool === "write") {
        contentToCheck = input?.args?.content || ""
      } else if (input.tool === "edit") {
        // For edit, check the newString being written
        contentToCheck = input?.args?.newString || ""
      }

      if (contentToCheck) {
        const found = scanForHardcodes(contentToCheck, filePath)
        if (found.length > 0) {
          throw new Error(buildHardcodeErrorMessage(found, filePath))
        }
      }
      // ── End hardcode detection ─────────────────────────────────────────

      // A17: state.json y close-pending son archivos internos del plugin.
      // Sus modificaciones no deben bloquear operaciones ni requerir pipeline activo.
      if (
        filePath.includes(".opencode/pipeline/state.json") ||
        filePath.includes(".opencode/pipeline/close-pending.json")
      )
        return

      const state = loadState()
      if (state.global.pipeline_active) return

      // A16: Permitir ediciones durante resolución de conflictos de merge
      if (hasUnmergedFiles()) return

      throw new Error(
        `Pipeline enforcement: no puedes editar archivos sin iniciar el pipeline primero.

Ejecuta todowrite con el pipeline correspondiente.

Formato multi-scope (varias tareas independientes):

[feature.mi-feature]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad técnica
[ ] 3/6 QA (RED) → tests que fallan
[ ] 4/6 Implementación → código
[ ] 5/6 QA (GREEN) → suite completa
[ ] 6/6 Cierre → close checklist

[bugfix.mi-fix]
[▶] 1/5 Triage → confirmar bug
[ ] 2/5 Reproducir → test que falla
[ ] 3/5 Fix → corregir
[ ] 4/5 Verify → tests + typecheck
[ ] 5/5 Cierre → close checklist

O un solo scope (tarea única):

[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect
[ ] 3/6 QA (RED)
[ ] 4/6 Implementación
[ ] 5/6 QA (GREEN)
[ ] 6/6 Cierre
`
      )
    },
  }
}
