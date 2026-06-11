import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detect } from "./detect.js";
import { getTemplateMappings, init, readManifest } from "./render.js";

function makeTempProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "erm-render-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeJson(path: string, obj: unknown) {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

function setupMonorepoFixture(root: string) {
  writeJson(join(root, "package.json"), {
    name: "fixture-mono",
    description: "Monorepo fixture",
    workspaces: ["apps/*"],
    devDependencies: { typescript: "^5.0.0" },
  });
  writeFileSync(join(root, "pnpm-lock.yaml"), "");
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  mkdirSync(join(root, "apps", "mobile"), { recursive: true });
  writeJson(join(root, "apps", "api", "package.json"), {
    name: "api",
    description: "API backend",
    dependencies: { "@nestjs/core": "^10.0.0" },
  });
  writeJson(join(root, "apps", "mobile", "package.json"), {
    name: "mobile",
    description: "Mobile frontend",
    dependencies: { "react-native": "0.74.0" },
  });
}

test("init renders all mapped files and a coherent manifest", () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupMonorepoFixture(root);
    const ctx = detect(root);
    const manifest = init(root, ctx);

    for (const file of Object.keys(manifest.files)) {
      assert.ok(existsSync(join(root, file)), `missing on disk: ${file}`);
    }

    const reread = readManifest(root);
    assert.ok(reread);
    assert.equal(reread!.version, manifest.version);
  } finally {
    cleanup();
  }
});

test("every rendered .json file parses as valid JSON", () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupMonorepoFixture(root);
    const ctx = detect(root);
    const manifest = init(root, ctx);

    const jsonFiles = Object.keys(manifest.files).filter((f) => f.endsWith(".json"));
    assert.ok(jsonFiles.length >= 2, "expected at least settings.json and opencode.json");
    for (const file of jsonFiles) {
      const content = readFileSync(join(root, file), "utf-8");
      assert.doesNotThrow(() => JSON.parse(content), `invalid JSON: ${file}`);
    }
  } finally {
    cleanup();
  }
});

test("settings.json contains Bash permissions without trailing-comma corruption", () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupMonorepoFixture(root);
    init(root, detect(root));

    const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf-8"));
    const allow: string[] = settings.permissions.allow;
    assert.ok(allow.some((p) => p.startsWith("Bash(")));
    assert.ok(allow.includes("Read(.claude/**)"));
  } finally {
    cleanup();
  }
});

test("opencode.json preserves the literal {{input}} placeholder for opencode", () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupMonorepoFixture(root);
    init(root, detect(root));

    const opencode = JSON.parse(readFileSync(join(root, "opencode.json"), "utf-8"));
    assert.ok(
      opencode.command.task.template.includes("{{input}}"),
      "the {{input}} placeholder must survive Handlebars rendering",
    );
  } finally {
    cleanup();
  }
});

test("frontend agent installed only when the project has a frontend", () => {
  const backendOnly = makeTempProject();
  const withFrontend = makeTempProject();
  try {
    writeJson(join(backendOnly.root, "package.json"), {
      name: "api-only",
      dependencies: { express: "^4.0.0" },
    });
    const beMappings = getTemplateMappings(detect(backendOnly.root));
    assert.ok(!beMappings.some((m) => m.target === ".claude/agents/frontend.md"));

    setupMonorepoFixture(withFrontend.root);
    const feMappings = getTemplateMappings(detect(withFrontend.root));
    assert.ok(feMappings.some((m) => m.target === ".claude/agents/frontend.md"));
    assert.ok(feMappings.some((m) => m.target === ".opencode/agents/frontend.md"));
  } finally {
    backendOnly.cleanup();
    withFrontend.cleanup();
  }
});

test("Claude Code agents get frontmatter; opencode agents do not", () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupMonorepoFixture(root);
    init(root, detect(root));

    const claudeAgent = readFileSync(join(root, ".claude", "agents", "qa.md"), "utf-8");
    assert.ok(claudeAgent.startsWith("---\nname: qa\n"));

    const opencodeAgent = readFileSync(join(root, ".opencode", "agents", "qa.md"), "utf-8");
    assert.ok(!opencodeAgent.startsWith("---"));
  } finally {
    cleanup();
  }
});
