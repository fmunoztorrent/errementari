import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import prompts from "prompts";
import { detect, detectAvailableCLIs, detectExistingHarness } from "../detect.js";
import { backupFile, extractSections, generateSummary, mergeClaudeMd } from "../reconcile.js";
import {
  fileHash,
  getTemplateMappings,
  readManifest,
  init as renderInit,
  renderMappingContent,
  rootDir,
} from "../render.js";
import type { MergeAction } from "../types.js";

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
  options?: { yes?: boolean; dryRun?: boolean; interactive?: boolean },
) {
  const autoConfirm = options?.yes || false;
  const dryRun = options?.dryRun || false;
  const interactive = options?.interactive || false;
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
  const installedManifest = readManifest(target);
  if (installedManifest) {
    console.log(`  ✓ Harness already installed (v${installedManifest.version})`);
    console.log(`    Installed at: ${installedManifest.installed_at}`);
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

  // ── Select AI coding CLIs ────────────────────────────────────────────────
  const available = detectAvailableCLIs();
  const detectedIds = available.filter((c) => c.found).map((c) => c.id);
  const cliDefaults = detectedIds.length > 0 ? detectedIds : ["claude", "opencode"];

  if (autoConfirm) {
    ctx.selectedCLIs = cliDefaults;
    console.log(`  CLIs: ${ctx.selectedCLIs.join(", ")} (auto-detected)`);
    console.log("");
  } else {
    const cliResponse = await prompts({
      type: "multiselect",
      name: "clis",
      message: "Select AI coding CLIs to install support for",
      choices: available.map((c) => ({
        title: c.found ? `${c.name} (detected)` : c.name,
        value: c.id,
        selected: c.found,
      })),
      min: 1,
      hint: "- Space to select. Enter to confirm",
    });

    if (!cliResponse.clis || cliResponse.clis.length === 0) {
      console.log("  Cancelled: at least one CLI must be selected.");
      return;
    }

    ctx.selectedCLIs = cliResponse.clis;
    console.log("");
  }

  // ── Detect existing harness files ───────────────────────────────────────
  const existingFiles = detectExistingHarness(target);

  // ── Dry run: list what would be installed and stop (no writes at all) ────
  if (dryRun) {
    if (existingFiles.files.length > 0) {
      console.log(generateSummary(existingFiles));
      console.log("");
    }
    const mappings = getTemplateMappings(ctx);
    const wrapperCount = 6; // pipeline wrappers
    const staticCount = 2; // .opencode/package.json + .gitignore
    console.log(
      `  [dry-run] Would install ${mappings.length + staticCount + wrapperCount + 1} items:`,
    );
    console.log(`    + .opencode/pipeline/* (${wrapperCount} wrappers → plugin)`);
    console.log(`    + .opencode/package.json + .gitignore (plugin deps)`);
    for (const m of mappings) console.log(`    + ${m.target} (${m.type})`);
    console.log(`    + .claude/agents/* + .opencode/agents/* (synced from plugin)`);
    console.log("    + .errementari.json (manifest)");
    console.log("");
    return;
  }

  // ── Confirm (before any file is touched) ─────────────────────────────────
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

  // ── Reconciliation decisions (uses the FINAL ctx from the prompts) ───────
  const keepTargets = new Set<string>();
  let mergedClaudeMdContent: string | null = null;

  if (existingFiles.files.length > 0) {
    console.log(generateSummary(existingFiles));
    console.log("");

    let claudeMdAction: MergeAction;
    let overwriteAgents: boolean;
    let regenerateIgnore: boolean;

    if (interactive) {
      const reconcileResponse = await prompts([
        {
          type: "select",
          name: "claudeMdAction",
          message: `CLAUDE.md — what to do?`,
          choices: [
            {
              title: "Merge: extract project data and integrate into new template (recommended)",
              value: "merge",
            },
            { title: "Keep existing as-is", value: "keep" },
            { title: "Overwrite with harness template", value: "overwrite" },
            { title: "Skip CLAUDE.md entirely", value: "skip" },
          ],
        },
        {
          type: () => (existingFiles.harnessAgents.length > 0 ? "confirm" : null),
          name: "overwriteAgents",
          message: `Overwrite ${existingFiles.harnessAgents.length} harness agent files? Your versions will be backed up.`,
          initial: false,
        },
        {
          type: () => (existingFiles.hasClaudeIgnore ? "confirm" : null),
          name: "regenerateIgnore",
          message: "Regenerate .claudeignore with project-specific best practices?",
          initial: true,
        },
        {
          type: "confirm",
          name: "confirmed",
          message: "Proceed with reconciliation?",
          initial: true,
        },
      ]);

      if (!reconcileResponse.confirmed) {
        console.log("  Cancelled.");
        return;
      }
      claudeMdAction = (reconcileResponse.claudeMdAction as MergeAction) || "merge";
      overwriteAgents = reconcileResponse.overwriteAgents === true;
      regenerateIgnore = reconcileResponse.regenerateIgnore !== false;
    } else {
      // Auto-reconciliation mode (default)
      console.log("  Auto-reconciling existing files...");
      console.log("");
      claudeMdAction = "merge";
      overwriteAgents = true;
      regenerateIgnore = true;
    }

    // CLAUDE.md: merge extracts project data from the existing file into the
    // freshly rendered template; keep/skip leaves the existing file untouched.
    if (claudeMdAction === "keep" || claudeMdAction === "skip") {
      keepTargets.add("CLAUDE.md");
    } else if (claudeMdAction === "merge" && existingFiles.hasClaudeMd) {
      const oldSections = extractSections(readFileSync(join(target, "CLAUDE.md"), "utf-8"));
      if (Object.keys(oldSections).length > 0) {
        const claudeMapping = getTemplateMappings(ctx).find((m) => m.target === "CLAUDE.md");
        const rendered = claudeMapping ? renderMappingContent(claudeMapping, ctx) : null;
        if (rendered) {
          mergedClaudeMdContent = mergeClaudeMd(rendered, oldSections, ctx);
          console.log(`  ✓ CLAUDE.md: project data extracted and merged`);
        }
      }
    }

    if (!overwriteAgents) {
      for (const agent of existingFiles.harnessAgents) {
        keepTargets.add(`.claude/agents/${agent}.md`);
      }
    }
    if (existingFiles.hasClaudeIgnore && !regenerateIgnore) {
      keepTargets.add(".claudeignore");
    }

    // Back up every existing file we are about to overwrite
    const backups: string[] = [];
    const backupIfOverwriting = (rel: string) => {
      if (!keepTargets.has(rel) && existsSync(join(target, rel))) {
        const backup = backupFile(target, rel);
        if (backup) backups.push(backup);
      }
    };
    if (existingFiles.hasClaudeMd) backupIfOverwriting("CLAUDE.md");
    if (existingFiles.hasClaudeIgnore) backupIfOverwriting(".claudeignore");
    for (const agent of existingFiles.harnessAgents) {
      backupIfOverwriting(`.claude/agents/${agent}.md`);
    }
    if (backups.length > 0) {
      console.log(`  Backups: ${backups.join(", ")}`);
    }
    if (existingFiles.customAgents.length > 0) {
      console.log(`  · Custom agents preserved: ${existingFiles.customAgents.join(", ")}`);
    }
    console.log("");
  }

  // ── Render ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("  Installing harness...");
  console.log("");

  const manifest = renderInit(target, ctx, { keepTargets });

  if (mergedClaudeMdContent && !keepTargets.has("CLAUDE.md")) {
    writeFileSync(join(target, "CLAUDE.md"), mergedClaudeMdContent);
    // Keep the manifest consistent with what is actually on disk. originalHash
    // stays as the plain template render, so `upgrade` sees the merged file as
    // user-modified and never overwrites the merged project data.
    const entry = manifest.files["CLAUDE.md"];
    if (entry) entry.hash = fileHash(mergedClaudeMdContent);
    writeFileSync(join(target, ".errementari.json"), JSON.stringify(manifest, null, 2));
  }

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
    } catch (err: unknown) {
      // npm install may fail because errementari isn't published on the public registry.
      // Fall back to installing from the local Errementari source checkout.
      const errementariSource = rootDir();
      console.log("  ⚠ npm install failed. Trying local install from Errementari source...");
      try {
        execSync(`npm install --no-save "${errementariSource}"`, {
          cwd: opencodeDir,
          stdio: "inherit",
        });
        console.log("  ✓ Plugin installed from local path");
      } catch (err2: unknown) {
        console.log("  ⚠ Could not install plugin dependencies. Run manually:");
        console.log(`    cd ${opencodeDir} && npm install "${errementariSource}"`);
        console.log("    or: cd ${errementariSource} && npm link && cd ${opencodeDir} && npm link errementari");
      }
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  Next steps:");
  console.log("  1. Review CLAUDE.md — adjust project-specific sections");
  if (ctx.selectedCLIs.includes("claude")) {
    console.log("  2. Review .claude/settings.json — adjust permissions");
    console.log("  3. For Claude Code: claude plugin install github.com/fmunoztorrent/errementari");
  }
  if (ctx.selectedCLIs.includes("opencode")) {
    console.log("  4. For OpenCode: the plugin loads from .opencode/node_modules/");
  }
  console.log("  5. Start a pipeline: /task 'your first feature'");
  console.log("     SPDD+SDD+BDD+TDD: analysis → Canvas → RED → GREEN → close");
  console.log("═══════════════════════════════════════════");
  console.log("");
}
