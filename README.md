# Errementari

CLI installer for a dual-tool development harness (Claude Code + opencode) that enforces a strict TDD pipeline with specialized sub-agents for spec, architecture, backend, frontend, and QA.

> Errementari is the Basque word for *blacksmith*. The harness forges raw user prompts into structured, test-first work through a chain of mandatory pipeline steps.

## What it installs

Running `errementari init` adds the following to your project:

```
your-project/
├── CLAUDE.md                  # main instructions for Claude Code
├── opencode.json              # opencode config (default agent: pipeline)
├── .claudeignore
├── .errementari.json          # installation manifest (hashes for upgrade-safety)
├── .claude/
│   ├── settings.json          # permissions + session/coordination hooks
│   ├── AGENTS.md
│   ├── LEARNINGS.md
│   ├── commands/task.md       # /task slash command
│   ├── agents/                # Claude Code sub-agents (pipeline, spec, architect, backend, frontend, qa)
│   └── skills/                # learning skills per role
└── .opencode/
    ├── agents/                # opencode sub-agents (mirrors .claude/agents/)
    ├── plugins/               # pipeline-enforcer + coordination plugins
    └── pipeline/
        ├── start.md           # pipeline start instructions
        ├── close.md           # pipeline close instructions
        ├── coordination.sh    # git-tree coordination between tools
        ├── coordination.json  # shared session state (gitignored)
        ├── pre-commit         # git hook: blocks commit if pipeline not closed
        ├── check.sh           # pipeline status check
        ├── pre-spec.sh        # pre-spec guard
        ├── merge-to-dev.sh
        ├── validate-empirica.md
        ├── hardcode-patterns.json
        └── coordination-claude-hook.sh
```

## Requirements

- Node.js ≥ 20
- A project directory (with or without `.git`)
- Optional: Claude Code and/or opencode CLI installed
- Optional: a git remote (`origin`) — without one, the pre-spec checks that
  compare against `origin/<main>` and query open PRs degrade to warnings
  instead of blocking. Repos whose default branch is `master` (or anything
  set in `origin/HEAD`) are detected automatically.

## Install

### From a local checkout

```bash
git clone <repo-url> errementari
cd errementari
npm install        # `prepare` runs the TypeScript build automatically
npm link           # exposes the `errementari` command globally
```

After this, `errementari` is available system-wide.

### One-shot (without linking)

```bash
node /path/to/errementari/bin/cli.js <command>
```

## Commands

| Command | What it does |
|---|---|
| `errementari init [dir]` | Detect the project, prompt for name/description, render the harness. Default `dir` is CWD. |
| `errementari init -y` | Skip prompts; use detected values. |
| `errementari init --dry-run` | List everything that would be installed without writing files. |
| `errementari upgrade [dir]` | Re-apply the harness from a newer Errementari version. Preserves user edits. |
| `errementari upgrade --dry-run` | Preview what an upgrade would change without writing files. |
| `errementari status [dir]` | Show installed version, install date, and a file-count breakdown. |
| `errementari doctor [dir]` | Health check: manifest, missing files, JSON validity, git hooks, plugin deps. |
| `errementari uninstall [dir]` | Remove every harness file via the manifest and restore `core.hooksPath`. Files you modified are preserved. |
| `errementari [dir]` *(no subcommand)* | Alias of `init [dir]`. Supports `-y` and `--dry-run`. |

### `init` — first install

```bash
cd ~/code/my-project
errementari init
```

Output walks through:

1. **Detection** — language (TypeScript / Python / Go), package manager, frameworks (Nest, Express, Fastify, Next, Django, FastAPI, Flask, Gin, …), monorepo workspaces, infra hints (Kafka, Redis, SSE, Docker), hexagonal layout.
2. **Confirm** — prompts for `name` and `description` with the detected values as defaults. Use `-y` to skip.
3. **Render** — copies harness files, renders Handlebars templates into the project, computes hashes, writes `.errementari.json`.
4. **Git hooks** — if `.git/` exists, runs `git config core.hooksPath .opencode/pipeline`.
5. **Plugin deps** — runs `npm install --no-save` inside `.opencode/` so the opencode plugins load.

If a harness is already installed, `init` does nothing and tells you to use `upgrade`.

### `upgrade` — bring an existing install up to date

```bash
cd ~/code/my-project
errementari upgrade
```

Workflow:

1. Reads `.errementari.json`. If the installed version equals the current Errementari version, exits. If the installed version is **newer**, refuses to downgrade.
2. For each **generic** file (pipeline scripts, plugins, commands), compares the file's current hash to `originalHash` from the manifest:
   - Unmodified → overwritten with the new version, hash updated.
   - Modified → **kept as-is**, listed in the "modified by you" warning.
