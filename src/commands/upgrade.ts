import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, relative, resolve } from "path";
import { detect } from "../detect.js";
import {
  fileHash,
  getTemplateMappings,
  harnessDir,
  readManifest,
  renderMapping,
  renderMappingContent,
  rootDir,
} from "../render.js";

function listFiles(dir: string, baseDir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, baseDir, out);
    else out.push(relative(baseDir, full));
  }
  return out;
}

// Numeric semver comparison: negative if a < b, 0 if equal, positive if a > b.
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function upgradeCommand(targetDir?: string, options?: { dryRun?: boolean }) {
  const target = targetDir ? resolve(targetDir) : process.cwd();
  const dryRun = options?.dryRun || false;

  const manifest = readManifest(target);
  if (!manifest) {
    console.error("No Errementari harness found in this project.");
    console.log("Run 'errementari init' first.");
    process.exitCode = 1;
    return;
  }

  const currentVersion = JSON.parse(readFileSync(join(rootDir(), "package.json"), "utf-8")).version;

  const cmp = compareVersions(manifest.version, currentVersion);
  if (cmp === 0) {
    console.log(`Harness is up to date (v${manifest.version}).`);
    return;
  }
  if (cmp > 0) {
    console.error(
      `Installed harness (v${manifest.version}) is newer than this Errementari (v${currentVersion}).`,
    );
    console.error("Refusing to downgrade. Update your Errementari installation instead.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}Upgrading harness from v${manifest.version} to v${currentVersion}...\n`,
  );

  // ── Upgrade generic files — respect user modifications ───────────────────
  const srcHarness = harnessDir();
  const harnessFiles = listFiles(srcHarness, srcHarness);

  const modifiedGenerics: string[] = [];
  let updatedGenerics = 0;
  let addedGenerics = 0;

  for (const rel of harnessFiles) {
    const srcPath = join(srcHarness, rel);
    const destPath = join(target, rel);
    const entry = manifest.files[rel];

    if (entry && entry.type === "generic" && existsSync(destPath)) {
      const currentHash = fileHash(readFileSync(destPath, "utf-8"));
      const baseline = entry.originalHash || entry.hash;
      if (baseline && currentHash !== baseline) {
        modifiedGenerics.push(rel);
        continue;
      }
    }

    if (entry) updatedGenerics++;
    else addedGenerics++;

    if (dryRun) continue;

    const destDir = join(target, rel, "..");
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    const st = statSync(srcPath);
    copyFileSync(srcPath, destPath);
    chmodSync(destPath, st.mode);

    const newHash = fileHash(readFileSync(destPath, "utf-8"));
    manifest.files[rel] = {
      type: "generic",
      version: currentVersion,
      hash: newHash,
      originalHash: newHash,
    };
  }

  console.log(
    `  ${dryRun ? "→ Would update" : "✓ Updated"} ${updatedGenerics} generic files` +
      (addedGenerics ? ` (+${addedGenerics} new)` : ""),
  );

  // ── Remove generic files this version no longer ships ────────────────────
  // (e.g. pre-commit.sh → pre-commit rename, hardcode-patterns.json → template).
  // User-modified copies are kept and reported instead of deleted.
  const harnessSet = new Set(harnessFiles);
  const removedGenerics: string[] = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (entry.type !== "generic" || harnessSet.has(rel)) continue;
    const destPath = join(target, rel);
    if (existsSync(destPath)) {
      const currentHash = fileHash(readFileSync(destPath, "utf-8"));
      const baseline = entry.originalHash || entry.hash;
      if (baseline && currentHash !== baseline) {
        modifiedGenerics.push(rel);
        continue;
      }
      if (!dryRun) rmSync(destPath, { force: true });
    }
    removedGenerics.push(rel);
    if (!dryRun) delete manifest.files[rel];
  }
  if (removedGenerics.length > 0) {
    console.log(
      `  ${dryRun ? "→ Would remove" : "✓ Removed"} ${removedGenerics.length} obsolete file(s):`,
    );
    for (const f of removedGenerics) console.log(`    - ${f}`);
  }

  if (modifiedGenerics.length > 0) {
    console.log(
      `\n  ⚠ ${modifiedGenerics.length} generic file(s) modified by you — left untouched:`,
    );
    for (const f of modifiedGenerics) console.log(`    - ${f}`);
  }

  // ── Upgrade mapped files (templates, statics, stubs) ─────────────────────
  const ctx = detect(target);
  const mappings = getTemplateMappings(ctx);

  const modifiedTemplates: string[] = [];
  let newMapped = 0;
  let refreshedMapped = 0;

  for (const mapping of mappings) {
    const entry = manifest.files[mapping.target];
    const destPath = join(target, mapping.target);

    // New in this version, or file deleted on disk → (re)create.
    if (!entry || !existsSync(destPath)) {
      if (dryRun) {
        console.log(`  → Would add: ${mapping.target}`);
        newMapped++;
        continue;
      }
      const newEntry = renderMapping(mapping, target, ctx);
      if (newEntry) {
        manifest.files[mapping.target] = newEntry;
        newMapped++;
      }
      continue;
    }

    // Stubs hold user content once created — never overwrite.
    if (mapping.type === "stub" || entry.type === "stub") continue;

    const currentHash = fileHash(readFileSync(destPath, "utf-8"));
    const baseline = entry.originalHash || entry.hash;
    if (baseline && currentHash !== baseline) {
      modifiedTemplates.push(mapping.target);
      continue;
    }

    // Unmodified → safe to re-render with the new version's template.
    const newContent = renderMappingContent(mapping, ctx);
    if (newContent === null) continue;
    if (fileHash(newContent) === currentHash) continue; // nothing changed

    if (dryRun) {
      console.log(`  → Would refresh: ${mapping.target}`);
      refreshedMapped++;
      continue;
    }
    const newEntry = renderMapping(mapping, target, ctx);
    if (newEntry) {
      manifest.files[mapping.target] = newEntry;
      refreshedMapped++;
    }
  }

  if (newMapped > 0)
    console.log(`  ${dryRun ? "→ Would add" : "✓ Added"} ${newMapped} new file(s)`);
  if (refreshedMapped > 0)
    console.log(
      `  ${dryRun ? "→ Would refresh" : "✓ Refreshed"} ${refreshedMapped} unmodified template(s)`,
    );

  if (modifiedTemplates.length > 0) {
    console.log(`\n  ⚠ ${modifiedTemplates.length} template(s) modified by you — left untouched:`);
    for (const f of modifiedTemplates) console.log(`    - ${f}`);
    console.log("  Review the updated templates manually if needed.");
  }

  if (dryRun) {
    console.log(`\n[dry-run] No files were written.`);
    return;
  }

  // ── Update manifest version ──────────────────────────────────────────────
  manifest.version = currentVersion;
  const manifestPath = join(target, ".errementari.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\nUpgrade complete: v${currentVersion}`);
  console.log("");
}
