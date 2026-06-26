import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detect, parsePnpmWorkspacePatterns } from "./detect.js";

function makeTempProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "erm-detect-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeJson(path: string, obj: unknown) {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

test("TypeScript single-package with npm", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), {
      name: "my-app",
      description: "A test app",
      scripts: { test: "jest", build: "tsc", lint: "eslint .", typecheck: "tsc --noEmit" },
      dependencies: { express: "^4.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    });

    const ctx = detect(root);

    assert.equal(ctx.name, "my-app");
    assert.equal(ctx.description, "A test app");
    assert.equal(ctx.isNode, true);
    assert.equal(ctx.isTypeScript, true);
    assert.equal(ctx.packageManager, "npm");
    assert.equal(ctx.backendFramework, "express");
    assert.equal(ctx.hasBackend, true);
    assert.equal(ctx.hasFrontend, false);
    assert.equal(ctx.monorepo, false);
    assert.equal(ctx.testCommand, "npm test");
    assert.equal(ctx.buildCommand, "npm run build");
  } finally {
    cleanup();
  }
});

test("Plain JavaScript project is Node but not TypeScript", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), {
      name: "js-app",
      dependencies: { express: "^4.0.0" },
    });

    const ctx = detect(root);

    assert.equal(ctx.isNode, true);
    assert.equal(ctx.isTypeScript, false);
    assert.equal(ctx.backendFramework, "express");
  } finally {
    cleanup();
  }
});

test("tsconfig.json alone marks the project as TypeScript", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), { name: "ts-app" });
    writeJson(join(root, "tsconfig.json"), {});

    const ctx = detect(root);
    assert.equal(ctx.isTypeScript, true);
  } finally {
    cleanup();
  }
});

test("TypeScript monorepo with pnpm + apps/api + apps/mobile", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), {
      name: "my-mono",
      workspaces: ["apps/*"],
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

    const ctx = detect(root);

    assert.equal(ctx.monorepo, true);
    assert.equal(ctx.packageManager, "pnpm");
    assert.deepEqual(ctx.services.sort(), ["api", "mobile"]);
    assert.equal(ctx.workspaceDirs.length, 2);
  } finally {
    cleanup();
  }
});

test("React Native frontend", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), {
      name: "rn-app",
      dependencies: { "react-native": "0.74.0", expo: "51.0.0" },
    });

    const ctx = detect(root);

    assert.equal(ctx.frontendFramework, "react-native");
    assert.equal(ctx.hasFrontend, true);
  } finally {
    cleanup();
  }
});

test("Python with Poetry + FastAPI", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeFileSync(
      join(root, "pyproject.toml"),
      `[tool.poetry]\nname = "my-py"\nversion = "0.1.0"\n\n[tool.poetry.dependencies]\nfastapi = "^0.100.0"\n`,
    );

    const ctx = detect(root);

    assert.equal(ctx.isPython, true);
    assert.equal(ctx.name, "my-py");
    assert.equal(ctx.packageManager, "poetry");
    assert.equal(ctx.backendFramework, "fastapi");
    assert.equal(ctx.hasBackend, true);
  } finally {
    cleanup();
  }
});

test("Python with uv", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeFileSync(
      join(root, "pyproject.toml"),
      `[project]\nname = "uv-app"\n\n[tool.uv]\ndev-dependencies = []\n`,
    );

    const ctx = detect(root);

    assert.equal(ctx.isPython, true);
    assert.equal(ctx.packageManager, "uv");
  } finally {
    cleanup();
  }
});

test("Go with gin", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeFileSync(
      join(root, "go.mod"),
      `module github.com/me/my-go-app\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.10.0\n`,
    );

    const ctx = detect(root);

    assert.equal(ctx.isGo, true);
    assert.equal(ctx.name, "my-go-app");
    assert.equal(ctx.packageManager, "go");
    assert.equal(ctx.backendFramework, "gin");
    assert.equal(ctx.testCommand, "go test ./...");
  } finally {
    cleanup();
  }
});

test("Hexagonal architecture detected when domain/ + infrastructure/ exist", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), { name: "hex" });
    mkdirSync(join(root, "domain"));
    mkdirSync(join(root, "infrastructure"));

    const ctx = detect(root);
    assert.equal(ctx.usesHexagonalArchitecture, true);
  } finally {
    cleanup();
  }
});

test("Name falls back to basename(root) when no manifests exist", () => {
  const { root, cleanup } = makeTempProject();
  try {
    const ctx = detect(root);
    assert.ok(ctx.name.length > 0);
    assert.equal(ctx.description, `${ctx.name} project`);
  } finally {
    cleanup();
  }
});

test("Detects infrastructure: kafka, redis, docker", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), {
      name: "infra-app",
      dependencies: { kafkajs: "^2.0.0", ioredis: "^5.0.0" },
    });
    writeFileSync(join(root, "docker-compose.yml"), "version: '3'\n");

    const ctx = detect(root);

    assert.equal(ctx.usesKafka, true);
    assert.equal(ctx.usesRedis, true);
    assert.equal(ctx.hasDocker, true);
  } finally {
    cleanup();
  }
});

test("pnpm monorepo declared in pnpm-workspace.yaml is detected", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), { name: "pnpm-mono" });
    writeFileSync(join(root, "pnpm-lock.yaml"), "");
    writeFileSync(join(root, "pnpm-workspace.yaml"), `packages:\n  - 'apps/*'\n  - "packages/*"\n`);
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      description: "API backend",
    });

    const ctx = detect(root);

    assert.equal(ctx.monorepo, true);
    assert.equal(ctx.packageManager, "pnpm");
    assert.deepEqual(ctx.services, ["api"]);
  } finally {
    cleanup();
  }
});

test("pnpm-workspace.yaml without packages key is not a monorepo", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), { name: "pnpm-single" });
    writeFileSync(join(root, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: true\n");

    const ctx = detect(root);
    assert.equal(ctx.monorepo, false);
  } finally {
    cleanup();
  }
});

test("parsePnpmWorkspacePatterns handles quotes, comments and other keys", () => {
  const patterns = parsePnpmWorkspacePatterns(
    `packages:\n  - 'apps/*'\n  - "libs/*"\n  - tools/cli\n  # a comment\nallowBuilds:\n  - esbuild\n`,
  );
  assert.deepEqual(patterns, ["apps/*", "libs/*", "tools/cli"]);
});

test("permCommands use the detected package manager's workspace syntax", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), { name: "y-mono", workspaces: ["apps/*"] });
    writeFileSync(join(root, "yarn.lock"), "");
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeJson(join(root, "apps", "api", "package.json"), { name: "api" });

    const ctx = detect(root);

    assert.equal(ctx.packageManager, "yarn");
    assert.ok(ctx.permCommands.includes("yarn workspace api test"));
    assert.ok(!ctx.permCommands.some((c) => c.includes("--filter")));
    // No jest/vitest in deps → no blanket test-runner permission
    assert.ok(!ctx.permCommands.includes("npx jest *"));
  } finally {
    cleanup();
  }
});

test("Slug strips non-alphanumeric and lowercases", () => {
  const { root, cleanup } = makeTempProject();
  try {
    writeJson(join(root, "package.json"), { name: "@my-org/Cool_App" });
    const ctx = detect(root);
    assert.equal(ctx.slug, "my-org-cool-app");
  } finally {
    cleanup();
  }
});
