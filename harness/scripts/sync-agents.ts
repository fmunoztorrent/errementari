#!/usr/bin/env tsx
/**
 * sync-agents.ts — single source of truth for agent definitions.
 *
 * Canonical agent bodies live in `.claude/agents/<agent>.md`. Each runtime keeps
 * its own YAML frontmatter (Claude Code uses name/tools/model; opencode uses
 * mode/model/permission), but the BODY must be identical so the same agent
 * behaves the same in both runtimes. This script copies the canonical body into
 * each `.opencode/agents/<agent>.md`, preserving that file's frontmatter.
 *
 * Usage:
 *   tsx scripts/sync-agents.ts          # regenerate .opencode bodies from .claude
 *   tsx scripts/sync-agents.ts --check  # exit 1 if any .opencode body has drifted
 *
 * The --check mode is wired into the git pre-commit hook so divergence cannot be
 * committed from EITHER runtime (the hook is shared via core.hooksPath).
 */

import { execSync } from "child_process"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

// Use git to find the repo root — works in both ESM and CJS modes.
function detectRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return process.cwd()
  }
}

const ROOT = detectRepoRoot()
const AGENTS = ["architect", "backend", "frontend", "qa", "spec"]

/** Split a markdown-with-frontmatter file into { frontmatter, body }.
 *  frontmatter includes the delimiting `---` lines; body is everything after. */
function split(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---")) {
    throw new Error("file does not start with YAML frontmatter (`---`)")
  }
  // Find the closing `---` of the frontmatter block (second delimiter).
  const lines = content.split("\n")
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i
      break
    }
  }
  if (close === -1) throw new Error("unterminated frontmatter (no closing `---`)")
  const frontmatter = lines.slice(0, close + 1).join("\n")
  const body = lines.slice(close + 1).join("\n")
  return { frontmatter, body }
}

const check = process.argv.includes("--check")
const drifted: string[] = []
let written = 0

for (const agent of AGENTS) {
  const canonicalPath = join(ROOT, ".claude", "agents", `${agent}.md`)
  const targetPath = join(ROOT, ".opencode", "agents", `${agent}.md`)

  // Skip agents that don't exist (e.g. frontend in backend-only projects)
  if (!existsSync(canonicalPath)) {
    console.warn(`⚠ skipping ${agent}: no canonical file at ${canonicalPath}`)
    continue
  }
  if (!existsSync(targetPath)) {
    console.warn(`⚠ skipping ${agent}: no target file at ${targetPath}`)
    continue
  }

  const canonicalBody = split(readFileSync(canonicalPath, "utf-8")).body
  const target = split(readFileSync(targetPath, "utf-8"))
  const expected = `${target.frontmatter}\n${canonicalBody}`
  const current = readFileSync(targetPath, "utf-8")

  if (current === expected) continue

  if (check) {
    drifted.push(agent)
  } else {
    writeFileSync(targetPath, expected)
    written++
    console.log(`✓ synced .opencode/agents/${agent}.md`)
  }
}

if (check) {
  if (drifted.length > 0) {
    console.error(
      `✗ agent body divergence: ${drifted.join(", ")}\n` +
        `  .opencode/agents/<agent>.md body differs from canonical .claude/agents/<agent>.md.\n` +
        `  Run: npx tsx scripts/sync-agents.ts`
    )
    process.exit(1)
  }
  console.log("✓ agents in sync (no divergence)")
} else {
  console.log(written === 0 ? "✓ already in sync" : `✓ synced ${written} agent(s)`)
}
