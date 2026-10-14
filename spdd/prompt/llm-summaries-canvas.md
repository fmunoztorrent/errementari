# REASONS Canvas — LLM summaries for learnings (Ollama + gpt-oss:20b)

Spec: `spec/2026-10-13-llm-summaries-ollama.spec.md` · BDD: `spec/llm-summaries-ollama.feature`

```xml
<REASONS>
  <Requirements>
    Problem: learning summaries (Lecciones recientes, Reglas activas, AGENTS.md
    level-3 rows) come from a heuristic that copies the `**Lección**:` line and
    cuts it at 120 chars mid-word. Entries without that line get their first two
    lines. We want an optional local LLM (gpt-oss:20b served by Ollama) to write
    the one-line summary.
    DoD: opt-in provider works end to end against a real Ollama; any failure
    falls back to the heuristic; default behaviour is byte-identical to today;
    reprocessing the same entry is a no-op; the Claude Code Stop hook reaches
    the extraction in freshly initialized projects; scripts/ specs and
    typecheck run in CI.
    In scope: scripts/llm-summary.ts, extract-learnings main(), pipeline-core
    extraction timeout + promise, pipeline-cli `extract-learnings`, settings
    template Stop hook, uninstall cleanup, package scripts, docs.
    Out of scope: summarizing scope closes/PRs, OpenAI-compatible providers
    (LM Studio/Bionic), making agent models configurable (AGENT_MODELS).
  </Requirements>

  <Entities>
    SummaryConfig { provider: "heuristic" | "ollama"; baseUrl; model;
      think: "low"|"medium"|"high"|boolean; numCtx; keepAlive; timeoutMs;
      allowRemote: boolean }
    LearningEntry (existing) — fullBlock is the identity of an entry.
    ProcessedMarker (.opencode/pipeline/learnings-processed.json)
      { hash: sha256(fullBlock), slug, date, processed_at }
    Invariants: a summary is a single line, ≤ 120 chars, contains no `|`
    (it lands in a markdown table) and no newline. provider=heuristic never
    opens a socket.
  </Entities>

  <Approach>
    1. Keep extractAndPromote() synchronous and its contract unchanged; add an
       optional `summary` override. The async LLM call happens in main()
       before promotion, so the 6 existing specs stay untouched.
    2. Talk to Ollama's native /api/chat (documented `think`, `keep_alive`,
       `options.num_ctx`, `message.content`); the OpenAI-compatible endpoint
       does not document reasoning control for gpt-oss.
    3. Native fetch + AbortSignal.timeout (Node ≥ 20): no new dependencies.
    4. Idempotency in main(): hash the last entry; if it matches the marker,
       skip before calling the LLM. Fixes the latent level-1 → level-2 double
       promotion when several Stop hooks fire inside the 5-minute window.
    5. One extraction path for both CLIs: Claude Code's Stop hook calls
       `pipeline-cli.mjs extract-learnings` (same as opencode's onClose), run
       with `async: true` so a slow model never blocks the session.
    6. Child timeout = 10 s for heuristic, ERRE_LLM_TIMEOUT_MS + 30 s for ollama
       (npx/tsx start-up + model cold load).
  </Approach>

  <Structure>
    NEW  errementari/scripts/llm-summary.ts        (+ harness/scripts mirror)
    NEW  errementari/scripts/llm-summary.spec.ts   (+ harness/scripts mirror)
    MOD  errementari/scripts/extract-learnings.ts  (+ mirror) summary option, async main, marker
    MOD  errementari/scripts/extract-learnings.spec.ts (+ mirror) summary override + marker cases
    MOD  errementari/pipeline/pipeline-core.mjs    (+ mirror) timeout fn, returns Promise
    MOD  errementari/pipeline/pipeline-cli.mjs     (+ mirror) `extract-learnings` command
    MOD  errementari/bin/errementari.js            await extraction before exit
    MOD  errementari/templates/settings.json.hbs   Stop hook → pipeline-cli, async
    MOD  errementari/src/commands/uninstall.ts     remove learnings-processed.json
    NEW  errementari/src/pipeline-core.test.ts     timeout fn
    MOD  errementari/src/render.test.ts            Stop hook assertion
    MOD  errementari/package.json                  test + typecheck include scripts/
    MOD  README.md, CHANGELOG.md
  </Structure>

  <Operations>
    O-1 loadSummaryConfig(env = process.env): SummaryConfig
        defaults: provider "heuristic", baseUrl "http://127.0.0.1:11434",
        model "gpt-oss:20b", think "low", numCtx 8192, keepAlive "10m",
        timeoutMs 60000, allowRemote false. Invalid numbers → default.
    O-2 sanitizeSummary(raw: string, maxChars = 120): string | null
        strip markdown emphasis/backticks/quotes, replace `|` with "/",
        collapse whitespace to one line, cut on a word boundary, "" → null.
    O-3 isLoopback(url: string): boolean — localhost, 127.0.0.0/8, ::1.
    O-4 summarizeWithLlm(body, config, fetchImpl = fetch): Promise<string|null>
        provider !== "ollama" → null without fetch; non-loopback without
        allowRemote → warn + null; POST {baseUrl}/api/chat
        { model, messages:[system, user], stream:false, think, keep_alive,
          options:{ num_ctx, temperature:0 } }; non-2xx, timeout, network
        error, missing/empty message.content → warn + null; never throws.
    O-5 extract-learnings: ExtractOptions.summary?: string — when present it
        replaces generateSummary(entry.body) at level 1 and level 3.
    O-6 extract-learnings main(): async — parse last entry; if
        hash(fullBlock) equals marker → log + return; summary =
        await summarizeWithLlm(...) only when the entry's agent has a
        learnings skill (VALID_AGENTS); extractAndPromote({ summary });
        write marker unless --dry-run. Exported helpers:
        isAlreadyProcessed(content, markerPath), markProcessed(content, markerPath).
    O-7 pipeline-core: extractionTimeoutMs(env): number;
        extractLearningsAfterClose() returns Promise<void> resolved on child
        close/error (or immediately when nothing is pending).
    O-8 pipeline-cli `extract-learnings` → await extractLearningsAfterClose();
        exit 0. bin `extract-learnings` awaits too.
    O-9 settings.json.hbs Stop hook: `node .opencode/pipeline/pipeline-cli.mjs
        extract-learnings`, "async": true, "timeout": 180.
  </Operations>

  <Norms>
    Match each file's idiom: scripts/ in TypeScript with Spanish comments,
    double quotes and semicolons; pipeline/*.mjs without semicolons.
    Tests use node:test + node:assert/strict; HTTP is faked with node:http on
    an ephemeral port — no real network in tests. Commands via
    `pnpm --filter errementari …`. Every vendored file stays byte-identical
    (`check:harness`); new vendored files are copied once, then synced.
    Logs go to stderr with the `[extract-learnings]` / `[llm-summary]` prefix.
  </Norms>

  <Safeguards>
    Default provider is heuristic: zero behaviour change for existing installs.
    The hook must never fail the session: every LLM error falls back.
    No learnings content leaves the machine unless ERRE_LLM_ALLOW_REMOTE=1.
    No API keys, hostnames or absolute paths committed (hardcode guard).
    No new runtime dependencies. Summary ≤ 120 chars, single line, no `|`.
  </Safeguards>
</REASONS>
```
