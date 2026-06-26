# Contributing to Errementari

Thanks for your interest in improving Errementari. This project **dogfoods its own
harness**: contributions flow through the same pipeline the tool enforces
(SPDD + SDD + BDD + TDD). This guide covers everything you need to send a good PR.

## Prerequisites

- **Node.js ≥ 22.13** and **pnpm 11** for development (the published CLI itself
  runs on Node ≥ 20, but the dev toolchain needs 22.13+ — pnpm 11's engine
  constraint).
- A POSIX shell (the pipeline guards are bash scripts).

## Setup

The repo is a pnpm workspace; the package lives in the `errementari/` subdirectory.

```bash
git clone https://github.com/fmunoztorrent/errementari.git
cd errementari
pnpm install            # installs deps and builds errementari/dist via `prepare`
```

## Everyday commands

Run scripts through pnpm's filter (or `cd errementari` and use `pnpm run <script>`):

```bash
pnpm --filter errementari test         # node:test suites under src/*.test.ts
pnpm --filter errementari run typecheck # tsc --noEmit
pnpm --filter errementari run lint      # Biome
pnpm --filter errementari run build     # emits errementari/dist/
pnpm --filter errementari run dev -- init --help   # run the CLI from TS source
```

CI runs `typecheck`, `lint`, `test`, and `build` across the workspace on Node 22
and 24. A PR must be green on all four before it can merge.

## The development pipeline

Errementari enforces four integrated practices. Application-code changes (anything
under `errementari/src/`) must follow them; config/docs-only changes are lighter
(see below).

| Practice | What it means |
|---|---|
| **SPDD** | The REASONS Canvas (`spdd/prompt/`) leads, the code follows. Fix the prompt first, the code second. |
| **SDD**  | Every feature starts with a spec in `spec/`. The spec is the contract. |
| **BDD**  | Acceptance criteria are Gherkin scenarios (`*.feature`). |
| **TDD**  | RED → GREEN → REFACTOR. Write the failing test before the code. |

- **Feature / bugfix** (touches `errementari/src/`): spec/Canvas → failing test (RED)
  → implement to green → refactor. One test per Canvas operation.
- **Chore** (config, CI, README, dependency bumps): scope → execute → verify → close.
  No spec or Canvas required.

The harness will block edits until the pipeline is started and refuses commits while
a pipeline is open (opencode `pipeline-enforcer` plugin + git `pre-commit` hook).

## Branches and PRs

| Type | Branch from | Naming | PR target |
|---|---|---|---|
| Feature | `main` | `feature/<slug>` | `main` |
| Bugfix  | `main` | `fix/<slug>`     | `main` |
| Chore   | `main` | `chore/<slug>`   | `main` |

- Always branch from `origin/main` — never from `dev` or another feature branch.
- `dev` is the permanent integration branch; PRs target `main`, not `dev`.
- Update `CHANGELOG.md` under the current unreleased/next version with your change.
- End commit messages with a `Co-Authored-By:` trailer when pairing with an agent.

## Releasing (maintainers)

Releases are published to npm by tag:

1. Bump `version` in `errementari/package.json` and
   `errementari/.claude-plugin/plugin.json`, and add a `CHANGELOG.md` entry.
2. Merge to `main`.
3. Tag and push: `git tag v<x.y.z> && git push origin v<x.y.z>`.
4. The `.github/workflows/release.yml` workflow runs typecheck/lint/test/build and
   `npm publish --access public` using the `NPM_TOKEN` repository secret.

First-time setup: add an automation token from npmjs.com as the `NPM_TOKEN` secret
under the repository's **Settings → Secrets and variables → Actions**.

## Reporting bugs and requesting features

Open an issue at https://github.com/fmunoztorrent/errementari/issues with steps to
reproduce (for bugs) or the motivating use case (for features).
