#!/usr/bin/env npx tsx
/**
 * sync-vendored-skills.ts
 * Fetches the latest SKILL.md from upstream repos and overwrites vendored copies.
 *
 * Usage:
 *   npx tsx scripts/sync-vendored-skills.ts
 *   npx tsx scripts/sync-vendored-skills.ts --dry-run
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(__dirname, "..", "skills")

const UPSTREAM: Record<string, string> = {
  ponytail: "https://raw.githubusercontent.com/DietrichGebert/ponytail/main/skills/ponytail/SKILL.md",
  caveman: "https://raw.githubusercontent.com/JuliusBrussee/caveman/main/skills/caveman/SKILL.md",
}

const dryRun = process.argv.includes("--dry-run")

async function main() {
  for (const [name, url] of Object.entries(UPSTREAM)) {
    const skillDir = join(SKILLS_DIR, name)
    const skillPath = join(skillDir, "SKILL.md")

    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.error(`✗ ${name}: HTTP ${res.status} — skipping`)
        continue
      }
      const content = await res.text()

      if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true })

      const oldContent = existsSync(skillPath) ? readFileSync(skillPath, "utf-8") : ""
      const changed = oldContent !== content

      if (dryRun) {
        console.log(`→ ${name}: ${changed ? "WOULD update" : "already up to date"}`)
      } else {
        writeFileSync(skillPath, content)
        console.log(`✓ ${name}: ${changed ? "updated" : "already up to date"}`)
      }
    } catch (e: any) {
      console.error(`✗ ${name}: ${e.message}`)
    }
  }
}

main()
