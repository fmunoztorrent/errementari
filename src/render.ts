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
  const sel = (cli: string) => ctx.selectedCLIs.includes(cli);
  const mappings: TemplateMapping[] = [];

  // CLAUDE.md — always (both CLIs need it as instruction file)
  mappings.push({ template: "CLAUDE.md.hbs", target: "CLAUDE.md", type: "template" });

  // opencode.json — only if OpenCode selected
  if (sel("opencode")) {
    mappings.push({ template: "opencode.json.hbs", target: "opencode.json", type: "template" });
  }

  // Claude Code-specific files
  if (sel("claude")) {
    mappings.push({
      template: "settings.json.hbs",
      target: ".claude/settings.json",
      type: "template",
    });
    mappings.push({ template: ".claudeignore.hbs", target: ".claudeignore", type: "template" });
    mappings.push({ template: "AGENTS.md.hbs", target: ".claude/AGENTS.md", type: "template" });
    mappings.push({ template: "LEARNINGS.md.stub", target: ".claude/LEARNINGS.md", type: "stub" });
  }

  // Rendered (not generic): the container-name pattern embeds the project slug
  mappings.push({
    template: "hardcode-patterns.json.hbs",
    target: ".opencode/pipeline/hardcode-patterns.json",
    type: "template",
  });

  // Skills — always (OpenCode references .claude/skills via skills.paths)
  mappings.push(
    {
      template: "skills/errementari/SKILL.md",
      target: ".claude/skills/errementari/SKILL.md",
      type: "stub",
    },
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
  );

  // Agent definitions, conditional per CLI
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
    if (sel("opencode")) {
      mappings.push({ template, target: `.opencode/agents/${agent.name}.md`, type: agent.type });
    }
    if (sel("claude")) {
      mappings.push({ template, target: `.claude/agents/${agent.name}.md`, type: agent.type });
    }
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

export interface InitOptions {
  /**
   * Mapping targets the user chose to keep as-is (reconciliation "keep").
   * The existing file is not overwritten; it is registered in the manifest
   * with originalHash = the would-be render, so `upgrade` treats it as
   * user-modified and never clobbers it.
   */
  keepTargets?: Set<string>;
}

