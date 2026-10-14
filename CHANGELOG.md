# Changelog

All notable changes to Errementari are documented here. The `errementari upgrade`
command moves installed harnesses between these versions.

## [Unreleased]

### Added

- **Local LLM learning summaries (opt-in)** — with `ERRE_SUMMARY_PROVIDER=ollama`, `extract-learnings` asks a local Ollama model (default `gpt-oss:20b`, `think: "low"`) for the one-line summary written into the learnings skill and AGENTS.md. Any failure falls back to the existing heuristic; output is sanitized to one line ≤ 120 chars without `|`; non-loopback servers need `ERRE_LLM_ALLOW_REMOTE=1`. New `scripts/llm-summary.ts`, configured through `ERRE_LLM_*` variables (see README). The default behaviour is unchanged.
- **`pipeline-cli.mjs extract-learnings`** — the learnings extraction is now reachable from the Claude Code hook adapter, the same path opencode's `onClose` uses.

### Changed

- **Claude Code Stop hook** — the generated `.claude/settings.json` runs `node .opencode/pipeline/pipeline-cli.mjs extract-learnings` with `"async": true` and `"timeout": 180`, so a slow model never blocks the session. Run `errementari upgrade` to pick it up.
- **Extraction child timeout** — 10 s for the heuristic, `ERRE_LLM_TIMEOUT_MS` + 30 s with Ollama (start-up + model cold load).
- **CI covers `scripts/`** — `test` now also runs `scripts/*.spec.ts`, and `typecheck` checks `scripts/tsconfig.json`.

### Fixed

- **Learnings never extracted in freshly initialized Claude Code projects** — the old Stop hook called `scripts/extract-learnings.ts`, which `init` does not install; `2>/dev/null || true` hid the failure.
- **Repeated Stop hooks promoted an entry to level 2 on a single close** — several Stop hooks inside the 5-minute `close-pending` window reprocessed the same entry; the second pass found its slug in *Lecciones recientes* and promoted it. The last processed entry is now recorded in `.opencode/pipeline/learnings-processed.json` (removed by `uninstall`) and skipped.
- **`errementari extract-learnings` exited before the extraction finished** — it called `process.exit(0)` right after spawning the child; it now waits for it.

## [2.1.0] — 2026-06-26

### Added

- **Pipeline `.md` files copied to project** — `start.md`, `close.md`, and `validate-empirica.md` are now copied to `.opencode/pipeline/` during `init`. Agents can read them directly without depending on `node_modules/errementari`.
- **`coordination.json` initial state** — `init` creates `.opencode/pipeline/coordination.json` as `{}` so coordination tools don't fail on first read.
- **Vite `noEmit` convention** — projects detected as using Vite now document in CLAUDE.md that `tsc` is typecheck-only (`noEmit: true` required in `tsconfig.json`) to prevent stale `.js` files from interfering with Vite's bundler.
- **SSG detection** — `detect.ts` now sets `usesSSG: true` when the project has `vite-react-ssg`, `vite-plugin-ssr`, `vite-ssg`, `astro`, or `vite-plugin-react-pages` in dependencies.
- **SSG data loading convention** — SSG projects document the `import.meta.glob` pattern as the Vite-native alternative to `node:fs` for file content loading, with the `if (!import.meta.env.SSR)` guard for React Router loaders.
- **`CONTRIBUTING.md`** — contribution guide covering setup, the SPDD/SDD/BDD/TDD pipeline, branch/PR conventions, and the release process.
- **npm distribution** — README documents `npx errementari` / `npm i -g errementari` as the primary install path; `publishConfig.access: public` added to `package.json`.
- **Release workflow** — `.github/workflows/release.yml` runs typecheck/lint/test/build and publishes to npm on `v*` tags via the `NPM_TOKEN` secret.

### Changed

- **Local install fallback** — when `npm install` fails in `.opencode/` (because `errementari` is not published on the public npm registry), `init` now falls back to installing from the local Errementari source checkout.
- **Wrapper error message** — when the pipeline plugin is not installed, the error now lists 3 actionable options: install from local path, use `npm link`, or publish to npm.
- **README rewritten for the monorepo layout** — install and development instructions use the `errementari/` subpackage and pnpm; the entry point is `bin/errementari.js`.

### Fixed

