import { createHash } from "crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import Handlebars from "handlebars";
import { basename, dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import type { Manifest, ManifestEntry, ProjectContext } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function rootDir(): string {
  return join(__dirname, "..");
}

function harnessDir(): string {
  return join(rootDir(), "harness");
}

function templatesDir(): string {
  return join(rootDir(), "templates");
}

export function renderTargetDir(): string {
  return rootDir();
}

// ── Handlebars helpers ────────────────────────────────────────────────────
Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper("neq", (a: unknown, b: unknown) => a !== b);

function compileTemplate(templatePath: string, ctx: ProjectContext): string {
  const source = readFileSync(templatePath, "utf-8");
  const template = Handlebars.compile(source, { noEscape: true });
  return template(ctx);
}

function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function copyDir(src: string, dest: string, skip?: Set<string>) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDir(srcPath, destPath, skip);
    } else {
      if (skip?.has(destPath)) continue;
      copyFileSync(srcPath, destPath);
      chmodSync(destPath, st.mode);
    }
  }
}

// ── Template mapping ──────────────────────────────────────────────────────
export interface TemplateMapping {
  template: string; // relative to templatesDir()
  target: string; // relative to project root
  type: "template" | "static" | "stub";
}

export function getTemplateMappings(ctx: ProjectContext): TemplateMapping[] {
  const mappings: TemplateMapping[] = [
    { template: "CLAUDE.md.hbs", target: "CLAUDE.md", type: "template" },
    { template: "opencode.json.hbs", target: "opencode.json", type: "template" },
    { template: "settings.json.hbs", target: ".claude/settings.json", type: "template" },
    { template: ".claudeignore.hbs", target: ".claudeignore", type: "template" },
    { template: "AGENTS.md.hbs", target: ".claude/AGENTS.md", type: "template" },
    { template: "LEARNINGS.md.stub", target: ".claude/LEARNINGS.md", type: "stub" },
    // Stored under non-dotfile names: npm pack drops .gitignore/package.json
    // files inside packed directories, so these can't live in harness/
    { template: "opencode-package.json", target: ".opencode/package.json", type: "static" },
    { template: "opencode-gitignore", target: ".opencode/.gitignore", type: "static" },
    // Learnings skills
    {
      template: "skills/qa-learnings/SKILL.md",
      target: ".claude/skills/qa-learnings/SKILL.md",
      type: "stub",
    },
    {
      template: "skills/backend-learnings/SKILL.md",
      target: ".claude/skills/backend-learnings/SKILL.md",
      type: "stub",
    },
    {
      template: "skills/architect-learnings/SKILL.md",
      target: ".claude/skills/architect-learnings/SKILL.md",
      type: "stub",
    },
  ];

  // Agent definitions, rendered for both tools
  const agents: Array<{ name: string; type: TemplateMapping["type"] }> = [
    { name: "pipeline", type: "static" },
    { name: "spec", type: "template" },
    { name: "architect", type: "template" },
    { name: "backend", type: "template" },
    { name: "qa", type: "template" },
  ];
  if (ctx.hasFrontend) {
    agents.push({ name: "frontend", type: "template" });
    mappings.push({
      template: "skills/frontend-learnings/SKILL.md",
      target: ".claude/skills/frontend-learnings/SKILL.md",
      type: "stub",
    });
  }
  for (const agent of agents) {
    const template =
      agent.type === "static" ? `agents/${agent.name}.md` : `agents/${agent.name}.md.hbs`;
    mappings.push(
      { template, target: `.opencode/agents/${agent.name}.md`, type: agent.type },
      { template, target: `.claude/agents/${agent.name}.md`, type: agent.type },
    );
  }

  return mappings;
}

// Default model per agent role. Adjust here when model lineups change;
// `upgrade` propagates the new frontmatter to unmodified installs.
const AGENT_MODELS: Record<string, string> = {
  pipeline: "sonnet",
  spec: "opus",
  architect: "opus",
  backend: "sonnet",
  frontend: "sonnet",
  qa: "sonnet",
};

