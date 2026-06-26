import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareVersions, upgradeCommand } from "./commands/upgrade.js";
import { detect } from "./detect.js";
import { init, readManifest } from "./render.js";
import type { Manifest } from "./types.js";

function makeTempProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "erm-upgrade-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeJson(path: string, obj: unknown) {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

function setupInstalledProject(root: string): Manifest {
  writeJson(join(root, "package.json"), {
    name: "fixture-app",
    description: "Upgrade fixture",
    dependencies: { express: "^4.0.0" },
    devDependencies: { typescript: "^5.0.0" },
  });
  return init(root, detect(root));
}

function markInstalledVersion(root: string, version: string) {
  const manifest = readManifest(root)!;
  manifest.version = version;
  writeJson(join(root, ".errementari.json"), manifest);
}

test("compareVersions orders semver numerically", () => {
  assert.ok(compareVersions("1.0.0", "1.1.0") < 0);
  assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
});

test("upgrade refreshes unmodified generic files and bumps the manifest version", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    markInstalledVersion(root, "0.9.0");

    await upgradeCommand(root);

    const manifest = readManifest(root)!;
    assert.notEqual(manifest.version, "0.9.0");
  } finally {
    cleanup();
  }
});

test("upgrade preserves user-modified generic files", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    const checkSh = join(root, ".opencode", "pipeline", "check.sh");
    const customized = `${readFileSync(checkSh, "utf-8")}\n# my custom tweak\n`;
    writeFileSync(checkSh, customized);
    markInstalledVersion(root, "0.9.0");

    await upgradeCommand(root);

    assert.equal(readFileSync(checkSh, "utf-8"), customized, "user edit must survive upgrade");
  } finally {
    cleanup();
  }
});

test("upgrade preserves user-modified templates", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    const claudeMd = join(root, "CLAUDE.md");
    const customized = `${readFileSync(claudeMd, "utf-8")}\n## My project notes\n`;
    writeFileSync(claudeMd, customized);
    markInstalledVersion(root, "0.9.0");

    await upgradeCommand(root);

    assert.equal(readFileSync(claudeMd, "utf-8"), customized);
  } finally {
    cleanup();
  }
});

test("upgrade restores files deleted from disk", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    const qaAgent = join(root, ".claude", "agents", "qa.md");
    rmSync(qaAgent);
    markInstalledVersion(root, "0.9.0");

    await upgradeCommand(root);

    assert.ok(readFileSync(qaAgent, "utf-8").length > 0);
  } finally {
    cleanup();
  }
});

test("upgrade never touches stub files with user content", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    const learnings = join(root, ".claude", "LEARNINGS.md");
    writeFileSync(learnings, "# my learnings\n- something important\n");
    markInstalledVersion(root, "0.9.0");

    await upgradeCommand(root);

    assert.equal(readFileSync(learnings, "utf-8"), "# my learnings\n- something important\n");
  } finally {
    cleanup();
  }
});

test("upgrade refuses to downgrade", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    markInstalledVersion(root, "99.0.0");
    const before = readFileSync(join(root, "CLAUDE.md"), "utf-8");

    const prevExitCode = process.exitCode;
    await upgradeCommand(root);
    const failed = process.exitCode === 1;
    process.exitCode = prevExitCode;

    assert.ok(failed, "downgrade must set a failure exit code");
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf-8"), before);
    assert.equal(readManifest(root)!.version, "99.0.0");
  } finally {
    cleanup();
  }
});

test("upgrade removes obsolete generic files no longer shipped", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    // Simulate a file installed by an older version that the harness dropped
    // (e.g. the pre-commit.sh → pre-commit rename).
    const stalePath = join(root, ".opencode", "pipeline", "pre-commit.sh");
    const staleContent = "#!/bin/bash\necho old hook\n";
    writeFileSync(stalePath, staleContent);
    const manifest = readManifest(root)!;
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(staleContent).digest("hex");
    manifest.files[".opencode/pipeline/pre-commit.sh"] = {
      type: "generic",
      version: "0.9.0",
      hash,
      originalHash: hash,
    };
    manifest.version = "0.9.0";
    writeJson(join(root, ".errementari.json"), manifest);

    await upgradeCommand(root);

    assert.ok(!existsSync(stalePath), "obsolete unmodified file must be removed");
    assert.ok(
      !(".opencode/pipeline/pre-commit.sh" in readManifest(root)!.files),
      "manifest entry must be cleaned up",
    );
  } finally {
    cleanup();
  }
});

test("upgrade keeps obsolete generic files the user modified", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    const stalePath = join(root, ".opencode", "pipeline", "pre-commit.sh");
    writeFileSync(stalePath, "#!/bin/bash\necho heavily customized\n");
    const manifest = readManifest(root)!;
    manifest.files[".opencode/pipeline/pre-commit.sh"] = {
      type: "generic",
      version: "0.9.0",
      hash: "0".repeat(64), // baseline differs from disk → user-modified
      originalHash: "0".repeat(64),
    };
    manifest.version = "0.9.0";
    writeJson(join(root, ".errementari.json"), manifest);

    await upgradeCommand(root);

    assert.ok(existsSync(stalePath), "user-modified obsolete file must be preserved");
  } finally {
    cleanup();
  }
});

test("upgrade --dry-run writes nothing", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupInstalledProject(root);
    const checkSh = join(root, ".opencode", "pipeline", "check.sh");
    const customized = `${readFileSync(checkSh, "utf-8")}\n# tweak\n`;
    writeFileSync(checkSh, customized);
    markInstalledVersion(root, "0.9.0");

    await upgradeCommand(root, { dryRun: true });

    assert.equal(readManifest(root)!.version, "0.9.0", "dry-run must not bump the version");
    assert.equal(readFileSync(checkSh, "utf-8"), customized);
  } finally {
    cleanup();
  }
});
