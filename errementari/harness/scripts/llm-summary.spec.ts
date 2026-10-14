/**
 * Tests para scripts/llm-summary.ts — resúmenes de learnings con un LLM local (Ollama).
 *
 * Runner: node --test con tsx como loader.
 * Ejecutar: npx tsx --test scripts/llm-summary.spec.ts
 *
 * El servidor de Ollama se simula con node:http en un puerto efímero:
 * ningún test sale a la red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  isLoopback,
  loadSummaryConfig,
  sanitizeSummary,
  summarizeWithLlm,
  type SummaryConfig,
} from './llm-summary';

// ─── Helpers ───────────────────────────────────────────────────────────────

interface FakeOllama {
  baseUrl: string;
  requests: { path: string; body: any }[];
  close: () => Promise<void>;
}

async function startFakeOllama(
  handler: (req: IncomingMessage, res: ServerResponse, body: any) => void
): Promise<FakeOllama> {
  const requests: { path: string; body: any }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ path: req.url ?? '', body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function reply(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function ollamaConfig(baseUrl: string, overrides: Partial<SummaryConfig> = {}): SummaryConfig {
  return { ...loadSummaryConfig({ ERRE_SUMMARY_PROVIDER: 'ollama' }), baseUrl, ...overrides };
}

const BODY = '**Contexto**: hooks.\n**Lección**: Verificar que cada hook apunte a archivos instalados.';

// ─── loadSummaryConfig ─────────────────────────────────────────────────────

describe('loadSummaryConfig', () => {
  it('usa defaults seguros cuando no hay variables de entorno', () => {
    assert.deepStrictEqual(loadSummaryConfig({}), {
      provider: 'heuristic',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'gpt-oss:20b',
      think: 'low',
      numCtx: 8192,
      keepAlive: '10m',
      timeoutMs: 60000,
      allowRemote: false,
    });
  });

  it('lee cada override desde ERRE_*', () => {
    const config = loadSummaryConfig({
      ERRE_SUMMARY_PROVIDER: 'ollama',
      ERRE_LLM_BASE_URL: 'http://localhost:9999/',
      ERRE_LLM_MODEL: 'gpt-oss:120b',
      ERRE_LLM_THINK: 'medium',
      ERRE_LLM_NUM_CTX: '16384',
      ERRE_LLM_KEEP_ALIVE: '30m',
      ERRE_LLM_TIMEOUT_MS: '15000',
      ERRE_LLM_ALLOW_REMOTE: '1',
    });
    assert.deepStrictEqual(config, {
      provider: 'ollama',
      baseUrl: 'http://localhost:9999',
      model: 'gpt-oss:120b',
      think: 'medium',
      numCtx: 16384,
      keepAlive: '30m',
      timeoutMs: 15000,
      allowRemote: true,
    });
  });

  it('acepta think booleano y descarta valores inválidos', () => {
    assert.strictEqual(loadSummaryConfig({ ERRE_LLM_THINK: 'false' }).think, false);
    assert.strictEqual(loadSummaryConfig({ ERRE_LLM_THINK: 'true' }).think, true);
    assert.strictEqual(loadSummaryConfig({ ERRE_LLM_THINK: 'extreme' }).think, 'low');
    assert.strictEqual(loadSummaryConfig({ ERRE_LLM_NUM_CTX: 'abc' }).numCtx, 8192);
    assert.strictEqual(loadSummaryConfig({ ERRE_LLM_TIMEOUT_MS: '-5' }).timeoutMs, 60000);
    assert.strictEqual(loadSummaryConfig({ ERRE_SUMMARY_PROVIDER: 'openai' }).provider, 'heuristic');
  });
});

// ─── sanitizeSummary ───────────────────────────────────────────────────────

describe('sanitizeSummary', () => {
  it('deja una sola línea y colapsa espacios', () => {
    assert.strictEqual(sanitizeSummary('  Primera parte\n\n  segunda   parte  '), 'Primera parte segunda parte');
  });

  it('reemplaza | para no romper la tabla de AGENTS.md', () => {
    assert.strictEqual(sanitizeSummary('Usar A | B'), 'Usar A / B');
  });

  it('quita markdown y comillas envolventes', () => {
    assert.strictEqual(sanitizeSummary('"**Usar** `fetch` con _timeout_"'), 'Usar fetch con timeout');
  });

  it('corta en límite de palabra sin superar el máximo', () => {
    const words = 'palabra '.repeat(30).trim(); // 239 chars
    const result = sanitizeSummary(words, 120)!;
    assert.ok(result.length <= 120, `largo ${result.length} > 120`);
    assert.ok(words.startsWith(result), 'debe ser un prefijo del texto');
    assert.strictEqual(words[result.length], ' ', 'debe cortar justo antes de un espacio');
  });

  it('devuelve null si no queda texto', () => {
    assert.strictEqual(sanitizeSummary('   \n  '), null);
    assert.strictEqual(sanitizeSummary('``'), null);
  });
});

// ─── isLoopback ────────────────────────────────────────────────────────────

describe('isLoopback', () => {
  it('reconoce direcciones locales', () => {
    for (const url of ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://127.8.9.1', 'http://[::1]:11434']) {
      assert.strictEqual(isLoopback(url), true, url);
    }
  });

  it('rechaza hosts remotos y URLs inválidas', () => {
    for (const url of ['http://192.168.1.50:11434', 'https://example.com', 'no-es-una-url']) {
      assert.strictEqual(isLoopback(url), false, url);
    }
  });
});

// ─── summarizeWithLlm ──────────────────────────────────────────────────────

describe('summarizeWithLlm', () => {
  it('con provider heuristic no hace ninguna petición', async () => {
    const fake = await startFakeOllama((_req, res) => reply(res, 200, {}));
    try {
      const config = { ...loadSummaryConfig({}), baseUrl: fake.baseUrl };
      assert.strictEqual(await summarizeWithLlm(BODY, config), null);
      assert.strictEqual(fake.requests.length, 0);
    } finally {
      await fake.close();
    }
  });

  it('devuelve message.content saneado e ignora message.thinking', async () => {
    const fake = await startFakeOllama((_req, res) =>
      reply(res, 200, {
        message: { role: 'assistant', content: 'Verificar que cada hook\napunte a archivos instalados.', thinking: 'razonando…' },
      })
    );
    try {
      const summary = await summarizeWithLlm(BODY, ollamaConfig(fake.baseUrl));
      assert.strictEqual(summary, 'Verificar que cada hook apunte a archivos instalados.');
    } finally {
      await fake.close();
    }
  });

  it('envía think, keep_alive, num_ctx y temperature 0 a /api/chat', async () => {
    const fake = await startFakeOllama((_req, res) => reply(res, 200, { message: { content: 'ok' } }));
    try {
      await summarizeWithLlm(BODY, ollamaConfig(fake.baseUrl));
      assert.strictEqual(fake.requests.length, 1);
      const { path, body } = fake.requests[0];
      assert.strictEqual(path, '/api/chat');
      assert.strictEqual(body.model, 'gpt-oss:20b');
      assert.strictEqual(body.stream, false);
      assert.strictEqual(body.think, 'low');
      assert.strictEqual(body.keep_alive, '10m');
      assert.deepStrictEqual(body.options, { num_ctx: 8192, temperature: 0 });
      assert.strictEqual(body.messages[0].role, 'system');
      assert.ok(body.messages[1].content.includes('archivos instalados'), 'el cuerpo de la entrada va en el mensaje user');
    } finally {
      await fake.close();
    }
  });

  it('devuelve null ante HTTP 500', async () => {
    const fake = await startFakeOllama((_req, res) => reply(res, 500, { error: 'boom' }));
    try {
      assert.strictEqual(await summarizeWithLlm(BODY, ollamaConfig(fake.baseUrl)), null);
    } finally {
      await fake.close();
    }
  });

  it('devuelve null si el contenido viene vacío', async () => {
    const fake = await startFakeOllama((_req, res) =>
      reply(res, 200, { message: { content: '', thinking: 'se gastó todo el contexto razonando' } })
    );
    try {
      assert.strictEqual(await summarizeWithLlm(BODY, ollamaConfig(fake.baseUrl)), null);
    } finally {
      await fake.close();
    }
  });

  it('devuelve null si el modelo no responde antes del timeout', async () => {
    const fake = await startFakeOllama((_req, res) => {
      setTimeout(() => reply(res, 200, { message: { content: 'tarde' } }), 500);
    });
    try {
      const started = Date.now();
      assert.strictEqual(await summarizeWithLlm(BODY, ollamaConfig(fake.baseUrl, { timeoutMs: 50 })), null);
      assert.ok(Date.now() - started < 400, 'debe abortar en el timeout, no esperar la respuesta');
    } finally {
      await fake.close();
    }
  });

  it('devuelve null si Ollama no está corriendo', async () => {
    const fake = await startFakeOllama((_req, res) => reply(res, 200, {}));
    const deadUrl = fake.baseUrl;
    await fake.close(); // el puerto queda libre: conexión rechazada
    assert.strictEqual(await summarizeWithLlm(BODY, ollamaConfig(deadUrl)), null);
  });

  it('rechaza un host remoto sin ERRE_LLM_ALLOW_REMOTE', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ message: { content: 'remoto' } }));
    }) as typeof fetch;
    const config = ollamaConfig('http://192.168.1.50:11434');
    assert.strictEqual(await summarizeWithLlm(BODY, config, fetchImpl), null);
    assert.strictEqual(calls, 0);
  });

  it('usa un host remoto cuando allowRemote está activo', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: { content: 'Resumen remoto.' } }))) as typeof fetch;
    const config = ollamaConfig('http://192.168.1.50:11434', { allowRemote: true });
    assert.strictEqual(await summarizeWithLlm(BODY, config, fetchImpl), 'Resumen remoto.');
  });
});