const AGENT_TOOLS: Record<string, string> = {
  pipeline: "Read, Grep, Glob, Bash, WebFetch, Task, TodoWrite, Skill, AskUserQuestion",
  spec: "Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, mcp__context7__*",
  architect: "Read, Grep, Glob, Bash, WebFetch, mcp__context7__*",
  backend: "Read, Edit, Write, Glob, Grep, Bash, Skill, mcp__context7__*",
  frontend: "Read, Edit, Write, Glob, Grep, Bash, Skill, mcp__context7__*",
  qa: "Read, Edit, Write, Glob, Grep, Bash, Skill, Task",
};

function generateClaudeCodeFrontmatter(agentName: string): string {
  const model = AGENT_MODELS[agentName] || "sonnet";
  const tools = AGENT_TOOLS[agentName];
  return tools
    ? `---\nname: ${agentName}\nmodel: ${model}\ntools: ${tools}\n---\n\n`
    : `---\nname: ${agentName}\nmodel: ${model}\n---\n\n`;
}

export function renderMappingContent(mapping: TemplateMapping, ctx: ProjectContext): string | null {
  const srcPath = join(templatesDir(), mapping.template);

  if (!existsSync(srcPath)) {
    console.warn(`  ⚠ Template not found: ${mapping.template}`);
    return null;
  }

  let content: string;
  if (mapping.type === "template") {
    content = compileTemplate(srcPath, ctx);
  } else {
    content = readFileSync(srcPath, "utf-8");
  }

  if (mapping.type !== "stub" && mapping.target.startsWith(".claude/agents/")) {
    const agentName = basename(mapping.target, ".md");
    content = generateClaudeCodeFrontmatter(agentName) + content;
  }

  if (mapping.target.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (e) {
      throw new Error(
        `Rendered ${mapping.target} is not valid JSON (template bug in ${mapping.template}): ${(e as Error).message}`,
      );
    }
  }

  return content;
}

export function renderMapping(
  mapping: TemplateMapping,
  targetRoot: string,
  ctx: ProjectContext,
): ManifestEntry | null {
  const content = renderMappingContent(mapping, ctx);
  if (content === null) return null;

  const destPath = join(targetRoot, mapping.target);
  const destDir = dirname(destPath);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  writeFileSync(destPath, content);
  const hash = fileHash(content);
  console.log(`  ✓ ${mapping.type === "template" ? "Rendered" : "Copied"}: ${mapping.target}`);

  return {
    type: mapping.type,
    hash,
    originalHash: hash,
  };
}

export function init(targetRoot: string, ctx: ProjectContext): Manifest {
  const manifest: Manifest = {
    version: JSON.parse(readFileSync(join(rootDir(), "package.json"), "utf-8")).version,
    installed_at: new Date().toISOString(),
    files: {},
  };

  // ── Copy harness (generic files) ──────────────────────────────────────────
  const srcHarness = harnessDir();
  copyDir(srcHarness, targetRoot);
  console.log("  ✓ Copied harness files");

  // ── Register harness files in manifest (with hash for upgrade-safety) ─────
  function registerHarnessFiles(dir: string, baseDir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        registerHarnessFiles(full, baseDir);
      } else {
        const rel = relative(baseDir, full);
        const installed = join(targetRoot, rel);
        const hash = existsSync(installed) ? fileHash(readFileSync(installed, "utf-8")) : undefined;
        manifest.files[rel] = {
          type: "generic",
          version: manifest.version,
          hash,
          originalHash: hash,
        };
      }
    }
  }
  registerHarnessFiles(srcHarness, srcHarness);

  // ── Render templates ─────────────────────────────────────────────────────
  const mappings = getTemplateMappings(ctx);

  for (const mapping of mappings) {
    const entry = renderMapping(mapping, targetRoot, ctx);
    if (entry) manifest.files[mapping.target] = entry;
  }

  // ── Write manifest ────────────────────────────────────────────────────────
  const manifestPath = join(targetRoot, ".errementari.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return manifest;
}

export function readManifest(targetRoot: string): Manifest | null {
  const path = join(targetRoot, ".errementari.json");
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export { copyDir, fileHash, generateClaudeCodeFrontmatter, harnessDir, rootDir, templatesDir };
