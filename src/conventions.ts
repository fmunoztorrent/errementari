import type { ProjectContext } from "./types.js";

export function generateClaudeIgnore(ctx: ProjectContext): string {
  const lines: string[] = [
    "# Errementari harness — managed by errementari upgrade",
    ".opencode/pipeline/coordination.json",
    "",
  ];

  if (ctx.isNode) {
    lines.push("# Dependencies");
    lines.push("node_modules/");
    lines.push("");
    lines.push("# Build output");
    lines.push("dist/");
    lines.push("*.tsbuildinfo");
    if (ctx.usesVite) {
      lines.push(".vite/");
      lines.push(".vite-react-ssg-temp/");
    }
    lines.push("coverage/");
    lines.push("");
  }

  if (ctx.isPython) {
    lines.push("# Dependencies & virtual env");
    lines.push("__pycache__/");
    lines.push("*.pyc");
    lines.push(".venv/");
    lines.push("venv/");
    lines.push("*.egg-info/");
    lines.push("dist/");
    lines.push("");
  }

  if (ctx.isGo) {
    lines.push("# Dependencies");
    lines.push("vendor/");
    lines.push("");
    lines.push("# Build output");
    lines.push("*.exe");
    lines.push("*.test");
    lines.push("");
  }

  if (ctx.hasFrontend && ctx.frontendFramework === "react-native") {
    lines.push("# React Native");
    lines.push("android/app/build/");
    lines.push("ios/build/");
    lines.push("");
  }

  if (ctx.hasFirebase) {
    lines.push("# Firebase");
    lines.push(".firebase/");
    lines.push("");
  }

  if (ctx.hasDocker) {
    lines.push("# Docker");
    lines.push(".docker/");
    lines.push("");
  }

  lines.push("# Environment & secrets");
  lines.push(".env");
  lines.push(".env.*");
  lines.push("!.env.example");
  lines.push("");

  lines.push("# OS & editor");
  lines.push(".DS_Store");
  lines.push("*.log");
  lines.push("");

  lines.push("# Spec archive (managed by close pipeline)");
  lines.push("spec/archived/");
  lines.push("");

  lines.push("# Git");
  lines.push(".git/");

  return `${lines.join("\n")}\n`;
}

