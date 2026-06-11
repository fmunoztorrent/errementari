import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import prompts from "prompts";
import { detect } from "../detect.js";
import {
  getTemplateMappings,
  harnessDir,
  readManifest,
  init as renderInit,
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

export async function initCommand(
  targetDir?: string,
  options?: { yes?: boolean; dryRun?: boolean },
) {
  const autoConfirm = options?.yes || false;
  const dryRun = options?.dryRun || false;
  const target = targetDir ? resolve(targetDir) : process.cwd();

  if (!existsSync(target)) {
    console.error(`Error: directory not found: ${target}`);
    process.exitCode = 1;
    return;
  }

  if (resolve(target) === resolve(rootDir())) {
    console.error(
      "Error: refusing to install the harness into the Errementari source repo itself.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  Errementari — Harness Initializer");
  console.log("═══════════════════════════════════════════");
  console.log("");

  if (process.platform === "win32") {
    console.log("  ⚠ The harness hooks require bash. On Windows, use WSL or Git Bash.");
    console.log("");
  }

  // Check if already initialized
  const existing = readManifest(target);
  if (existing) {
    console.log(`  ✓ Harness already installed (v${existing.version})`);
    console.log(`    Installed at: ${existing.installed_at}`);
    console.log(`    Use 'errementari upgrade' to update.`);
    console.log("");
    return;
  }

  // ── Detect project ───────────────────────────────────────────────────────
  const ctx = detect(target);

  console.log("  Detection results:");
  console.log(`    Name:        ${ctx.name}`);
  console.log(`    Description: ${ctx.description}`);
  console.log(
    `    Languages:   ${[
      ctx.isTypeScript ? "TypeScript" : ctx.isNode ? "JavaScript (Node)" : "",
      ctx.isPython ? "Python" : "",
      ctx.isGo ? "Go" : "",
    ]
      .filter(Boolean)
      .join(", ")}`,
  );
  console.log(`    Monorepo:    ${ctx.monorepo ? "yes" : "no"}`);
  console.log(`    Backend:     ${ctx.hasBackend ? ctx.backendFramework || "yes" : "no"}`);
  console.log(`    Frontend:    ${ctx.hasFrontend ? ctx.frontendFramework || "yes" : "no"}`);
  console.log(`    Package mgr: ${ctx.packageManager}`);
  console.log(`    Docker:      ${ctx.hasDocker ? "yes" : "no"}`);
  console.log("");

  // ── Dry run: list what would be installed and stop ───────────────────────
  if (dryRun) {
    const harnessFiles = listFiles(harnessDir(), harnessDir());
    const mappings = getTemplateMappings(ctx);
    console.log(`  [dry-run] Would install ${harnessFiles.length + mappings.length + 1} files:`);
    for (const f of harnessFiles) console.log(`    + ${f}`);
    for (const m of mappings) console.log(`    + ${m.target} (${m.type})`);
    console.log("    + .errementari.json (manifest)");
    console.log("");
    return;
  }

  // ── Confirm ──────────────────────────────────────────────────────────────
  if (!autoConfirm) {
    const response = await prompts([
      {
        type: "text",
        name: "name",
        message: "Project name",
        initial: ctx.name,
      },
      {
        type: "text",
        name: "description",
        message: "Description",
        initial: ctx.description,
      },
      {
        type: "confirm",
        name: "confirmed",
        message: "Install harness with this configuration?",
        initial: true,
      },
    ]);

    if (!response.confirmed) {
      console.log("  Cancelled.");
      return;
    }

    ctx.name = response.name || ctx.name;
    ctx.description = response.description || ctx.description;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("  Installing harness...");
  console.log("");

  const manifest = renderInit(target, ctx);

  console.log("");
  console.log(`  Harness v${manifest.version} installed successfully.`);
  console.log(`  ${Object.keys(manifest.files).length} files created.`);

  // ── Setup git hooks ──────────────────────────────────────────────────────
  const isGitRepo = existsSync(join(target, ".git"));
  if (isGitRepo) {
    try {
      execSync("git config core.hooksPath .opencode/pipeline", { cwd: target, stdio: "pipe" });
      console.log("  ✓ Git hooks configured (core.hooksPath = .opencode/pipeline)");
    } catch {
      console.log("  ⚠ Could not configure git hooks. Run manually:");
      console.log("    git config core.hooksPath .opencode/pipeline");
    }
  } else {
    console.log("  ⚠ Not a git repository — pre-commit enforcement is inactive until you run:");
    console.log("    git init && git config core.hooksPath .opencode/pipeline");
  }

  // ── Setup opencode plugin deps ───────────────────────────────────────────
  const opencodePkgJson = join(target, ".opencode", "package.json");
  if (existsSync(opencodePkgJson)) {
    const opencodeDir = join(target, ".opencode");
    try {
      console.log("  Installing opencode plugin dependencies...");
      execSync("npm install --no-save", { cwd: opencodeDir, stdio: "inherit" });
      console.log("  ✓ Plugin dependencies installed");
    } catch {
      console.log("  ⚠ Could not install plugin deps. Run manually:");
      console.log(`    cd ${opencodeDir} && npm install`);
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  Next steps:");
  console.log("  1. Review CLAUDE.md — adjust project-specific sections");
  console.log("  2. Review .claude/settings.json — adjust permissions");
  console.log("  3. Start a pipeline: /task 'your first feature'");
  console.log("═══════════════════════════════════════════");
  console.log("");
}
