# Spec: Local LLM summaries for learnings (Ollama + gpt-oss:20b)

**Status:** Implemented · **Pipeline:** `feature.llm-summaries` · **Canvas:** `spdd/prompt/llm-summaries-canvas.md` · **BDD:** `spec/llm-summaries-ollama.feature`

## Context

`scripts/extract-learnings.ts` promotes the last `.claude/LEARNINGS.md` entry into the agent's
learnings skill and, at level 3, into `.claude/AGENTS.md`. The one-line summary it writes comes
from `generateSummary()`: it copies the `**Lección**:` line and truncates it at 120 characters,
mid-word; without that line it concatenates the first two lines of the body.

Exploration found three problems in the path the summary takes:

1. **Fresh Claude Code projects never run the extraction.** The generated Stop hook runs
   `npx -y tsx scripts/extract-learnings.ts`, but `init` does not install `scripts/` (verified
   with `init --dry-run`: 31 items, none under `scripts/`). The `2>/dev/null || true` hides it.
   opencode works because its `onClose` goes through `pipeline-core.mjs`, which falls back to the
   plugin's own `scripts/`.
2. **The child process is killed after 10 s** (`pipeline-core.mjs`), and `bin/errementari.js`
   calls `process.exit(0)` right after spawning it.
3. **Reprocessing promotes.** `close-pending.json` stays fresh for 5 minutes, so several Stop
   hooks can process the same entry; the second pass finds the slug in *Lecciones recientes* and
   promotes it to level 2. The existing idempotency spec only counts slug occurrences, so it
   passes anyway.

## Measured baseline (MacBook Pro M5 Pro, 24 GB, Ollama 0.40.3, `gpt-oss:20b`)

| Measure | Value |
|---|---|
| Model size | 13 GB on disk, 12 GB loaded |
| Placement / runner | 100% GPU, llama.cpp (not MLX) |
| Cold request (`think: "low"`, `num_ctx` 8192) | 9.2 s, of which 8.0 s model load |
| Warm request | 0.8 s, ~62 tokens/s |
| Output length for a "≤ 120 chars" prompt | ~123 chars → sanitizing is required |

## User stories

### US-01: Opt-in Ollama summaries with heuristic fallback `[Must]`

> As a **developer running gpt-oss:20b locally**, I want learning summaries written by the model,
> so that skills and AGENTS.md get readable one-liners instead of truncated copies.

- [x] `ERRE_SUMMARY_PROVIDER=ollama` makes extraction call Ollama's `/api/chat`
- [x] Without the variable (default `heuristic`) no request is made and output is unchanged
- [x] Network error, timeout, non-2xx or empty `message.content` → heuristic summary + stderr warning
- [x] The summary is one line, ≤ 120 chars, cut on a word boundary, with no `|` and no markdown

### US-02: Safe, configurable model call `[Must]`

> As a **developer**, I want sane defaults for a reasoning model, so that summaries are fast and
> nothing leaves my machine by accident.

- [x] Defaults: base URL `http://127.0.0.1:11434`, model `gpt-oss:20b`, `think: "low"`,
      `num_ctx` 8192, `keep_alive` `10m`, timeout 60 s, `temperature: 0`
- [x] Each default is overridable via `ERRE_LLM_*` environment variables
- [x] A non-loopback base URL is refused unless `ERRE_LLM_ALLOW_REMOTE=1`

### US-03: Reprocessing the same entry is a no-op `[Must]`

> As a **pipeline user**, I want one close to produce one promotion, so that repeated Stop hooks
> neither call the model again nor promote the entry to level 2.

- [x] The CLI records `sha256(entry)` in `.opencode/pipeline/learnings-processed.json`
- [x] Same entry again → skipped before any LLM call; `--dry-run` never writes the marker
- [x] `uninstall` removes the marker

### US-04: One extraction path for Claude Code and opencode `[Must]`

> As a **Claude Code user of a generated project**, I want the Stop hook to actually run the
> extraction, without blocking my session while the model loads.

- [x] Generated Stop hook: `node .opencode/pipeline/pipeline-cli.mjs extract-learnings`,
      `"async": true`, `"timeout": 180`
- [x] `pipeline-cli.mjs` and `bin/errementari.js` wait for the child before exiting
- [x] Child timeout: 10 s for `heuristic`; `ERRE_LLM_TIMEOUT_MS` + 30 s for `ollama`

### US-05: scripts/ are covered by CI `[Should]`

- [x] `pnpm --filter errementari test` runs `src/*.test.ts` **and** `scripts/*.spec.ts`
- [x] `pnpm --filter errementari run typecheck` also checks `scripts/tsconfig.json`

### US-06: Documentation `[Should]`

- [x] README documents setup (Ollama, model pull) and every `ERRE_*` variable
- [x] CHANGELOG `[Unreleased]` entry

## Out of scope

Summaries of scope closes or PRs; OpenAI-compatible providers (LM Studio, Bionic); configurable
agent models (`AGENT_MODELS`); `init` installing `scripts/` (no longer needed once the hook goes
through `pipeline-cli.mjs`).

## TDD plan

| US | RED test | Where |
|---|---|---|
| US-01 | provider heuristic makes zero requests; ollama success returns content; 500 / timeout / connection refused / empty content → null | `scripts/llm-summary.spec.ts` |
| US-01 | sanitize: multi-line, `\|`, markdown, > 120 chars, empty | `scripts/llm-summary.spec.ts` |
| US-01 | `summary` option replaces the heuristic at level 1 and level 3 | `scripts/extract-learnings.spec.ts` |
| US-02 | config defaults and env overrides; remote URL refused; request body carries think/keep_alive/num_ctx | `scripts/llm-summary.spec.ts` |
| US-03 | marker helpers: same entry detected, different entry not | `scripts/extract-learnings.spec.ts` |
| US-04 | `extractionTimeoutMs` per provider; rendered settings Stop hook | `src/pipeline-core.test.ts`, `src/render.test.ts` |

## Definition of Done

- [x] All checks green: typecheck, lint, test (src + scripts), build, `check:harness`
- [x] Live run against Ollama produces a sanitized summary; server stopped → heuristic fallback
- [x] Default provider leaves extraction output identical to before
