/**
 * llm-summary.ts — Resume una entrada de LEARNINGS.md con un LLM local (Ollama).
 *
 * Opt-in: con ERRE_SUMMARY_PROVIDER=ollama se llama a la API nativa /api/chat
 * (documenta `think`, `keep_alive` y `options.num_ctx`, que la capa compatible
 * con OpenAI no documenta para gpt-oss). Cualquier fallo devuelve null y el
 * llamador usa la heurística de extract-learnings.ts. Nunca lanza.
 *
 * Variables (todas opcionales):
 *   ERRE_SUMMARY_PROVIDER  heuristic (default) | ollama
 *   ERRE_LLM_BASE_URL      http://127.0.0.1:11434
 *   ERRE_LLM_MODEL         gpt-oss:20b
 *   ERRE_LLM_THINK         low (default) | medium | high | true | false
 *   ERRE_LLM_NUM_CTX       8192
 *   ERRE_LLM_KEEP_ALIVE    10m
 *   ERRE_LLM_TIMEOUT_MS    60000
 *   ERRE_LLM_ALLOW_REMOTE  1 para permitir un host que no sea loopback
 */

export type SummaryProvider = "heuristic" | "ollama";
export type ThinkLevel = "low" | "medium" | "high" | boolean;

export interface SummaryConfig {
  provider: SummaryProvider;
  baseUrl: string;
  model: string;
  think: ThinkLevel;
  numCtx: number;
  keepAlive: string;
  timeoutMs: number;
  allowRemote: boolean;
}

// Mismo tope que la heurística: el resumen termina en una celda de AGENTS.md.
export const MAX_SUMMARY_CHARS = 120;

const DEFAULTS: SummaryConfig = {
  provider: "heuristic",
  baseUrl: "http://127.0.0.1:11434",
  model: "gpt-oss:20b",
  think: "low",
  numCtx: 8192,
  keepAlive: "10m",
  timeoutMs: 60000,
  allowRemote: false,
};

const SYSTEM_PROMPT =
  "Resumes lecciones de ingeniería para un registro interno. Responde con UNA sola " +
  `frase en español, de máximo ${MAX_SUMMARY_CHARS} caracteres, que diga qué hacer. ` +
  "Sin markdown, sin comillas, sin el carácter |, sin prefijos como 'Lección:'.";

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseThink(raw: string | undefined): ThinkLevel {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return DEFAULTS.think;
}

export function loadSummaryConfig(env: Env = process.env): SummaryConfig {
  return {
    provider: env.ERRE_SUMMARY_PROVIDER === "ollama" ? "ollama" : DEFAULTS.provider,
    baseUrl: (env.ERRE_LLM_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: env.ERRE_LLM_MODEL || DEFAULTS.model,
    think: parseThink(env.ERRE_LLM_THINK),
    numCtx: positiveInt(env.ERRE_LLM_NUM_CTX, DEFAULTS.numCtx),
    keepAlive: env.ERRE_LLM_KEEP_ALIVE || DEFAULTS.keepAlive,
    timeoutMs: positiveInt(env.ERRE_LLM_TIMEOUT_MS, DEFAULTS.timeoutMs),
    allowRemote: env.ERRE_LLM_ALLOW_REMOTE === "1",
  };
}

/**
 * Deja la salida del modelo apta para una línea de skill o una celda de tabla:
 * una sola línea, sin markdown ni `|`, cortada en límite de palabra.
 */
export function sanitizeSummary(raw: string, maxChars = MAX_SUMMARY_CHARS): string | null {
  let text = raw
    .replace(/[*_`]+/g, "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'«“]+|["'»”]+$/g, "")
    .trim();
  if (!text) return null;
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars + 1);
    const lastSpace = cut.lastIndexOf(" ");
    text = (lastSpace > 0 ? cut.slice(0, lastSpace) : text.slice(0, maxChars)).replace(/[\s,;:]+$/, "");
  }
  return text || null;
}

export function isLoopback(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return host === "localhost" || host === "[::1]" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

function warn(message: string): void {
  console.error(`[llm-summary] ${message} — using heuristic summary`);
}

export async function summarizeWithLlm(
  body: string,
  config: SummaryConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (config.provider !== "ollama") return null;
  if (!config.allowRemote && !isLoopback(config.baseUrl)) {
    warn(`${config.baseUrl} is not a loopback address (set ERRE_LLM_ALLOW_REMOTE=1 to allow it)`);
    return null;
  }

  try {
    const res = await fetchImpl(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: body },
        ],
        stream: false,
        think: config.think,
        keep_alive: config.keepAlive,
        options: { num_ctx: config.numCtx, temperature: 0 },
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) {
      warn(`Ollama answered HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { message?: { content?: unknown } };
    const content = typeof data.message?.content === "string" ? data.message.content : "";
    const summary = sanitizeSummary(content);
    if (!summary) warn("Ollama returned an empty answer");
    return summary;
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? `no answer after ${config.timeoutMs} ms` : String(e instanceof Error ? e.message : e);
    warn(`request to ${config.baseUrl} failed: ${reason}`);
    return null;
  }
}
