import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync } from "fs";
import { dirname, join, resolve } from "path";
import prompts from "prompts";
import { fileHash, readManifest } from "../render.js";

function removeEmptyDirsUpward(dir: string, stopAt: string) {
  let current = dir;
  while (current.startsWith(stopAt) && current !== stopAt) {
    try {
      if (readdirSync(current).length > 0) return;
      rmdirSync(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

export async function uninstallCommand(targetDir?: string, options?: { yes?: boolean }) {
  const target = targetDir ? resolve(targetDir) : process.cwd();

  const manifest = readManifest(target);
  if (!manifest) {
    console.log("No Errementari harness found in this project. Nothing to do.");
    return;
  }

  const files = Object.keys(manifest.files);
  console.log(
    `\nThis will remove ${files.length} harness files (v${manifest.version}) from:\n  ${target}\n`,
  );

  if (!options?.yes) {
    const { confirmed } = await prompts({
      type: "confirm",
      name: "confirmed",
      message: "Remove the harness? (your code, specs and files you modified are not touched)",
      initial: false,
    });
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  let removed = 0;
  const preserved: string[] = [];
  const dirs = new Set<string>();
  for (const rel of files) {
    const path = join(target, rel);
    if (!existsSync(path)) continue;

    // Files the user modified since install (e.g. LEARNINGS.md with content,
    // an edited CLAUDE.md) hold user data — preserve them instead of deleting.
    const baseline = manifest.files[rel].originalHash || manifest.files[rel].hash;
    if (baseline) {
      try {
        if (fileHash(readFileSync(path, "utf-8")) !== baseline) {
          preserved.push(rel);
          continue;
        }
      } catch {
        preserved.push(rel);
        continue;
      }
    }

    rmSync(path, { force: true });
    removed++;
    dirs.add(dirname(path));
  }

  // Runtime artifacts not tracked in the manifest
  for (const extra of [
    ".errementari.json",
    ".opencode/node_modules",
    ".opencode/package-lock.json",
    ".opencode/pipeline/state.json",
    ".opencode/pipeline/close-pending.json",
    ".opencode/pipeline/coordination.json",
  ]) {
    const path = join(target, extra);
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }

  for (const dir of dirs) removeEmptyDirsUpward(dir, target);

  // Unset the git hooks path if we own it
  if (existsSync(join(target, ".git"))) {
    try {
      const hooksPath = execSync("git config core.hooksPath", {
        cwd: target,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (hooksPath === ".opencode/pipeline") {
        execSync("git config --unset core.hooksPath", { cwd: target, stdio: "pipe" });
        console.log("  ✓ Git hooks path restored");
      }
    } catch {
      // hooksPath was not set — nothing to restore
    }
  }

  if (preserved.length > 0) {
    console.log(
      `\n  Preserved ${preserved.length} file(s) you modified (delete manually if unwanted):`,
    );
    for (const f of preserved) console.log(`    - ${f}`);
  }

  console.log(`\nRemoved ${removed} files. Harness uninstalled.\n`);
}
