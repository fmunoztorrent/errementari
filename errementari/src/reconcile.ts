import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateDoNotTouch, generateProjectConventions } from "./conventions.js";
import type { ExistingHarness, ProjectContext } from "./types.js";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function backupFile(targetRoot: string, relativePath: string): string {
  const src = join(targetRoot, relativePath);
  if (!existsSync(src)) return "";
  const backup = `${relativePath}.backup-${timestamp()}`;
  const dest = join(targetRoot, backup);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return backup;
}

export function extractSections(claudeMdContent: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const harnessSectionNames = new Set([
    "development pipeline",
    "feature pipeline",
    "bugfix pipeline",
    "git workflow",
    "automatic validations",
    "conventions",
    "self-improvement",
    "agents",
    "self-improvement (learnings)",
    "project",
    "do not touch",
  ]);

  const lines = claudeMdContent.split("\n");
  let currentTitle = "";
  let currentContent: string[] = [];
  const preamble: string[] = [];
  let foundH2 = false;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      foundH2 = true;

      if (currentTitle && currentContent.length > 0) {
        const normalized = currentTitle.toLowerCase().trim();
        if (!harnessSectionNames.has(normalized)) {
          sections[currentTitle] = currentContent.join("\n").trim();
        }
      }

      currentTitle = h2Match[1];
      currentContent = [];
    } else if (currentTitle) {
      currentContent.push(line);
    } else if (!foundH2 && !line.startsWith("#")) {
      preamble.push(line);
    }
  }

  if (currentTitle && currentContent.length > 0) {
    const normalized = currentTitle.toLowerCase().trim();
    if (!harnessSectionNames.has(normalized)) {
      sections[currentTitle] = currentContent.join("\n").trim();
    }
  }

  const preambleText = preamble.join("\n").trim();
  if (preambleText) {
    const stackMatch = preambleText.match(/^(?:Stack|stack)\s*:\s*(.+)$/m);
    if (stackMatch) {
      sections.Stack = stackMatch[1].trim();
    }
  }

  return sections;
}

export function mergeClaudeMd(
  templateContent: string,
  oldSections: Record<string, string>,
  ctx: ProjectContext,
): string {
  const conventions = generateProjectConventions(ctx);
  const doNotTouch = generateDoNotTouch();

  const sectionInsertions: Array<{
    anchor: string;
    content: string;
    position: "before" | "after" | "replace";
  }> = [];

  for (const [title, content] of Object.entries(oldSections)) {
    const lower = title.toLowerCase().trim();

    if (lower.includes("stack")) {
      sectionInsertions.push({
        anchor: "## Stack",
        content: enrichStackSection(content, ctx),
        position: "replace",
      });
    } else if (
      lower.includes("codebase") ||
      lower.includes("estructura") ||
      lower.includes("structure")
    ) {
      sectionInsertions.push({ anchor: "## Codebase map", content: content, position: "replace" });
    } else if (
      lower.includes("command") ||
      lower.includes("comandos") ||
      lower.includes("comando")
    ) {
      sectionInsertions.push({
        anchor: "## Commands",
        content: replaceCommandsSection(content, ctx),
        position: "replace",
      });
    } else if (lower.includes("architecture") || lower.includes("arquitectura")) {
      sectionInsertions.push({ anchor: "## Architecture", content: content, position: "replace" });
    } else {
      const sectionName = title;
      const mdSection = `## ${sectionName}\n\n${content}`;
      const fallbackAnchor =
        sectionInsertions.length > 0
          ? sectionInsertions[sectionInsertions.length - 1].anchor
          : "## Commands";
      sectionInsertions.push({ anchor: fallbackAnchor, content: mdSection, position: "after" });
    }
  }

  let result = templateContent;

  for (const insertion of sectionInsertions) {
    if (insertion.position === "replace") {
      const anchorIndex = result.indexOf(insertion.anchor);
      if (anchorIndex === -1) continue;
      const afterAnchor = result.indexOf("\n## ", anchorIndex + insertion.anchor.length);
      const sectionEnd = afterAnchor !== -1 ? afterAnchor : result.length;
      result =
        result.slice(0, anchorIndex) +
        insertion.anchor +
        "\n\n" +
        insertion.content +
        "\n\n" +
        result.slice(sectionEnd).replace(/^\n+/, "");
    } else if (insertion.position === "after") {
      const anchorIndex = result.indexOf(insertion.anchor);
      if (anchorIndex === -1) continue;
      const afterAnchor = result.indexOf("\n## ", anchorIndex + insertion.anchor.length);
      const insertPos = afterAnchor !== -1 ? afterAnchor : result.length;
      result =
        result.slice(0, insertPos).replace(/\n+$/, "\n\n") +
        insertion.content +
        "\n\n" +
        result.slice(insertPos).replace(/^\n+/, "");
    }
  }

  if (conventions) {
    const conventionsAnchor = "## Conventions";
    const idx = result.indexOf(conventionsAnchor);
    if (idx !== -1) {
      const afterConventions = result.indexOf("\n## ", idx + conventionsAnchor.length);
      const _insertPos = afterConventions !== -1 ? afterConventions : result.length;
      result =
        result.slice(0, idx) +
        conventionsAnchor +
        "\n\n" +
        conventions +
        "\n" +
        result.slice(idx + conventionsAnchor.length);
    }
  }

  if (result.includes("## Do not touch")) {
    const dtIdx = result.indexOf("## Do not touch");
    if (dtIdx !== -1) {
      const afterDt = result.indexOf("\n## ", dtIdx + 10);
      const endDt = afterDt !== -1 ? afterDt : result.length;
      result = `${result.slice(0, dtIdx) + doNotTouch}\n${result.slice(endDt)}`;
    }
  } else {
    const agentsIdx = result.indexOf("## Agents");
    if (agentsIdx !== -1) {
      result = `${result.slice(0, agentsIdx) + doNotTouch}\n${result.slice(agentsIdx)}`;
    }
  }

  return result;
}