3. Re-runs project detection and applies any **new template mappings** introduced by the current version (e.g. a new agent file). Files deleted from disk are restored.
4. For each existing **template/static** file:
   - Unmodified → re-rendered with the new version's template.
   - Modified → **kept as-is**, listed in the warning.
5. **Stub** files (e.g. `LEARNINGS.md`) are never touched once they exist.
6. Updates `manifest.version`.

Run `errementari upgrade --dry-run` first to preview every change. This is the only safe way to update — never overwrite the harness manually.

### `status` — quick health check

```bash
errementari status
```

Prints version, install date, and a count of generic / template / stub files.

## The pipeline (what the harness enforces)

Once installed, both Claude Code and opencode default to the `pipeline` agent, which **classifies every request** and routes through specialized sub-agents:

| Task type | Flow |
|---|---|
| `feature` | spec → architect → qa (RED) → backend / frontend → qa (GREEN) → close |
| `bugfix` | triage → reproduce (RED test) → architect (optional) → fix → verify → close |
| `debug` | triage → reproduce → analysis → report |
| `chore` | scope → execute → verify → close |
| `question` | answered directly, no pipeline |

You can trigger it explicitly with the `/task` slash command:

```
/task implement Google login            → feature pipeline
/task bug: SSE doesn't reconnect        → bugfix pipeline
/task change LOG_LEVEL to debug in bff  → chore pipeline
/task what's the BFF structure?         → direct answer
```

Without `/task`, the auto-triage in `CLAUDE.md` still kicks in for any request that touches code.

### Mechanical guarantees

- **opencode plugin** (`pipeline-enforcer`) blocks `edit`/`write` tool calls until `todowrite` initializes the pipeline.
- **Claude Code `PreToolUse` hook** checks pipeline state before `Bash` calls.
- **Git `pre-commit` hook** refuses commits while the pipeline is open.
- **Coordination script** prevents destructive git operations from one tool clobbering uncommitted work in the other when both run on the same tree.

## Project detection details

`init` reads (in order):

| File | Signal |
|---|---|
| `package.json` | TypeScript, deps → framework, `workspaces` → monorepo, `scripts` → commands |
| `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb` | package manager |
| `pyproject.toml` | Python, `[tool.poetry]` / `[tool.uv]` / `[tool.ruff]` / `[tool.mypy]` |
| `setup.py` | Python (fallback) |
| `go.mod` | Go, module name → project name |
| `docker-compose.yml` / `Dockerfile` | `hasDocker` |
| `domain/` + `infrastructure/` | hexagonal architecture flag |

Detected dependencies that influence templates: `@nestjs/core`, `express`, `fastify`, `next`, `react`, `vue`, `svelte`, `react-native`, `expo`, `kafkajs`, `ioredis`, `react-native-sse`, `sse-starlette`, Django, FastAPI, Flask, Gin, Chi, Echo.

## The manifest (`.errementari.json`)

```json
{
  "version": "1.0.0",
  "installed_at": "2026-06-10T22:09:00.000Z",
  "files": {
    ".opencode/pipeline/check.sh": {
      "type": "generic",
      "version": "1.0.0",
      "hash": "<sha256>",
      "originalHash": "<sha256>"
    },
    "CLAUDE.md": {
      "type": "template",
      "hash": "<sha256>",
      "originalHash": "<sha256>"
    }
  }
}
```

- **`type: generic`** — pipeline scripts and plugins. Overwritten on upgrade *unless* `hash !== originalHash`.
- **`type: template`** — Handlebars-rendered files with project-specific values. Re-rendered on upgrade *unless* you modified them.
- **`type: static`** — files copied as-is (e.g. the `pipeline` agent definition). Same upgrade rules as templates.
- **`type: stub`** — starter files (e.g. `LEARNINGS.md`). Yours after install; never touched.

Commit `.errementari.json` to your repo so teammates' upgrades start from the same baseline.

## Customizing

Most users only edit:

- `CLAUDE.md` — add project-specific commands, conventions, "do not touch" lists.
- `.claude/settings.json` — tighten or loosen permissions for the project.
- `.claudeignore` — exclude paths from Claude Code's tool access.
- `.claude/LEARNINGS.md` — capture cross-cutting decisions.

Anything in `.opencode/pipeline/` is harness-owned. Edit only if you're sure; the next upgrade will respect your edits but you've taken responsibility for the divergence.

## Development

```bash
npm install
npm run dev -- init --help     # run the CLI from TS source via tsx
npm run typecheck
npm test                       # node:test suites under src/*.test.ts
npm run lint                   # Biome
npm run build                  # emits dist/
```

The `prepare` lifecycle script builds automatically on `npm install`, so consumers who install from a git URL get a working `bin/cli.js`.

## License

MIT