export function init(targetRoot: string, ctx: ProjectContext, options?: InitOptions): Manifest {
  const version = JSON.parse(readFileSync(join(rootDir(), "package.json"), "utf-8")).version;
  const manifest: Manifest = {
    version,
    installed_at: new Date().toISOString(),
    files: {},
  };

  // ── Pipeline wrappers → delegate to npm plugin ───────────────────────────
  // Thin scripts that delegate to node_modules/errementari/pipeline/*.
  // Only installed if the target project doesn't already have them.
  const pipelineDir = join(targetRoot, ".opencode", "pipeline");
  if (!existsSync(pipelineDir)) mkdirSync(pipelineDir, { recursive: true });

  const wrapperScript = (pluginPath: string): string =>
    `#!/bin/bash\n# Errementari wrapper — delegates to the installed plugin.\n` +
    `ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"\n` +
    `PLUGIN_SCRIPT="$ROOT/node_modules/errementari/${pluginPath}"\n` +
    `if [ -f "$PLUGIN_SCRIPT" ]; then\n` +
    `  exec bash "$PLUGIN_SCRIPT" "$@"\n` +
    `else\n` +
    `  echo "[errementari] Plugin not installed. Run: npm install --prefix .opencode" >&2\n` +
    `  exit 1\n` +
    `fi\n`;

  const wrapperJs = (pluginPath: string): string =>
    `// Errementari wrapper — delegates to the installed plugin.\n` +
    `import { execSync } from "child_process";\n` +
    `function getRoot() { try { return execSync("git rev-parse --show-toplevel", {encoding:"utf-8"}).trim() } catch { return process.cwd() } }\n` +
    `const plug = getRoot() + "/node_modules/errementari/${pluginPath}";\n` +
    `import(plug.startsWith("file://") ? plug : "file://" + plug).then(m => m.default?.()).catch(() => {})\n`;

  const wrappers: Array<{ dest: string; content: string; mode?: number }> = [
    { dest: "pre-spec.sh", content: wrapperScript("pipeline/pre-spec.sh"), mode: 0o755 },
    { dest: "check.sh", content: wrapperScript("pipeline/check.sh"), mode: 0o755 },
    { dest: "merge-to-dev.sh", content: wrapperScript("pipeline/merge-to-dev.sh"), mode: 0o755 },
    { dest: "coordination.sh", content: wrapperScript("pipeline/coordination.sh"), mode: 0o755 },
    {
      dest: "coordination-claude-hook.sh",
      content: wrapperScript("pipeline/coordination-claude-hook.sh"),
      mode: 0o755,
    },
    { dest: "pre-commit", content: wrapperScript("pipeline/pre-commit"), mode: 0o755 },
  ];

  for (const w of wrappers) {
    const destPath = join(pipelineDir, w.dest);
    const content = w.content;
    const hash = fileHash(content);
    // Never overwrite an existing wrapper — it may have been customized
    if (!existsSync(destPath)) {
      writeFileSync(destPath, content);
      if (w.mode) chmodSync(destPath, w.mode);
    }
    const rel = `.opencode/pipeline/${w.dest}`;
    const actualContent = existsSync(destPath) ? readFileSync(destPath, "utf-8") : content;
    manifest.files[rel] = {
      type: "generic",
      version,
      hash: fileHash(actualContent),
      originalHash: hash,
    };
  }

  console.log(`  ✓ Created ${wrappers.length} pipeline wrappers`);

  // ── Plugin directory deps ────────────────────────────────────────────────
  const opencodeDir = join(targetRoot, ".opencode");
  const pluginsDir = join(targetRoot, ".opencode", "plugins");
  if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true });

  // opencode npm deps: pull errementari as dependency
  const opencodePkgPath = join(opencodeDir, "package.json");
  const opencodePkgContent =
    JSON.stringify(
      {
        name: "opencode-plugins",
        private: true,
        type: "module",
        dependencies: { errementari: `^${version}` },
      },
      null,
      2,
    ) + "\n";
  const opencodePkgHash = fileHash(opencodePkgContent);
  if (!existsSync(opencodePkgPath)) {
    writeFileSync(opencodePkgPath, opencodePkgContent);
  }
  manifest.files[".opencode/package.json"] = {
    type: "static",
    hash: existsSync(opencodePkgPath)
      ? fileHash(readFileSync(opencodePkgPath, "utf-8"))
      : opencodePkgHash,
    originalHash: opencodePkgHash,
  };

  // .opencode/.gitignore
  const gitignorePath = join(opencodeDir, ".gitignore");
  const gitignoreContent = "node_modules/\n";
  const gitignoreHash = fileHash(gitignoreContent);
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, gitignoreContent);
  }
  manifest.files[".opencode/.gitignore"] = {
    type: "static",
    hash: existsSync(gitignorePath)
      ? fileHash(readFileSync(gitignorePath, "utf-8"))
      : gitignoreHash,
    originalHash: gitignoreHash,
  };

  console.log("  ✓ Created .opencode plugin config");

  // ── Render templates ─────────────────────────────────────────────────────
  const mappings = getTemplateMappings(ctx);

  for (const mapping of mappings) {
    const destPath = join(targetRoot, mapping.target);
    const existing = existsSync(destPath) ? readFileSync(destPath, "utf-8") : null;

    // Stubs hold user content — never overwrite a non-empty existing stub.
    const keepExisting =
      existing !== null &&
      ((options?.keepTargets?.has(mapping.target) ?? false) ||
        (mapping.type === "stub" && existing.length > 0));

    if (keepExisting) {
      const wouldRender = renderMappingContent(mapping, ctx);
      manifest.files[mapping.target] = {
        type: mapping.type,
        hash: fileHash(existing),
        // Baseline ≠ disk content → upgrade classifies it as user-modified
        // and leaves it untouched.
        originalHash: wouldRender !== null ? fileHash(wouldRender) : undefined,
      };
      console.log(`  · Kept: ${mapping.target}`);
      continue;
    }

    const entry = renderMapping(mapping, targetRoot, ctx);
    if (entry) manifest.files[mapping.target] = entry;
  }

  // ── Sync agents from plugin to project ───────────────────────────────────
  // Copy canonical plugin agents into .claude/agents/ and .opencode/agents/,
  // but only for the CLIs the user selected.
  const pluginAgentsDir = join(rootDir(), "agents");
  if (existsSync(pluginAgentsDir)) {
    if (ctx.selectedCLIs.includes("claude")) {
      const projectClaudeAgents = join(targetRoot, ".claude", "agents");
      if (!existsSync(projectClaudeAgents)) mkdirSync(projectClaudeAgents, { recursive: true });

      for (const entry of readdirSync(pluginAgentsDir)) {
        if (!entry.endsWith(".md")) continue;
        const agentName = basename(entry, ".md");
        const body = readFileSync(join(pluginAgentsDir, entry), "utf-8");

        const ccFrontmatter = generateClaudeCodeFrontmatter(agentName);
        const ccContent = ccFrontmatter + body;
        const ccPath = join(projectClaudeAgents, entry);
        if (!existsSync(ccPath)) writeFileSync(ccPath, ccContent);
        const ccRel = `.claude/agents/${entry}`;
        manifest.files[ccRel] = {
          type: "generic",
          version,
          hash: existsSync(ccPath) ? fileHash(readFileSync(ccPath, "utf-8")) : fileHash(ccContent),
          originalHash: fileHash(ccContent),
        };
      }
    }

    if (ctx.selectedCLIs.includes("opencode")) {
      const projectOpencodeAgents = join(targetRoot, ".opencode", "agents");
      if (!existsSync(projectOpencodeAgents)) mkdirSync(projectOpencodeAgents, { recursive: true });

      for (const entry of readdirSync(pluginAgentsDir)) {
        if (!entry.endsWith(".md")) continue;
        const body = readFileSync(join(pluginAgentsDir, entry), "utf-8");

        const ocPath = join(projectOpencodeAgents, entry);
        if (!existsSync(ocPath)) writeFileSync(ocPath, body);
        const ocRel = `.opencode/agents/${entry}`;
        manifest.files[ocRel] = {
          type: "generic",
          version,
          hash: existsSync(ocPath) ? fileHash(readFileSync(ocPath, "utf-8")) : fileHash(body),
          originalHash: fileHash(body),
        };
      }
    }

    console.log(`  ✓ Synced plugin agents to project`);
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
