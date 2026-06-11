# Changelog

All notable changes to Errementari are documented here. The `errementari upgrade`
command moves installed harnesses between these versions.

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
