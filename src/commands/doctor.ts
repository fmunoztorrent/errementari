import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { readManifest, rootDir } from "../render.js";
import { compareVersions } from "./upgrade.js";

export async function doctorCommand(targetDir?: string) {
  const target = targetDir ? resolve(targetDir) : process.cwd();
  let problems = 0;
  let warnings = 0;

  const ok = (msg: string) => console.log(`  ✓ ${msg}`);
  const warn = (msg: string) => {
    warnings++;
    console.log(`  ⚠ ${msg}`);
  };
  const bad = (msg: string) => {
    problems++;
    console.log(`  ✗ ${msg}`);
  };

  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  Errementari Doctor");
  console.log("═══════════════════════════════════════════");
  console.log("");

  // ── Manifest ─────────────────────────────────────────────────────────────
  const manifest = readManifest(target);
  if (!manifest) {
    bad("No .errementari.json manifest found. Run 'errementari init'.");
    console.log("");
    process.exitCode = 1;
    return;
  }
  ok(`Manifest found (v${manifest.version}, ${Object.keys(manifest.files).length} files)`);

  const currentVersion = JSON.parse(readFileSync(join(rootDir(), "package.json"), "utf-8")).version;
  const cmp = compareVersions(manifest.version, currentVersion);
  if (cmp < 0)
    warn(
      `Harness is outdated (v${manifest.version} < v${currentVersion}). Run 'errementari upgrade'.`,
    );
  else if (cmp > 0)
    warn(
      `Harness (v${manifest.version}) is newer than this CLI (v${currentVersion}). Update Errementari.`,
    );
  else ok("Harness version matches this CLI");

  // ── Files present ────────────────────────────────────────────────────────
  const missing = Object.keys(manifest.files).filter((f) => !existsSync(join(target, f)));
  if (missing.length === 0) {
    ok("All manifest files present on disk");
  } else {
    bad(`${missing.length} manifest file(s) missing (run 'errementari upgrade' to restore):`);
    for (const f of missing) console.log(`      - ${f}`);
  }

  // ── JSON configs parse ───────────────────────────────────────────────────
  for (const jsonFile of Object.keys(manifest.files).filter((f) => f.endsWith(".json"))) {
    const path = join(target, jsonFile);
    if (!existsSync(path)) continue;
    try {
      JSON.parse(readFileSync(path, "utf-8"));
      ok(`${jsonFile} is valid JSON`);
    } catch (e) {
      bad(`${jsonFile} is NOT valid JSON: ${(e as Error).message}`);
    }
  }

  // ── Git hooks ────────────────────────────────────────────────────────────
  if (existsSync(join(target, ".git"))) {
    try {
      const hooksPath = execSync("git config core.hooksPath", {
        cwd: target,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (hooksPath === ".opencode/pipeline")
        ok("Git hooks configured (core.hooksPath = .opencode/pipeline)");
      else
        warn(
          `core.hooksPath is '${hooksPath}', expected '.opencode/pipeline' — pre-commit enforcement inactive`,
        );
    } catch {
      warn("core.hooksPath not set — run: git config core.hooksPath .opencode/pipeline");
    }
  } else {
    warn("Not a git repository — pre-commit enforcement inactive");
  }

  // ── opencode plugin deps ─────────────────────────────────────────────────
  if (existsSync(join(target, ".opencode", "package.json"))) {
    if (existsSync(join(target, ".opencode", "node_modules")))
      ok("opencode plugin dependencies installed");
    else warn("opencode plugin deps missing — run: cd .opencode && npm install");
  }

  // ── Platform ─────────────────────────────────────────────────────────────
  if (process.platform === "win32") {
    warn("Windows detected — harness hooks require bash (WSL or Git Bash)");
  }

  console.log("");
  if (problems > 0) {
    console.log(`  ${problems} problem(s), ${warnings} warning(s).`);
    process.exitCode = 1;
  } else {
    console.log(`  Healthy. ${warnings} warning(s).`);
  }
  console.log("");
}
