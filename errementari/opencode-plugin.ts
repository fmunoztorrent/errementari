// OpenCode plugin entry point — unified pipeline enforcement.
//
// Loaded from npm package "errementari" via opencode.json:
//   { "plugin": ["errementari"] }
//
// OpenCode calls the default export with ({ project, client, $, directory, worktree })
// and expects a hooks object back.
//
// Shares enforcement logic with Claude Code via pipeline/pipeline-core.mjs.

import { spawnSync } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = __dirname

import {
  updateStateFromTodos,
  checkScopeActivation,
  evaluateEdit,
  extractLearningsAfterClose,
  loadState,
  hasUnmergedFiles,
} from "./pipeline/pipeline-core.mjs"

const COORD_SH = join(PLUGIN_DIR, "pipeline", "coordination.sh")

function runCoord(args) {
  try {
    return spawnSync("bash", [COORD_SH, ...args], {
      encoding: "utf-8",
      timeout: 8000,
    })
  } catch (e) {
    return { status: 0, stderr: "" }
  }
}

export default async ({ project, $ }) => {
  // In-memory snapshot of scope activity across todowrite calls within a session.
  let previousScopeState = {}

  // Register the opencode session (best-effort, non-blocking)
  runCoord(["register", "opencode"])

  return {
    // ── After todowrite: update state.json, detect scope transitions ──────
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

    // ── Before tool calls: guards (hardcodes, pipeline, coordination) ────
    "tool.execute.before": async (input) => {
      const tool = input?.tool

      // ▸ Coordination for bash commands
      if (tool === "bash") {
        const command =
          input?.args?.command ??
          input?.args?.cmd ??
          input?.args?.script ??
          ""

        // Heartbeat (non-blocking)
        runCoord(["heartbeat", "opencode"])

        if (command) {
          const res = runCoord(["guard-git", command])
          if (res && res.status === 2) {
            const stderr = (res.stderr || "").trim()
            throw new Error(
              stderr ||
                "[coordination] Destructive git operation blocked: the shared working tree has uncommitted changes."
            )
          }
        }
        return
      }

      // ▸ Pre-spec activation check for todowrite
      if (tool === "todowrite") {
        const todos = input?.args?.todos || []
        checkScopeActivation(todos, previousScopeState) // throws on failure
        return // todowrite skips edit/write checks
      }

      // ▸ Edit/write guard: hardcodes + pipeline active
      if (tool !== "edit" && tool !== "write") return

      const filePath = input?.args?.filePath || ""
      const content =
        tool === "write"
          ? input?.args?.content || ""
          : input?.args?.newString || ""

      const res = evaluateEdit({ tool, filePath, content })
      if (!res.ok) throw new Error(res.reason)
    },

    // ── Ignore changes to internal plugin files ──────────────────────────
    "todo.updated": async (input) => {
      const filePath = input?.filePath || input?.path || ""
      if (filePath.includes(".opencode/pipeline/state.json")) return
      if (filePath.includes(".opencode/pipeline/close-pending.json")) return
    },
  }
}
