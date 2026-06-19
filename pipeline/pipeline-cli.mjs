#!/usr/bin/env node
// Claude Code hook adapter for the shared pipeline core.
//
// Wires Claude Code's stdin-JSON hook protocol to the same enforcement logic
// the opencode plugin uses (.opencode/pipeline/pipeline-core.mjs). This is what
// gives Claude Code the SAME pipeline enforcement opencode has.
//
// Usage (from .claude/settings.json hooks):
//   PreToolUse  (Edit|Write|MultiEdit) → node .../pipeline-cli.mjs guard-edit
//   PreToolUse  (TodoWrite)            → node .../pipeline-cli.mjs check-activation
//   PostToolUse (TodoWrite)            → node .../pipeline-cli.mjs sync-todos
//
// Protocol:
//   - guard-edit:       exit 2 + stderr blocks the tool (reason shown to Claude);
//                       exit 0 allows it.
//   - check-activation: exit 2 + stderr blocks TodoWrite when a NEW scope would
//                       activate but pre-spec.sh fails (parity with opencode's
//                       blocking tool.execute.before). exit 0 otherwise.
//   - sync-todos:       updates state.json from the new todo list; exit 0 always
//                       (PostToolUse cannot block — the tool already ran).

import { readFileSync } from "fs"
import {
  updateStateFromTodos,
  checkScopeActivation,
  evaluateEdit,
} from "./pipeline-core.mjs"

function readStdin() {
  try {
    const raw = readFileSync(0, "utf-8")
    return raw.trim() ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const cmd = process.argv[2]
const payload = readStdin()

if (cmd === "check-activation") {
  // Claude Code PreToolUse(TodoWrite): block activation of a NEW scope if
  // pre-spec.sh fails (parity with opencode's blocking tool.execute.before).
  const todos = payload?.tool_input?.todos ?? payload?.todos ?? []
  try {
    checkScopeActivation(todos, {}) // transition derived from state.json
  } catch (e) {
    process.stderr.write(String(e.message || e) + "\n")
    process.exit(2) // block TodoWrite — scope cannot activate until pre-spec passes
  }
  process.exit(0)
}

if (cmd === "sync-todos") {
  // Claude Code PostToolUse(TodoWrite): { tool_input: { todos: [...] } }
  const todos = payload?.tool_input?.todos ?? payload?.todos ?? []
  updateStateFromTodos(todos, {}) // onClose undefined: Stop hook runs extract-learnings
  process.exit(0)
}

if (cmd === "guard-edit") {
  // Claude Code PreToolUse(Edit|Write|MultiEdit):
  //   { tool_name, tool_input: { file_path, content?, new_string?, edits? } }
  const toolName = (payload?.tool_name || "").toLowerCase()
  const ti = payload?.tool_input || {}
  const filePath = ti.file_path || ""

  let tool = ""
  let content = ""
  if (toolName === "write") {
    tool = "write"
    content = ti.content || ""
  } else if (toolName === "edit") {
    tool = "edit"
    content = ti.new_string || ""
  } else if (toolName === "multiedit") {
    tool = "edit"
    content = (ti.edits || []).map((e) => e.new_string || "").join("\n")
  } else {
    process.exit(0) // not an edit tool — allow
  }

  const res = evaluateEdit({ tool, filePath, content })
  if (res.ok) process.exit(0)

  process.stderr.write(res.reason + "\n")
  process.exit(2) // block the tool; reason is fed back to Claude
}

// Unknown command — no-op.
process.exit(0)
