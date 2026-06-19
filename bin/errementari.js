#!/usr/bin/env node
// Unified Errementari CLI — handles both user commands and Claude Code hook protocol.
//
// User commands (CLI mode):
//   errementari init [dir] [-y] [--dry-run]
//   errementari upgrade [dir] [--dry-run]
//   errementari status [dir]
//   errementari doctor [dir]
//   errementari uninstall [dir] [-y]
//
// Claude Code hook protocol (stdin JSON):
//   errementari guard-edit          → PreToolUse (Edit|Write|MultiEdit)
//   errementari check-activation    → PreToolUse (TodoWrite)
//   errementari sync-todos          → PostToolUse (TodoWrite)
//   errementari guard-bash          → PreToolUse (Bash)
//   errementari extract-learnings   → Stop hook
//
// Both modes share pipeline/pipeline-core.mjs for identical enforcement.

import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { spawnSync, execSync } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = dirname(__dirname)

// Import shared core
import {
  updateStateFromTodos,
  checkScopeActivation,
  evaluateEdit,
  extractLearningsAfterClose,
} from "../pipeline/pipeline-core.mjs"

// ── Hook protocol helpers ────────────────────────────────────────────────────

function readStdin() {
  try {
    const raw = readFileSync(0, "utf-8")
    return raw.trim() ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function runCoord(args) {
  const COORD_SH = join(PLUGIN_ROOT, "pipeline", "coordination.sh")
  try {
    return spawnSync("bash", [COORD_SH, ...args], {
      encoding: "utf-8",
      timeout: 8000,
    })
  } catch (e) {
    return { status: 0, stderr: "" }
  }
}

// ── Hook command handlers ────────────────────────────────────────────────────

function cmdGuardEdit() {
  const payload = readStdin()
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
    process.exit(0)
  }

  const res = evaluateEdit({ tool, filePath, content })
  if (res.ok) process.exit(0)

  process.stderr.write(res.reason + "\n")
  process.exit(2)
}

function cmdCheckActivation() {
  const payload = readStdin()
  const todos = payload?.tool_input?.todos ?? payload?.todos ?? []
  try {
    checkScopeActivation(todos, {})
  } catch (e) {
    process.stderr.write(String(e.message || e) + "\n")
    process.exit(2)
  }
  process.exit(0)
}

function cmdSyncTodos() {
  const payload = readStdin()
  const todos = payload?.tool_input?.todos ?? payload?.todos ?? []
  updateStateFromTodos(todos, {}) // onClose undefined: Stop hook runs extract-learnings
  process.exit(0)
}

function cmdGuardBash() {
  const payload = readStdin()
  const command =
    payload?.tool_input?.command ??
    payload?.tool_input?.cmd ??
    payload?.tool_input?.script ??
    ""

  // Heartbeat (non-blocking)
  runCoord(["heartbeat", "claude"])

  if (!command) process.exit(0)

  const res = runCoord(["guard-git", command])
  if (res && res.status === 2) {
    process.stderr.write(
      (res.stderr || "").trim() ||
        "[coordination] Destructive git operation blocked.\n"
    )
    process.exit(2)
  }
  process.exit(0)
}

function cmdExtractLearnings() {
  extractLearningsAfterClose()
  process.exit(0)
}

// ── CLI mode: delegate to the TypeScript CLI ─────────────────────────────────

async function runCli(subcommand, args = []) {
  const { initCommand } = await import("../src/commands/init.js")
  const { upgradeCommand } = await import("../src/commands/upgrade.js")
  const { statusCommand } = await import("../src/commands/status.js")
  const { doctorCommand } = await import("../src/commands/doctor.js")
  const { uninstallCommand } = await import("../src/commands/uninstall.js")

  switch (subcommand) {
    case "init": {
      const dir = args[0]
      const yes = args.includes("-y") || args.includes("--yes")
      const dryRun = args.includes("--dry-run")
      await initCommand(dir, { yes, dryRun })
      break
    }
    case "upgrade": {
      const dir = args[0]
      const dryRun = args.includes("--dry-run")
      await upgradeCommand(dir, { dryRun })
      break
    }
    case "status":
      statusCommand(args[0])
      break
    case "doctor":
      await doctorCommand(args[0])
      break
    case "uninstall": {
      const dir = args[0]
      const yes = args.includes("-y") || args.includes("--yes")
      await uninstallCommand(dir, { yes })
      break
    }
    default:
      // Default = init
      await initCommand(args[0], {
        yes: args.includes("-y") || args.includes("--yes"),
        dryRun: args.includes("--dry-run"),
      })
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

const cmd = process.argv[2]

// If first arg is a known subcommand = CLI mode
const cliCommands = new Set(["init", "upgrade", "status", "doctor", "uninstall", "--help", "-h", "--version", "-V"])

if (!cmd || cliCommands.has(cmd)) {
  // CLI mode: delegate to the full TypeScript CLI
  const { Command } = await import("commander")
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf-8"))
  const program = new Command()

  program
    .name("errementari")
    .description("Dual-tool (Claude Code + OpenCode) TDD/BDD/SDD/SPDD pipeline harness")
    .version(pkg.version)

  program
    .command("init")
    .description("Initialize the harness in a project")
    .argument("[dir]", "Target project directory (defaults to CWD)")
    .option("-y, --yes", "Skip prompts and use detected values")
    .option("--dry-run", "Show what would be installed without writing files")
    .action(async (dir, options) => {
      const { initCommand } = await import("../src/commands/init.js")
      await initCommand(dir, options)
    })

  program
    .command("upgrade")
    .description("Upgrade an existing harness installation")
    .argument("[dir]", "Target project directory (defaults to CWD)")
    .option("--dry-run", "Preview what the upgrade would change without writing files")
    .action(async (dir, options) => {
      const { upgradeCommand } = await import("../src/commands/upgrade.js")
      await upgradeCommand(dir, options)
    })

  program
    .command("status")
    .description("Show harness installation status")
    .argument("[dir]", "Target project directory (defaults to CWD)")
    .action((dir) => {
      import("../src/commands/status.js").then(({ statusCommand }) => statusCommand(dir))
    })

  program
    .command("doctor")
    .description("Check the health of a harness installation")
    .argument("[dir]", "Target project directory (defaults to CWD)")
    .action(async (dir) => {
      const { doctorCommand } = await import("../src/commands/doctor.js")
      await doctorCommand(dir)
    })

  program
    .command("uninstall")
    .description("Remove the harness from a project")
    .argument("[dir]", "Target project directory (defaults to CWD)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (dir, options) => {
      const { uninstallCommand } = await import("../src/commands/uninstall.js")
      await uninstallCommand(dir, options)
    })

  program
    .argument("[dir]", "Target project directory (defaults to CWD)")
    .option("-y, --yes", "Skip prompts and use detected values")
    .option("--dry-run", "Show what would be installed without writing files")
    .action(async (dir, options) => {
      const { initCommand } = await import("../src/commands/init.js")
      await initCommand(dir, options)
    })

  await program.parseAsync(process.argv)
} else {
  // Hook mode: stdin JSON protocol (Claude Code)
  switch (cmd) {
    case "guard-edit":
      cmdGuardEdit()
      break
    case "check-activation":
      cmdCheckActivation()
      break
    case "sync-todos":
      cmdSyncTodos()
      break
    case "guard-bash":
      cmdGuardBash()
      break
    case "extract-learnings":
      cmdExtractLearnings()
      break
    default:
      // Unknown hook command — no-op
      process.exit(0)
  }
}
