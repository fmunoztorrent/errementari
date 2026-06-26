// opencode plugin: pipeline enforcer.
//
// THIN wrapper around the shared core (.opencode/pipeline/pipeline-core.mjs).
// All enforcement logic lives in the core so Claude Code (via pipeline-cli.mjs)
// and opencode enforce the pipeline IDENTICALLY. Do not add enforcement logic
// here — add it to pipeline-core.mjs.

import {
  updateStateFromTodos,
  checkScopeActivation,
  evaluateEdit,
  extractLearningsAfterClose,
} from "../pipeline/pipeline-core.mjs"

export default async () => {
  // In-memory snapshot of scope activity, used to detect inactive→active and
  // active→done transitions across todowrite calls within a session.
  let previousScopeState = {}

  return {
    // Scope tracking: fired from tool.execute.after of the `todowrite` tool.
    "tool.execute.after": async (input, output) => {
      if (input?.tool !== "todowrite") return
      const todos =
        input?.args?.todos ??
        output?.args?.todos ??
        input?.output?.todos ??
        output?.output?.todos ??
        []
      previousScopeState = updateStateFromTodos(todos, {
        previousScopeState,
        onClose: () => extractLearningsAfterClose(),
      })
      const model = process.env.OPENCODE_MODEL || process.env.MODEL || "unknown"
      console.log(`── Active model: ${model} ──`)
    },

    // Ignore changes to state.json — internal plugin file.
    "todo.updated": async (input) => {
      const filePath = input?.filePath || input?.path || ""
      if (filePath.includes(".opencode/pipeline/state.json")) return
    },

    "tool.execute.before": async (input) => {
      // Pre-spec check: block activation of a new scope if pre-spec.sh fails.
      if (input?.tool === "todowrite") {
        const todos = input?.args?.todos || []
        checkScopeActivation(todos, previousScopeState) // throws on failure
        return // todowrite skips edit/write checks
      }

      // Edit/write guard (hardcode + active-pipeline) — delegated to the core.
      const tool = input?.tool
      if (tool !== "edit" && tool !== "write") return

      const filePath = input?.args?.filePath || ""
      const content =
        tool === "write" ? input?.args?.content || "" : input?.args?.newString || ""

      const res = evaluateEdit({ tool, filePath, content })
      if (!res.ok) throw new Error(res.reason)
    },
  }
}
