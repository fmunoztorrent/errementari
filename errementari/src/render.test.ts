import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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

// ── init: keepTargets + stub protection ──────────────────────────────────────

test("init keepTargets leaves the existing file untouched and protects it from upgrade", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), {
      name: "fixture-keep",
      description: "Keep fixture",
      devDependencies: { typescript: "^5.0.0" },
    });
    const userClaudeMd = "# My very own CLAUDE.md\nDo not replace.\n";
    writeFileSync(join(root, "CLAUDE.md"), userClaudeMd);

    const manifest = init(root, detect(root), { keepTargets: new Set(["CLAUDE.md"]) });

    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf-8"), userClaudeMd);
    const entry = manifest.files["CLAUDE.md"];
    assert.ok(entry, "kept file must still be registered in the manifest");
    assert.notEqual(
      entry.hash,
      entry.originalHash,
      "baseline must differ from disk so upgrade treats it as user-modified",
    );
  } finally {
    cleanup();
  }
});

test("init never overwrites a non-empty existing stub", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), {
      name: "fixture-stub",
      description: "Stub fixture",
      devDependencies: { typescript: "^5.0.0" },
    });
    const learnings = join(root, ".claude", "LEARNINGS.md");
    mkdirSync(join(root, ".claude"), { recursive: true });
    const userContent = "# learnings\n- prior wisdom\n";
    writeFileSync(learnings, userContent);

    init(root, detect(root));

    assert.equal(readFileSync(learnings, "utf-8"), userContent);
  } finally {
    cleanup();
  }
});

test("init renders hardcode-patterns.json with the project slug", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), {
      name: "My Cool App",
      description: "Slug fixture",
      devDependencies: { typescript: "^5.0.0" },
    });

    init(root, detect(root));

    const rendered = readFileSync(
      join(root, ".opencode", "pipeline", "hardcode-patterns.json"),
      "utf-8",
    );
    assert.ok(
      rendered.includes("my-cool-app-[a-z]+-[0-9]+"),
      "slug must be rendered into the regex",
    );
    JSON.parse(rendered); // must be valid JSON
  } finally {
    cleanup();
  }
});

test("every settings.json hook that runs `node .opencode/pipeline/<file>` is installed on disk", () => {
  const { root, cleanup } = makeTempProject();
  try {
    setupMonorepoFixture(root);
    init(root, detect(root));

    const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf-8"));
    const commands: string[] = [];
    type HookGroup = Array<{ hooks: Array<{ command: string }> }>;
    for (const group of Object.values(settings.hooks) as HookGroup[]) {
      for (const matcher of group) {
        for (const h of matcher.hooks) commands.push(h.command);
      }
    }

    // Collect `node .opencode/pipeline/<file>` references and assert each exists.
    const referenced = commands
      .map((c) => /node (\.opencode\/pipeline\/[^\s]+)/.exec(c)?.[1])
      .filter((p): p is string => Boolean(p));

    assert.ok(
      referenced.includes(".opencode/pipeline/pipeline-cli.mjs"),
      "guard-edit/check-activation/sync-todos hooks should reference pipeline-cli.mjs",
    );
    for (const rel of referenced) {
      assert.ok(existsSync(join(root, rel)), `hook references a file init never installs: ${rel}`);
    }

    // The JS wrapper must delegate to the installed plugin, not contain logic.
    const wrapper = readFileSync(join(root, ".opencode", "pipeline", "pipeline-cli.mjs"), "utf-8");
    assert.ok(
      wrapper.includes("node_modules/errementari/pipeline/pipeline-cli.mjs"),
      "wrapper must delegate to the node_modules plugin",
    );
  } finally {
    cleanup();
  }
});