- **`ProjectContext` missing `usesSSG` field** — added to `types.ts` and all test fixtures.
- **Local-install fallback hint printed literal `${...}`** — the `init` fallback message was a plain string instead of a template literal, so it showed `${errementariSource}`/`${opencodeDir}` verbatim. Now interpolated (also clears the Biome `noTemplateCurlyInString` warning).
- **Claude Code edit enforcement was inert** — the generated `.claude/settings.json` hooks (`guard-edit`, `check-activation`, `sync-todos`) ran `node .opencode/pipeline/pipeline-cli.mjs`, but `init` never installed that file there (only the bash wrappers), so the hooks failed silently and never blocked edits. `init` now installs a `pipeline-cli.mjs` wrapper that resolves the plugin from the repo root **or** `.opencode/node_modules/` and delegates to it, so block exit codes (2) propagate. Run `errementari upgrade` to add it to existing installs.
- **`upgrade` was broken for npm installs** — `upgrade` copies from the vendored `harness/` mirror, but `harness/` was missing from the published `files`, so `upgrade` only worked from a source checkout (e.g. the dogfooded repo), not for users who installed via npm. `harness/` is now part of the published package.
- **Vendored `harness/` mirror had drifted from canonical sources** — 9 of 11 pipeline scripts (and several `scripts/`) were stale: older logic, Spanish strings, and `check.sh` lacked the `node` fallback when `python3` is absent. So `upgrade` installed *different* (worse) logic than `init`. Added `scripts/sync-harness.ts` + a CI `check:harness` guard that fails on drift, and re-synced every vendored copy to canonical.
- **`pre-commit` hook errored on macOS** — it used `declare -A` (associative arrays, bash 4+), but macOS ships `/bin/bash` 3.2. Rewritten with a portable newline-delimited list.
- **Dead code removed** — unused `_listFiles` in `init.ts` and a duplicated `console.log` in `render.ts`.

## [1.1.0] — 2026-06-10

### Fixed

- **Generated `.claude/settings.json` was invalid JSON** — the permissions template
  emitted a trailing comma after the last `Bash(...)` entry, so Claude Code could not
  parse the project settings. All rendered `.json` files are now validated during
  `init`/`upgrade` and the install fails loudly on template bugs.
- **`/task` lost the user's input in opencode** — the `{{input}}` placeholder in
  `opencode.json` was consumed by Handlebars during rendering instead of being left
  for opencode. It is now escaped and survives rendering.
- **pnpm monorepos were not detected** — workspace patterns are now also read from
  `pnpm-workspace.yaml` (`packages:`), not only from `package.json` `workspaces`.
- **Permission `Read(//.claude/**)`** pointed at the filesystem root; now `Read(.claude/**)`.
- Package name typo (`erementari` → `errementari`).

### Changed

- `upgrade` now refreshes **unmodified** templates and static agent definitions in
  addition to generic files (user-modified files are still left untouched), restores
  files deleted from disk, compares versions with semver ordering, and refuses to
  downgrade.
- Framework and infrastructure detection in monorepos now aggregates dependencies
  from all workspace packages, not just the root `package.json`.
- `isTypeScript` now requires actual TypeScript evidence (`tsconfig.json` or the
  `typescript` dependency); plain JavaScript projects are detected as Node (`isNode`).
- Workspace-scoped permission commands use the detected package manager's syntax
  (`pnpm --filter`, `yarn workspace`, `npm run --workspace`).
- The `frontend` agent and `frontend-learnings` skill are only installed when the
  project actually has a frontend.
- Blanket test-runner permissions (`npx jest *`) are only granted when that runner
  is present in the project's dependencies.

### Added

- `errementari doctor` — health check of an installation (manifest, files, JSON
  validity, git hooks, plugin deps).
- `errementari uninstall` — clean removal of every harness file via the manifest,
  including restoring `core.hooksPath`.
- `errementari init --dry-run` and `errementari upgrade --dry-run`.
- e2e tests for `init` rendering and the full `upgrade` matrix; CI workflow; Biome
  lint/format; LICENSE file.

## [1.0.0] — 2026-06-10

Initial release: `init`, `upgrade`, `status`; project detection for
TypeScript/Python/Go; dual Claude Code + opencode harness with TDD pipeline
enforcement.