function enrichStackSection(oldStackContent: string, ctx: ProjectContext): string {
  const trimmed = oldStackContent.trim();

  if (!trimmed.startsWith("|") && !trimmed.startsWith("-")) {
    const extras: string[] = [];
    if (ctx.hasFirebase && !trimmed.toLowerCase().includes("firebase"))
      extras.push("Firebase Hosting");
    if (ctx.hasDocker && !trimmed.toLowerCase().includes("docker")) extras.push("Docker");
    if (ctx.frontendFramework && !trimmed.toLowerCase().includes(ctx.frontendFramework))
      extras.push(ctx.frontendFramework);

    const all = extras.length > 0 ? `${trimmed} + ${extras.join(", ")}` : trimmed;
    return `| Stack | ${all} |`;
  }

  const lines = trimmed.split("\n");
  const extras: string[] = [];

  if (ctx.hasFirebase && !trimmed.toLowerCase().includes("firebase")) {
    extras.push("| Hosting | Firebase Hosting |");
  }
  if (ctx.hasDocker && !trimmed.toLowerCase().includes("docker")) {
    extras.push("| Container | Docker |");
  }
  if (ctx.usesVite && !trimmed.toLowerCase().includes("vite")) {
    extras.push("| Build tool | Vite |");
  }
  if (ctx.usesKafka && !trimmed.toLowerCase().includes("kafka")) {
    extras.push("| Messaging | Kafka |");
  }
  if (ctx.usesRedis && !trimmed.toLowerCase().includes("redis")) {
    extras.push("| Cache | Redis |");
  }

  if (extras.length > 0) {
    return `${lines.join("\n")}\n${extras.join("\n")}`;
  }
  return trimmed;
}

function replaceCommandsSection(oldCommands: string, _ctx: ProjectContext): string {
  return oldCommands.trim();
}

export function generateSummary(existing: ExistingHarness): string {
  const lines: string[] = [];
  lines.push("  Found existing Claude Code / opencode files:");

  for (const f of existing.files) {
    const icon = f.category === "custom" ? "·" : f.category === "harness-owned" ? "~" : "?";
    lines.push(`    ${icon} ${f.path} (${f.category})`);
  }

  if (existing.customAgents.length > 0) {
    lines.push(`  Custom agents: ${existing.customAgents.join(", ")}`);
  }
  if (existing.harnessAgents.length > 0) {
    lines.push(`  Harness agents (will be updated): ${existing.harnessAgents.join(", ")}`);
  }

  return lines.join("\n");
}