export function generateProjectConventions(ctx: ProjectContext): string {
  const lines: string[] = [];

  if (ctx.isNode && ctx.frontendFramework) {
    lines.push("### Frontend conventions");
    lines.push("");

    if (ctx.frontendFramework === "react") {
      lines.push("- Components in `src/components/`, one file per component");
      lines.push("- Hooks in `src/hooks/`, prefixed with `use`");
      lines.push("- Data/constants in `src/data/` (single source of truth)");
      lines.push("- No hardcoded text in components — use CV/data modules");
      if (ctx.usesVite) lines.push("- Vite aliases: `@/` maps to `src/`");
    } else if (ctx.frontendFramework === "react-native") {
      lines.push("- Screens in `src/screens/`");
      lines.push("- Navigation via React Navigation");
      lines.push("- Platform-specific code: `Component.ios.tsx` / `Component.android.tsx`");
    } else if (ctx.frontendFramework === "vue") {
      lines.push("- Components in `src/components/`, single-file components (`.vue`)");
      lines.push("- Composables in `src/composables/`");
    } else if (ctx.frontendFramework === "svelte") {
      lines.push("- Components in `src/lib/`");
      lines.push("- Stores in `src/stores/`");
    }
    lines.push("");
  }

  if (ctx.hasBackend && ctx.backendFramework) {
    lines.push("### Backend conventions");
    lines.push("");

    if (ctx.backendFramework === "nestjs") {
      lines.push("- Modules in `src/modules/`, one domain per module");
      lines.push("- Decorators for routes, guards, pipes");
      lines.push("- DTOs validated via class-validator");
    } else if (ctx.backendFramework === "express") {
      lines.push("- Routes in `src/routes/`, grouped by domain");
      lines.push("- Middleware in `src/middleware/`");
      lines.push("- Services in `src/services/`");
    } else if (ctx.backendFramework === "fastify") {
      lines.push("- Plugins in `src/plugins/`");
      lines.push("- Routes registered via Fastify instance");
      lines.push("- Schema validation via JSON Schema or TypeBox");
    } else if (ctx.backendFramework === "nextjs") {
      lines.push("- App Router in `src/app/`");
      lines.push('- Server components by default, `"use client"` only when needed');
      lines.push("- API routes in `src/app/api/`");
    } else if (ctx.backendFramework === "django") {
      lines.push("- Apps in `apps/`, one per domain");
      lines.push("- Models, views, urls.py per app");
      lines.push("- DRF serializers in `serializers.py`");
    } else if (ctx.backendFramework === "fastapi") {
      lines.push("- Routers in `app/routers/`");
      lines.push("- Pydantic schemas in `app/schemas/`");
      lines.push("- Dependency injection via FastAPI Depends");
    } else if (ctx.backendFramework === "flask") {
      lines.push("- Blueprints in `app/blueprints/`");
      lines.push("- Models in `app/models/`");
    } else if (ctx.backendFramework === "gin") {
      lines.push("- Handlers in `handlers/` per domain");
      lines.push("- Middleware in `middleware/`");
      lines.push("- Services in `services/`");
    } else if (ctx.backendFramework === "chi") {
      lines.push("- Handlers in `handlers/` per domain");
      lines.push("- Middleware via `chi.Use()`");
    } else if (ctx.backendFramework === "echo") {
      lines.push("- Handlers in `handlers/` per domain");
      lines.push("- Middleware via `e.Use()`");
    }
    lines.push("");
  }

  if (ctx.usesHexagonalArchitecture) {
    lines.push("### Hexagonal architecture");
    lines.push(
      "- **Non-negotiable**: domain defines ports (interfaces), infrastructure implements adapters",
    );
    lines.push("- No use-case imports infrastructure SDKs directly");
    lines.push("- Domain layer: entities, ports (interfaces), use-cases");
    lines.push("- Infrastructure layer: adapters implementing domain ports");
    lines.push("");
  }

  if (ctx.monorepo) {
    lines.push("### Monorepo");
    lines.push(`- Workspace manager: ${ctx.packageManager}`);
    lines.push("- Each workspace is independently buildable");
    lines.push("- Shared types/code in `packages/shared` or equivalent");
    lines.push(`- Scoped commands via \`${ctx.packageManager} --filter <workspace> <cmd>\``);
    lines.push("");
  }

  if (ctx.usesKafka) {
    lines.push("- Kafka topics must be documented with schema references");
    lines.push("- Consumer groups named after service + environment");
    lines.push("");
  }

  if (ctx.usesRedis) {
    lines.push("- Redis keys follow `{service}:{entity}:{id}` pattern");
    lines.push("- Cache TTLs configured per use case, never hardcoded");
    lines.push("");
  }

  if (ctx.hasDocker) {
    lines.push("- Docker Compose for local dev; use profiles for optional services");
    lines.push("- Images pinned to digest hashes in production CI");
    lines.push("");
  }

  if (ctx.hasFirebase) {
    lines.push("- Firebase config via environment variables, never committed");
    lines.push("- Deploy only via CI or explicit `deploy` script");
    lines.push("");
  }

  return lines.length > 0 ? lines.join("\n") : "";
}

export function generateDoNotTouch(): string {
  return [
    "## Do not touch (harness-managed files)",
    "",
    "These files are managed by Errementari — edit only if you know what you're doing:",
    "- `.opencode/pipeline/*` — pipeline scripts (pre-spec, close, merge-to-dev)",
    "- `.opencode/plugins/*` — pipeline-enforcer + coordination plugins",
    "- `.errementari.json` — installation manifest (used by `upgrade`)",
    "- `.claude/commands/task.md` — /task slash command",
    "- `scripts/validate-*` — validation scripts",
    "",
  ].join("\n");
}

export function generateAgentCustomRules(ctx: ProjectContext): string {
  const rules: string[] = [];

  if (ctx.usesHexagonalArchitecture) {
    rules.push("| **A-HEX** | Domain layer must NOT import from infrastructure | **HIGH** |");
  }

  if (ctx.monorepo) {
    rules.push(
      `| **A-MONO** | Scoped commands: use \`${ctx.packageManager} --filter <workspace>\` not workspace root | **HIGH** |`,
    );
  }

  if (ctx.hasFirebase) {
    rules.push(
      "| **A-FB** | Never commit `.firebaserc` if it contains project secrets | **HIGH** |",
    );
  }

  if (ctx.usesKafka && ctx.usesRedis) {
    rules.push(
      "| **A-INFRA** | Kafka + Redis infrastructure must be documented in spec before implementation | **MEDIUM** |",
    );
  }

  if (ctx.isGo) {
    rules.push(
      "| **A-GO** | Run `go vet ./...` and `golangci-lint run` before committing | **HIGH** |",
    );
  }

  if (rules.length === 0) return "";

  return [
    "### Project-specific rules (auto-generated)",
    "",
    "| ID | Rule | Severity |",
    "|----|------|----------|",
    ...rules,
    "",
  ].join("\n");
}
