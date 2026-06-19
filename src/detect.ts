import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExistingHarness, HarnessFile, ProjectContext } from "./types.js";

function safeReadJSON(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function findInDeps(pkg: Record<string, unknown>, patterns: string[]): boolean {
  const deps = {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };
  return patterns.some((p) => Object.keys(deps).some((d) => d.toLowerCase().includes(p)));
}

// pnpm declares workspaces in pnpm-workspace.yaml, not package.json.
// Minimal parser for its `packages:` list — avoids pulling in a YAML dependency.
export function parsePnpmWorkspacePatterns(yaml: string): string[] {
  const lines = yaml.split("\n");
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s+-\s*['"]?([^'"#\s]+)['"]?/);
      if (item) patterns.push(item[1]);
      else if (/^\S/.test(line)) inPackages = false; // next top-level key
    }
  }
  return patterns;
}

export function detect(root: string): ProjectContext {
  const pkgPath = join(root, "package.json");
  const pyprojectPath = join(root, "pyproject.toml");
  const goModPath = join(root, "go.mod");
  const setupPyPath = join(root, "setup.py");

  const hasPackageJson = existsSync(pkgPath);
  const hasPyproject = existsSync(pyprojectPath);
  const hasGoMod = existsSync(goModPath);

  const pkg = hasPackageJson ? safeReadJSON(pkgPath) : null;
  const pyproject = hasPyproject ? safeRead(pyprojectPath) : null;
  const goMod = hasGoMod ? safeRead(goModPath) : null;

  // ── Languages ────────────────────────────────────────────────────────────
  const isNode = hasPackageJson;
  const isTypeScript =
    isNode &&
    (existsSync(join(root, "tsconfig.json")) || (pkg ? findInDeps(pkg, ["typescript"]) : false));
  const isPython = hasPyproject || existsSync(setupPyPath);
  const isGo = hasGoMod;

  // ── Project name ──────────────────────────────────────────────────────────
  let name = "";
  let description = "";

  if (pkg) {
    name = (pkg.name as string) || basename(root);
    description = (pkg.description as string) || "";
  } else if (pyproject) {
    const nameMatch = pyproject.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch) name = nameMatch[1];
  } else if (goMod) {
    const modMatch = goMod.match(/^module\s+(\S+)/m);
    if (modMatch) name = modMatch[1].split("/").pop() || modMatch[1];
  }

  if (!name) name = basename(root);
  if (!description) description = `${name} project`;

  const slug = toSlug(name);

  // ── Package manager ──────────────────────────────────────────────────────
  let packageManager = "npm";
  if (isNode) {
    if (existsSync(join(root, "pnpm-lock.yaml")) || existsSync(join(root, "pnpm-workspace.yaml")))
      packageManager = "pnpm";
    else if (existsSync(join(root, "yarn.lock"))) packageManager = "yarn";
    else if (existsSync(join(root, "bun.lockb"))) packageManager = "bun";
  } else if (isPython) {
    if (pyproject?.includes("[tool.poetry]")) packageManager = "poetry";
    else if (pyproject?.includes("[tool.uv]")) packageManager = "uv";
    else packageManager = "pip";
  } else if (isGo) {
    packageManager = "go";
  }

  // ── Monorepo ─────────────────────────────────────────────────────────────
  let monorepo = false;
  const workspaceDirs: Array<{ path: string; description: string; name: string }> = [];
  const workspacePkgs: Array<Record<string, unknown>> = [];

  let workspacePatterns: string[] = [];
  if (isNode && pkg?.workspaces) {
    workspacePatterns = Array.isArray(pkg.workspaces)
      ? (pkg.workspaces as string[])
      : (pkg.workspaces as { packages?: string[] }).packages || [];
  }
  if (isNode && workspacePatterns.length === 0) {
    const pnpmWs = safeRead(join(root, "pnpm-workspace.yaml"));
    if (pnpmWs) workspacePatterns = parsePnpmWorkspacePatterns(pnpmWs);
  }

  if (workspacePatterns.length > 0) {
    monorepo = true;
    for (const pattern of workspacePatterns) {
      const base = pattern.replace(/\/\*\*?$/, "");
      if (base.includes("*") || !existsSync(join(root, base))) continue;
      for (const e of readdirSync(join(root, base))) {
        const full = join(root, base, e);
        try {
          if (statSync(full).isDirectory() && existsSync(join(full, "package.json"))) {
            const subPkg = safeReadJSON(join(full, "package.json"));
            if (subPkg) workspacePkgs.push(subPkg);
            workspaceDirs.push({
              path: `${base}/${e}`,
              description: (subPkg?.description as string) || e,
              // Package name, not dir name: pnpm/yarn/bun filter by name
              name: (subPkg?.name as string) || e,
            });
          }
        } catch {
          // broken symlink or unreadable entry — skip
        }
      }
    }
  }

  // ── Frameworks ───────────────────────────────────────────────────────────
  let backendFramework: string | undefined;
  let frontendFramework: string | undefined;
  let hasBackend = false;
  let hasFrontend = false;
  const services: string[] = [];
  let frontendAppPath: string | undefined;

  if (isNode && pkg) {
    // In monorepos, frameworks live in workspace packages, not the root
    const allDeps: Record<string, string> = {};
    for (const p of [pkg, ...workspacePkgs]) {
      Object.assign(
        allDeps,
        (p.dependencies as Record<string, string>) || {},
        (p.devDependencies as Record<string, string>) || {},
      );
    }

    // Backend detection
    if (allDeps["@nestjs/core"] || allDeps["@nestjs/common"]) {
      backendFramework = "nestjs";
      hasBackend = true;
    } else if (allDeps.express) {
      backendFramework = "express";
      hasBackend = true;
    } else if (allDeps.fastify) {
      backendFramework = "fastify";
      hasBackend = true;
    } else if (allDeps.next) {
      backendFramework = "nextjs";
      hasBackend = true;
    }

    // Frontend detection
    if (allDeps["react-native"] || allDeps.expo) {
      frontendFramework = "react-native";
      hasFrontend = true;
    } else if (allDeps.react) {
      frontendFramework = "react";
      hasFrontend = true;
    } else if (allDeps.vue) {
      frontendFramework = "vue";
      hasFrontend = true;
    } else if (allDeps.svelte) {
      frontendFramework = "svelte";
      hasFrontend = true;
    }

    // Services from monorepo — workspace package names, usable as
    // pnpm --filter / yarn workspace / npm --workspace targets
    if (monorepo && workspaceDirs.length > 0) {
      for (const dir of workspaceDirs) {
        if (dir.path.startsWith("apps/")) {
          services.push(dir.name);
        }
      }
      frontendAppPath = workspaceDirs.find(
        (d) => d.description.toLowerCase().includes("front") || d.path.includes("mobile"),
      )?.path;
    }
  }

  if (isPython) {
    hasBackend = true;
    if (pyproject?.includes("django")) backendFramework = "django";
    else if (pyproject?.includes("fastapi")) backendFramework = "fastapi";
    else if (pyproject?.includes('flask"') || pyproject?.includes("flask'"))
      backendFramework = "flask";
  }

  if (isGo) {
    hasBackend = true;
    if (goMod?.includes("gin-gonic")) backendFramework = "gin";
    else if (goMod?.includes("chi")) backendFramework = "chi";
    else if (goMod?.includes("echo")) backendFramework = "echo";
  }

  // ── Infrastructure ───────────────────────────────────────────────────────
  const nodePkgs = isNode && pkg ? [pkg, ...workspacePkgs] : [];
  const inAnyPkg = (patterns: string[]) => nodePkgs.some((p) => findInDeps(p, patterns));
  const usesKafka = inAnyPkg(["kafkajs", "kafka"]);
  const usesRedis = inAnyPkg(["ioredis", "redis"]);
  const usesSSE =
    inAnyPkg(["event-source", "react-native-sse"]) ||
    !!(isPython && pyproject?.includes("sse-starlette"));
  const hasDocker =
    existsSync(join(root, "docker-compose.yml")) || existsSync(join(root, "Dockerfile"));
  const hasFirebase =
    existsSync(join(root, "firebase.json")) || existsSync(join(root, ".firebaserc"));
  const usesVite =
    isNode &&
    (existsSync(join(root, "vite.config.ts")) || existsSync(join(root, "vite.config.js")));

  const usesHexagonalArchitecture =
    existsSync(join(root, "domain")) && existsSync(join(root, "infrastructure"));

  const usesBDD =
    isNode &&
    (findInDeps(pkg || {}, [
      "jest-cucumber",
      "@cucumber/cucumber",
      "cucumber",
      "gherkin-testcafe",
    ]) ||
      existsSync(join(root, "tests", "features")) ||
      existsSync(join(root, "features")));

  // ── Commands ─────────────────────────────────────────────────────────────
  let testCommand = "npm test";
  let buildCommand = "npm run build";
  let lintCommand = "npm run lint";
  let typecheckCommand = "npm run typecheck";
  const usesMutationTesting = false;
  const mutationTestCommand = "";

  if (isNode) {
    const pm = packageManager;

    if (monorepo) {
      testCommand = `${pm} test`;
      buildCommand = `${pm} build`;
      lintCommand = `${pm} lint`;
      typecheckCommand = `${pm} typecheck`;
    } else {
      if (["ts", "js", "mjs", "cjs"].some((ext) => existsSync(join(root, `jest.config.${ext}`)))) {
        testCommand = "npx jest";
      } else if (
        ["ts", "js", "mts", "mjs"].some((ext) => existsSync(join(root, `vitest.config.${ext}`)))
      ) {
        testCommand = "npx vitest run";
      }
      const scripts = (pkg?.scripts || {}) as Record<string, string>;
      if (scripts.test) testCommand = `${pm} test`;
      if (scripts.build) buildCommand = `${pm} run build`;
      if (scripts.lint) lintCommand = `${pm} run lint`;
      if (scripts.typecheck) typecheckCommand = `${pm} run typecheck`;
    }
  } else if (isPython) {
    testCommand =
      existsSync(join(root, "pytest.ini")) || pyproject?.includes("[tool.pytest")
        ? "pytest"
        : "python -m pytest";
    buildCommand = packageManager === "poetry" ? "poetry build" : "pip install -e .";
    lintCommand = pyproject?.includes("[tool.ruff]") ? "ruff check ." : "flake8";
    typecheckCommand = pyproject?.includes("[tool.mypy]")
      ? "mypy ."
      : "echo 'no typecheck configured'";
  } else if (isGo) {
    testCommand = "go test ./...";
    buildCommand = "go build ./...";
    lintCommand = "golangci-lint run";
    typecheckCommand = "go vet ./...";
  }

  // ── Permissions commands ─────────────────────────────────────────────────
  const permCommands: string[] = [];
  if (monorepo) {
    // Workspace-scoped invocation differs per package manager
    const scoped = (svc: string, script: string): string => {
      switch (packageManager) {
        case "pnpm":
          return `pnpm --filter ${svc} ${script}`;
        case "yarn":
          return `yarn workspace ${svc} ${script}`;
        case "bun":
          return `bun run --filter ${svc} ${script}`;
        default:
          return `npm run ${script} --workspace ${svc}`;
      }
    };
    for (const svc of services) {
      permCommands.push(scoped(svc, "test"));
      permCommands.push(scoped(svc, "typecheck"));
    }
  }
  permCommands.push(testCommand);
  permCommands.push(lintCommand);
  permCommands.push(typecheckCommand);
  // Bare commands: the settings template appends ":*" (prefix match), so a
  // glob here would render as "npx jest *:*" and never match.
  if (isNode && pkg && findInDeps(pkg, ["jest"])) permCommands.push("npx jest");
  if (isNode && pkg && findInDeps(pkg, ["vitest"])) permCommands.push("npx vitest");

  return {
    name,
    slug,
    description,
    isNode,
    isTypeScript,
    isPython,
    isGo,
    hasBackend,
    hasFrontend,
    monorepo,
    usesHexagonalArchitecture,
    packageManager,
    backendFramework,
    frontendFramework,
    testCommand,
    buildCommand,
    lintCommand,
    typecheckCommand,
    usesMutationTesting,
    mutationTestCommand,
    workspaceDirs,
    services,
    frontendAppPath,
    usesKafka,
    usesRedis,
    usesSSE,
    hasDocker,
    hasFirebase,
    usesVite,
    usesBDD,
    permCommands: [...new Set(permCommands)],
  };
}

