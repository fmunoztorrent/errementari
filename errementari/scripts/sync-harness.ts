#!/usr/bin/env npx tsx
/**
 * sync-harness.ts
 *
 * `errementari/harness/` is a vendored mirror that `errementari upgrade` copies
 * into target projects. Its files MUST stay byte-identical to the canonical
 * sources the package ships (and that `init` wraps via node_modules). Without a
 * guard the two drift silently — `init` installs the canonical logic while
 * `upgrade` installs the stale mirror.
 *
 * This script refreshes every vendored file from its canonical counterpart and,
 * with --check, fails if any has drifted (wired into CI to block drift).
 *
 * Usage:
 *   tsx scripts/sync-harness.ts            # refresh vendored copies
 *   tsx scripts/sync-harness.ts --check    # exit 1 if any vendored file is stale
 */
import { copyFileSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// canonical source dir → vendored mirror dir (both relative to the package root)
const MAPPINGS: Array<[canonical: string, vendored: string]> = [
  ["pipeline", "harness/.opencode/pipeline"],
  ["scripts", "harness/scripts"],
  ["commands", "harness/.claude/commands"],
  ["skills", "harness/.claude/skills"],
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const check = process.argv.includes("--check");
const drifted: string[] = [];
let synced = 0;

for (const [canonRel, vendRel] of MAPPINGS) {
  const canonDir = join(root, canonRel);
  const vendDir = join(root, vendRel);
  for (const vendFile of walk(vendDir)) {
    const rel = relative(vendDir, vendFile);
    const canonFile = join(canonDir, rel);
    let canonContent: string;
    try {
      canonContent = readFileSync(canonFile, "utf-8");
    } catch {
      // Vendored file with no canonical counterpart (e.g. compiled opencode
      // plugins live only under harness/) — leave it untouched.
      continue;
    }
    if (canonContent === readFileSync(vendFile, "utf-8")) continue;
    if (check) {
      drifted.push(`${vendRel}/${rel}`);
    } else {
      copyFileSync(canonFile, vendFile);
      synced++;
      console.log(`  ↻ ${vendRel}/${rel}`);
    }
  }
}

if (check) {
  if (drifted.length > 0) {
    console.error("✗ harness/ is out of sync with canonical sources:");
    for (const f of drifted) console.error(`    - ${f}`);
    console.error("\nRun: pnpm --filter errementari run sync:harness");
    process.exit(1);
  }
  console.log("✓ harness/ is in sync with canonical sources.");
} else {
  console.log(synced > 0 ? `\n✓ Synced ${synced} vendored file(s).` : "✓ Already in sync.");
}
