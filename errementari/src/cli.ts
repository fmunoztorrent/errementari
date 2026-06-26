#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

function fail(error: unknown): never {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const program = new Command();

program
  .name("errementari")
  .description("Dual-tool (Claude Code + opencode) development pipeline harness")
  .version(pkg.version)
  .enablePositionalOptions();

program
  .command("init")
  .description("Initialize the harness in a project")
  .argument("[dir]", "Target project directory (defaults to CWD)")
  .option("-y, --yes", "Skip prompts and use detected values")
  .option("--interactive", "Prompt for each file conflict (default: auto-merge)")
  .option("--dry-run", "Show what would be installed without writing files")
  .action(
    async (dir?: string, options?: { yes?: boolean; dryRun?: boolean; interactive?: boolean }) => {
      try {
        const { initCommand } = await import("./commands/init.js");
        await initCommand(dir, options);
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("upgrade")
  .description("Upgrade an existing harness installation")
  .argument("[dir]", "Target project directory (defaults to CWD)")
  .option("--dry-run", "Preview what the upgrade would change without writing files")
  .action(async (dir?: string, options?: { dryRun?: boolean }) => {
    try {
      const { upgradeCommand } = await import("./commands/upgrade.js");
      await upgradeCommand(dir, options);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("status")
  .description("Show harness installation status")
  .argument("[dir]", "Target project directory (defaults to CWD)")
  .action(async (dir?: string) => {
    try {
      const { statusCommand } = await import("./commands/status.js");
      statusCommand(dir);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("doctor")
  .description("Check the health of a harness installation")
  .argument("[dir]", "Target project directory (defaults to CWD)")
  .action(async (dir?: string) => {
    try {
      const { doctorCommand } = await import("./commands/doctor.js");
      await doctorCommand(dir);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("uninstall")
  .description("Remove the harness from a project")
  .argument("[dir]", "Target project directory (defaults to CWD)")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (dir?: string, options?: { yes?: boolean }) => {
    try {
      const { uninstallCommand } = await import("./commands/uninstall.js");
      await uninstallCommand(dir, options);
    } catch (e) {
      fail(e);
    }
  });

// Default command = init ("errementari" / "errementari ./my-project")
program
  .argument("[dir]", "Target project directory (defaults to CWD)")
  .option("-y, --yes", "Skip prompts and use detected values")
  .option("--dry-run", "Show what would be installed without writing files")
  .action(async (dir?: string, options?: { yes?: boolean; dryRun?: boolean }) => {
    try {
      const { initCommand } = await import("./commands/init.js");
      await initCommand(dir, options);
    } catch (e) {
      fail(e);
    }
  });

program.parse();
