import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateClaudeIgnore } from "./conventions.js";
import { detectExistingHarness } from "./detect.js";
import { extractSections, generateSummary, mergeClaudeMd } from "./reconcile.js";
import type { ProjectContext } from "./types.js";

function makeTempProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "erm-rec-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function _writeJson(path: string, obj: unknown) {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

// ── detectExistingHarness ─────────────────────────────────────────────────────

test("detectExistingHarness empty project returns no files", () => {
  const { root, cleanup } = makeTempProject();
  try {
    const result = detectExistingHarness(root);
    assert.equal(result.files.length, 0);
    assert.equal(result.hasClaudeMd, false);
    assert.equal(result.hasClaudeDir, false);
  } finally {
    cleanup();
  }
});

test("detectExistingHarness detects CLAUDE.md", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeFileSync(join(root, "CLAUDE.md"), "# My project\n## Stack\n- React\n");
    const result = detectExistingHarness(root);
    assert.equal(result.hasClaudeMd, true);
    assert.ok(result.files.some((f) => f.path === "CLAUDE.md" && f.category === "harness-owned"));
  } finally {
    cleanup();
  }
});

test("detectExistingHarness classifies custom agents", () => {
  const { root, cleanup } = makeTempProject();
  try {
    mkdirSync(join(root, ".claude", "agents"), { recursive: true });
    writeFileSync(join(root, ".claude", "agents", "security.md"), "## Security agent");
    writeFileSync(join(root, ".claude", "agents", "spec.md"), "## Spec agent");

    const result = detectExistingHarness(root);
    assert.deepEqual(result.customAgents, ["security"]);
    assert.deepEqual(result.harnessAgents, ["spec"]);
    assert.equal(result.hasClaudeDir, true);
  } finally {
    cleanup();
  }
});

test("detectExistingHarness detects settings.local.json as custom", () => {
  const { root, cleanup } = makeTempProject();
  try {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.local.json"), "{}");
    writeFileSync(join(root, ".claude", "settings.json"), "{}");

    const result = detectExistingHarness(root);
    assert.equal(result.hasSettingsLocalJson, true);
    assert.equal(result.hasSettingsJson, true);
    const localFile = result.files.find((f) => f.path === ".claude/settings.local.json");
    assert.equal(localFile?.category, "custom");
  } finally {
    cleanup();
  }
});

// ── extractSections ───────────────────────────────────────────────────────────

test("extractSections parses H2 sections from CLAUDE.md", () => {
  const md = [
    "# My Project",
    "",
    "## Stack",
    "- React",
    "- TypeScript",
    "",
    "## Commands",
    "pnpm dev",
    "pnpm build",
    "",
    "## Agents",
    "pipeline, spec",
  ].join("\n");

  const sections = extractSections(md);
  assert.ok("Stack" in sections);
  assert.ok("Commands" in sections);
  assert.ok(!("Agents" in sections), "harness sections should be filtered out");
  assert.ok(sections.Stack.includes("- React"));
  assert.ok(sections.Commands.includes("pnpm dev"));
});

test("extractSections ignores harness-owned H2 sections", () => {
  const harnessSections = [
    "Development pipeline",
    "Feature pipeline",
    "Bugfix pipeline",
    "Git workflow",
    "Automatic validations",
    "Conventions",
    "Self-improvement",
    "Self-improvement (learnings)",
    "Agents",
    "Project",
  ];

  for (const section of harnessSections) {
    const md = `## ${section}\nsome content`;
    const sections = extractSections(md);
    assert.ok(!(section in sections), `section "${section}" should be ignored`);
  }
});

test("extractSections handles empty content", () => {
  const sections = extractSections("");
  assert.deepEqual(sections, {});
});

// ── mergeClaudeMd ─────────────────────────────────────────────────────────────

