import assert from "node:assert/strict";
import { test } from "node:test";

// pipeline-core.mjs is plain JS shared with opencode; import it by path so tsc
// treats the module as untyped instead of requiring declarations.
const corePath = "../pipeline/pipeline-core.mjs";
const core = await import(corePath);

test("extractionTimeoutMs keeps the 10 s budget for the heuristic provider", () => {
  assert.equal(core.extractionTimeoutMs({}), 10_000);
  assert.equal(core.extractionTimeoutMs({ ERRE_SUMMARY_PROVIDER: "heuristic" }), 10_000);
});

test("extractionTimeoutMs adds start-up headroom to the LLM timeout for ollama", () => {
  assert.equal(core.extractionTimeoutMs({ ERRE_SUMMARY_PROVIDER: "ollama" }), 90_000);
  assert.equal(
    core.extractionTimeoutMs({ ERRE_SUMMARY_PROVIDER: "ollama", ERRE_LLM_TIMEOUT_MS: "20000" }),
    50_000,
  );
  assert.equal(
    core.extractionTimeoutMs({ ERRE_SUMMARY_PROVIDER: "ollama", ERRE_LLM_TIMEOUT_MS: "nope" }),
    90_000,
  );
});
