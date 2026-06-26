# Changelog

All notable changes to Errementari are documented here. The `errementari upgrade`
command moves installed harnesses between these versions.

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