function makeFakeCtx(): ProjectContext {
  return {
    name: "test-project",
    slug: "test-project",
    description: "A test project",
    isNode: true,
    isTypeScript: true,
    isPython: false,
    isGo: false,
    hasBackend: false,
    hasFrontend: true,
    monorepo: false,
    usesHexagonalArchitecture: false,
    packageManager: "pnpm",
    frontendFramework: "react",
    testCommand: "pnpm test",
    buildCommand: "pnpm build",
    lintCommand: "pnpm lint",
    typecheckCommand: "pnpm typecheck",
    usesMutationTesting: false,
    mutationTestCommand: "",
    workspaceDirs: [],
    services: [],
    usesKafka: false,
    usesRedis: false,
    usesSSE: false,
    hasDocker: false,
    hasFirebase: false,
    usesVite: true,
    usesSSG: false,
    usesBDD: false,
    permCommands: ["pnpm test", "pnpm lint", "pnpm typecheck"],
    selectedCLIs: ["claude", "opencode"],
  };
}

test("mergeClaudeMd inserts extracted Stack section", () => {
  const template = [
    "## Stack",
    "",
    "| Layer | Technology |",
    "|---|---|",
    "| Package manager | pnpm |",
    "",
    "## Conventions",
    "",
    "- TDD",
  ].join("\n");

  const oldSections = {
    Stack: "React 18 + TypeScript + Vite + GSAP 3",
  };

  const ctx = makeFakeCtx();
  const result = mergeClaudeMd(template, oldSections, ctx);
  assert.ok(result.includes("React 18"));
  assert.ok(result.includes("GSAP 3"));
});

test("mergeClaudeMd inserts custom non-matching sections after Commands", () => {
  const template = [
    "## Commands",
    "",
    "```bash",
    "pnpm test",
    "```",
    "",
    "## Development pipeline",
    "",
    "...",
  ].join("\n");

  const oldSections = {
    "Design decisions": "- Palette: #ece4d2",
    "Secciones activas": "Hero: active",
  };

  const ctx = makeFakeCtx();

  const result = mergeClaudeMd(template, oldSections, ctx);
  assert.ok(result.includes("Design decisions"));
  assert.ok(result.includes("Palette: #ece4d2"));
  assert.ok(result.includes("Secciones activas"));
});

test("mergeClaudeMd generates project conventions for frontend", () => {
  const template = "## Conventions\n- TDD\n\n## Agents";
  const oldSections: Record<string, string> = {};
  const ctx = makeFakeCtx();

  const result = mergeClaudeMd(template, oldSections, ctx);
  assert.ok(result.includes("Frontend conventions"));
  assert.ok(result.includes("src/components/"));
});

// ── generateClaudeIgnore ──────────────────────────────────────────────────────

test("generateClaudeIgnore for React Vite project includes vite patterns", () => {
  const ctx = makeFakeCtx();
  const result = generateClaudeIgnore(ctx);
  assert.ok(result.includes(".vite/"));
  assert.ok(result.includes("node_modules/"));
  assert.ok(result.includes("dist/"));
});

test("generateClaudeIgnore for Firebase project includes .firebase", () => {
  const ctx = { ...makeFakeCtx(), hasFirebase: true };
  const result = generateClaudeIgnore(ctx);
  assert.ok(result.includes(".firebase/"));
});

test("generateClaudeIgnore for Docker project includes .docker", () => {
  const ctx = { ...makeFakeCtx(), hasDocker: true };
  const result = generateClaudeIgnore(ctx);
  assert.ok(result.includes(".docker/"));
});

// ── generateSummary ───────────────────────────────────────────────────────────

test("generateSummary lists custom and harness agents", () => {
  const summary = generateSummary({
    files: [],
    hasClaudeMd: true,
    hasOpencodeDir: false,
    hasClaudeDir: true,
    hasClaudeIgnore: false,
    hasSettingsJson: false,
    hasSettingsLocalJson: false,
    customAgents: ["security"],
    harnessAgents: ["spec", "qa"],
  });

  assert.ok(summary.includes("security"));
  assert.ok(summary.includes("spec"));
  assert.ok(summary.includes("qa"));
});