const ERREMENTARI_AGENTS = ["pipeline", "spec", "architect", "backend", "qa", "frontend"];

function listDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isNonEmptyFile(path: string): boolean {
  try {
    return statSync(path).isFile() && readFileSync(path, "utf-8").length > 0;
  } catch {
    return false;
  }
}

export function detectExistingHarness(root: string): ExistingHarness {
  const files: HarnessFile[] = [];
  const customAgents: string[] = [];
  const harnessAgents: string[] = [];

  const hasClaudeMd = existsSync(join(root, "CLAUDE.md"));
  const hasClaudeIgnore = existsSync(join(root, ".claudeignore"));
  const hasOpencodeDir = existsSync(join(root, ".opencode"));
  const hasClaudeDir = existsSync(join(root, ".claude"));
  const hasSettingsJson = existsSync(join(root, ".claude", "settings.json"));
  const hasSettingsLocalJson = existsSync(join(root, ".claude", "settings.local.json"));

  if (hasClaudeMd) {
    files.push({
      path: "CLAUDE.md",
      category: "harness-owned",
      matchesTemplate: "CLAUDE.md.hbs",
      hasContent: isNonEmptyFile(join(root, "CLAUDE.md")),
    });
  }

  if (hasClaudeIgnore) {
    files.push({
      path: ".claudeignore",
      category: "harness-owned",
      matchesTemplate: ".claudeignore.hbs",
      hasContent: isNonEmptyFile(join(root, ".claudeignore")),
    });
  }

  if (hasSettingsJson) {
    files.push({
      path: ".claude/settings.json",
      category: "harness-owned",
      matchesTemplate: "settings.json.hbs",
      hasContent: true,
    });
  }

  if (hasSettingsLocalJson) {
    files.push({
      path: ".claude/settings.local.json",
      category: "custom",
      hasContent: true,
    });
  }

  const opencodeJsonPath = join(root, "opencode.json");
  if (existsSync(opencodeJsonPath)) {
    files.push({
      path: "opencode.json",
      category: "harness-owned",
      matchesTemplate: "opencode.json.hbs",
      hasContent: true,
    });
  }

  if (hasClaudeDir) {
    const agentsDir = join(root, ".claude", "agents");
    if (existsSync(agentsDir)) {
      for (const entry of listDirSafe(agentsDir)) {
        if (!entry.endsWith(".md")) continue;
        const agentName = entry.replace(/\.md$/, "");
        const agentPath = `.claude/agents/${entry}`;

        if (ERREMENTARI_AGENTS.includes(agentName)) {
          harnessAgents.push(agentName);
          files.push({
            path: agentPath,
            category: "harness-owned",
            matchesTemplate: `agents/${agentName}.md.hbs`,
            hasContent: isNonEmptyFile(join(root, agentPath)),
          });
        } else {
          customAgents.push(agentName);
          files.push({
            path: agentPath,
            category: "custom",
            hasContent: isNonEmptyFile(join(root, agentPath)),
          });
        }
      }
    }

    const learningsPath = join(root, ".claude", "LEARNINGS.md");
    if (existsSync(learningsPath)) {
      files.push({
        path: ".claude/LEARNINGS.md",
        category: "stub",
        matchesTemplate: "LEARNINGS.md.stub",
        hasContent: isNonEmptyFile(learningsPath),
      });
    }

    const commandsDir = join(root, ".claude", "commands");
    if (existsSync(commandsDir)) {
      for (const entry of listDirSafe(commandsDir)) {
        files.push({
          path: `.claude/commands/${entry}`,
          category: "harness-owned",
          hasContent: true,
        });
      }
    }

    const skillsDir = join(root, ".claude", "skills");
    if (existsSync(skillsDir)) {
      function scanSkills(dir: string, prefix: string) {
        for (const entry of listDirSafe(dir)) {
          const full = join(dir, entry);
          const rel = `${prefix}/${entry}`;
          try {
            if (statSync(full).isDirectory()) {
              scanSkills(full, rel);
            } else {
              const isLearningsSkill = rel.includes("-learnings/");
              files.push({
                path: `.claude/${rel}`,
                category: isLearningsSkill ? "stub" : "custom",
                hasContent: isNonEmptyFile(full),
              });
            }
          } catch {
            // unreadable entry
          }
        }
      }
      scanSkills(skillsDir, "skills");
    }

    const settingsLocalDir = join(root, ".claude");
    for (const entry of listDirSafe(settingsLocalDir)) {
      const full = join(settingsLocalDir, entry);
      if (
        statSync(full).isFile() &&
        entry !== "settings.json" &&
        entry !== "LEARNINGS.md" &&
        entry !== "AGENTS.md"
      ) {
        const _isAgentsMd = entry === "AGENTS.md";
        const relDir = `claude/${entry}`;
        if (
          !files.some((f) => f.path === `.${relDir}`) &&
          !entry.endsWith(".md") &&
          entry !== "bootstrap-multiagentes.md"
        ) {
          // Skip other known file types
        }
        // Non-agent, non-standard files
        const knownPatterns = ["settings", "LEARNINGS", "AGENTS"];
        if (!knownPatterns.some((p) => entry.startsWith(p))) {
          const isMdAgent = entry.endsWith(".md");
          const _name = isMdAgent ? entry.replace(/\.md$/, "") : entry;
          if (!files.some((f) => f.path === `.claude/${entry}`)) {
            files.push({
              path: `.claude/${entry}`,
              category: "custom",
              hasContent: true,
            });
          }
        }
      }
    }
  }

  if (hasOpencodeDir) {
    const opencodeRoot = join(root, ".opencode");
    function scanOpencode(dir: string, prefix: string) {
      for (const entry of listDirSafe(dir)) {
        const full = join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        try {
          if (statSync(full).isDirectory()) {
            scanOpencode(full, rel);
          } else {
            // Check if this is a harness-owned file
            const harnessOwnedPatterns = ["pipeline/", "plugins/", "agents/", "coordination.json"];
            const isHarnessOwned =
              harnessOwnedPatterns.some((p) => rel.startsWith(p)) ||
              rel === "package.json" ||
              rel === ".gitignore";
            files.push({
              path: `.opencode/${rel}`,
              category: isHarnessOwned ? "harness-owned" : "custom",
              hasContent: isNonEmptyFile(full),
            });
          }
        } catch {
          // unreadable entry
        }
      }
    }
    scanOpencode(opencodeRoot, "");
  }

  return {
    files,
    hasClaudeMd,
    hasOpencodeDir,
    hasClaudeDir,
    hasClaudeIgnore,
    hasSettingsJson,
    hasSettingsLocalJson,
    customAgents,
    harnessAgents,
  };
}
