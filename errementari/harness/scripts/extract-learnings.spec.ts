/**
 * Fase RED — tests para scripts/extract-learnings.ts (US-02: Nivel 3 de promoción)
 *
 * Runner: node --test con tsx como loader.
 * Ejecutar: npx tsx --test scripts/extract-learnings.spec.ts
 *
 * Estos tests verifican el comportamiento de 3 niveles de promoción
 * automática desde LEARNINGS.md hacia skills y AGENTS.md.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Import de la función a testear ────────────────────────────────────────
// La función extractAndPromote será exportada desde extract-learnings.ts
// En RED, este import fallará (la función aún no existe).
import { extractAndPromote } from './extract-learnings';

// ─── Helpers ───────────────────────────────────────────────────────────────

interface TempEnv {
  dir: string;
  learningsPath: string;
  skillsDir: string;
  agentsPath: string;
}

function createTempEnv(): TempEnv {
  const dir = mkdtempSync(join(tmpdir(), 'extract-learnings-test-'));
  const skillsDir = join(dir, 'skills');
  const learningsPath = join(dir, 'LEARNINGS.md');
  const agentsPath = join(dir, 'AGENTS.md');
  return { dir, learningsPath, skillsDir, agentsPath };
}

function cleanupTempEnv(env: TempEnv): void {
  rmSync(env.dir, { recursive: true, force: true });
}

function createLearningEntry(slug: string, agent: string, lesson: string): string {
  const date = '2026-06-10';
  return `---
date: ${date}
agent: ${agent}
category: pattern
tags: [test, ${slug}]
slug: ${slug}
---

**Contexto**: Testing the extract-learnings script.
**Qué pasó**: ${lesson}
**Lección**: ${lesson}
**Cómo aplicar**: En situaciones similares.
`;
}

function createSkillDoc(
  agent: string,
  reglasActivas: string[],
  leccionesRecientes: string[]
): string {
  const frontmatter = `---
name: ${agent}-learnings
description: Test skill for ${agent}
---

`;

  let reglasSection = '## Reglas activas (validadas \u22652 veces)\n';
  if (reglasActivas.length === 0) {
    reglasSection +=
      '*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea.*\n';
  } else {
    for (const regla of reglasActivas) {
      reglasSection += `- ${regla}\n`;
    }
  }

  let leccionesSection = '## Lecciones recientes\n';
  if (leccionesRecientes.length === 0) {
    leccionesSection +=
      '*Últimas 5 entradas de `.claude/LEARNINGS.md`. Se actualizan automáticamente.*\n';
  } else {
    for (const lec of leccionesRecientes) {
      leccionesSection += `- ${lec}\n`;
    }
  }

  const rest = `

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
`;

  return frontmatter + reglasSection + leccionesSection + rest;
}

function createAgentsDoc(blockers: string[]): string {
  return `# AGENTS.md — Instrucciones y Accionables por Agente

Este archivo contiene instrucciones base y accionables para cada agente del pipeline de open-supervisor.

---

## Accionables bloqueantes (Nivel 3 — Auto-generados)

| ID | Agente | Condición | Acción |
|----|--------|-----------|--------|
${blockers.length === 0
  ? '| *(vacío — se llena automáticamente cuando un slug alcanza 3 ocurrencias)* | | | |\n'
  : blockers.join('\n') + '\n'
}
---

## Agente \`test\`

**Responsable de:** testing.

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A99** | Test accionable | **BAJA** |

---
`;
}

/**
 * Crea un skill file en el directorio de skills del agente.
 */
function writeSkillFile(skillsDir: string, agent: string, content: string): string {
  const agentSkillDir = join(skillsDir, `${agent}-learnings`);
  const { mkdirSync } = require('node:fs');
  mkdirSync(agentSkillDir, { recursive: true });
  const skillPath = join(agentSkillDir, 'SKILL.md');
  writeFileSync(skillPath, content);
  return skillPath;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('extractAndPromote — Nivel 1 (1ª ocurrencia)', () => {
  let env: TempEnv;

  beforeEach(() => {
    env = createTempEnv();
  });

  afterEach(() => {
    cleanupTempEnv(env);
  });

  it('debe agregar a Lecciones recientes cuando el slug aparece por primera vez', () => {
    // Arrange: LEARNINGS.md con una entrada nueva
    const learningsContent = createLearningEntry(
      'test-pattern-nuevo',
      'architect',
      'Siempre verificar X antes de Y'
    );
    writeFileSync(env.learningsPath, learningsContent);

    // Skill vacío
    const skillContent = createSkillDoc('architect', [], []);
    writeSkillFile(env.skillsDir, 'architect', skillContent);

    // AGENTS.md vacío
    writeFileSync(env.agentsPath, createAgentsDoc([]));

    // Act
    extractAndPromote({
      learningsPath: env.learningsPath,
      skillsDir: env.skillsDir,
      agentsPath: env.agentsPath,
      maxRecent: 5,
      dryRun: false,
    });

    // Assert
    const updatedSkill = readFileSync(
      join(env.skillsDir, 'architect-learnings', 'SKILL.md'),
      'utf-8'
    );
    assert.ok(
      updatedSkill.includes('test-pattern-nuevo'),
      'Slug debe aparecer en Lecciones recientes'
    );
    assert.ok(
      updatedSkill.includes('Lecciones recientes'),
      'Debe tener sección Lecciones recientes'
    );
  });
});

describe('extractAndPromote — Nivel 2 (2ª ocurrencia)', () => {
  let env: TempEnv;

  beforeEach(() => {
    env = createTempEnv();
  });

  afterEach(() => {
    cleanupTempEnv(env);
  });

  it('debe promover a Reglas activas con marcador (x2,) cuando el slug ya está en Lecciones recientes', () => {
    // Arrange: LEARNINGS.md con entrada repetida
    const learningsContent = createLearningEntry(
      'test-pattern-repetido',
      'backend',
      'Siempre rebuild después de modificar código'
    );
    writeFileSync(env.learningsPath, learningsContent);

    // Skill con el slug ya en Lecciones recientes (simula 1ª ocurrencia previa)
    const skillContent = createSkillDoc(
      'backend',
      [],
      ['[2026-06-01] test-pattern-repetido — Siempre rebuild después de modificar código']
    );
    writeSkillFile(env.skillsDir, 'backend', skillContent);

    // AGENTS.md vacío
    writeFileSync(env.agentsPath, createAgentsDoc([]));

    // Act
    extractAndPromote({
      learningsPath: env.learningsPath,
      skillsDir: env.skillsDir,
      agentsPath: env.agentsPath,
      maxRecent: 5,
      dryRun: false,
    });

    // Assert
    const updatedSkill = readFileSync(
      join(env.skillsDir, 'backend-learnings', 'SKILL.md'),
      'utf-8'
    );
    assert.ok(
      updatedSkill.includes('(x2,'),
      'Debe tener marcador x2 en Reglas activas'
    );
    assert.ok(
      updatedSkill.includes('test-pattern-repetido'),
      'Slug debe estar en Reglas activas'
    );
    assert.ok(
      !updatedSkill.includes('[2026-06-01] test-pattern-repetido'),
      'Slug NO debe seguir en Lecciones recientes (fue promovido)'
    );
  });
});

describe('extractAndPromote — Nivel 3 (3ª ocurrencia)', () => {
  let env: TempEnv;

  beforeEach(() => {
    env = createTempEnv();
  });

  afterEach(() => {
    cleanupTempEnv(env);
  });

  it('debe agregar a Accionables bloqueantes en AGENTS.md cuando el slug ya está en Reglas activas con (x2,)', () => {
    // Arrange: LEARNINGS.md con 3ª entrada del mismo slug
    const learningsContent = createLearningEntry(
      'test-pattern-triple',
      'qa',
      'Siempre ejecutar mutation testing antes de cerrar'
    );
    writeFileSync(env.learningsPath, learningsContent);

    // Skill con slug ya promovido a Reglas activas (nivel 2)
    const skillContent = createSkillDoc(
      'qa',
      ['- **test-pattern-triple** (x2, 2026-06-05) — Siempre ejecutar mutation testing antes de cerrar'],
      []
    );
    writeSkillFile(env.skillsDir, 'qa', skillContent);

    // AGENTS.md con tabla vacía
    writeFileSync(env.agentsPath, createAgentsDoc([]));

    // Act
    extractAndPromote({
      learningsPath: env.learningsPath,
      skillsDir: env.skillsDir,
      agentsPath: env.agentsPath,
      maxRecent: 5,
      dryRun: false,
    });

    // Assert
    const updatedAgents = readFileSync(env.agentsPath, 'utf-8');
    assert.ok(
      updatedAgents.includes('B1'),
      'AGENTS.md debe contener un ID de bloqueante (B1)'
    );
    assert.ok(
      updatedAgents.includes('test-pattern-triple'),
      'AGENTS.md debe contener el slug en Accionables bloqueantes'
    );
    assert.ok(
      updatedAgents.includes('qa'),
      'AGENTS.md debe mencionar el agente qa'
    );

    // El slug debe desaparecer de Reglas activas (fue promovido a nivel 3)
    const updatedSkill = readFileSync(
      join(env.skillsDir, 'qa-learnings', 'SKILL.md'),
      'utf-8'
    );
    assert.ok(
      !updatedSkill.includes('test-pattern-triple'),
      'Slug NO debe seguir en Reglas activas (promovido a nivel 3)'
    );
  });

  it('NO debe duplicar entradas en AGENTS.md si el slug ya está allí (idempotencia nivel 3)', () => {
    // Arrange: LEARNINGS.md con una 4ª entrada del mismo slug
    const learningsContent = createLearningEntry(
      'test-pattern-triple-2',
      'architect',
      'Verificar versiones de dependencias nativas'
    );
    writeFileSync(env.learningsPath, learningsContent);

    // Skill con x2 marker
    const skillContent = createSkillDoc(
      'architect',
      ['- **test-pattern-triple-2** (x2, 2026-06-05) — Verificar versiones de dependencias nativas'],
      []
    );
    writeSkillFile(env.skillsDir, 'architect', skillContent);

    // AGENTS.md que YA contiene el slug (simula que ya fue promovido antes)
    const existingAgents = `# AGENTS.md — Instrucciones y Accionables por Agente

---

## Accionables bloqueantes (Nivel 3 — Auto-generados)

| ID | Agente | Condición | Acción |
|----|--------|-----------|--------|
| B1 | architect | test-pattern-triple-2 repetido 3+ veces | Verificar versiones de dependencias nativas |
| *(vacío — se llena automáticamente cuando un slug alcanza 3 ocurrencias)* | | | |

---

## Agente \`test\`

**Responsable de:** testing.
`;
    writeFileSync(env.agentsPath, existingAgents);

    // Act
    extractAndPromote({
      learningsPath: env.learningsPath,
      skillsDir: env.skillsDir,
      agentsPath: env.agentsPath,
      maxRecent: 5,
      dryRun: false,
    });

    // Assert: no debe haber duplicado
    const updatedAgents = readFileSync(env.agentsPath, 'utf-8');
    const occurrences = (updatedAgents.match(/test-pattern-triple-2/g) || []).length;
    assert.strictEqual(
      occurrences,
      1,
      'Slug debe aparecer exactamente 1 vez en AGENTS.md (sin duplicar)'
    );
  });

  it('NO debe promover a nivel 3 si el slug está en Reglas activas sin marcador (x2,) (inserción manual)', () => {
    // Arrange: LEARNINGS.md con entrada
    const learningsContent = createLearningEntry(
      'manual-rule-only',
      'backend',
      'Regla insertada manualmente sin pasar por nivel 2'
    );
    writeFileSync(env.learningsPath, learningsContent);

    // Skill con regla activa SIN marcador x2 (inserción manual)
    const skillContent = createSkillDoc(
      'backend',
      ['- **manual-rule-only** — Regla insertada manualmente sin pasar por nivel 2'],
      []
    );
    writeSkillFile(env.skillsDir, 'backend', skillContent);

    // AGENTS.md vacío
    writeFileSync(env.agentsPath, createAgentsDoc([]));

    // Act
    extractAndPromote({
      learningsPath: env.learningsPath,
      skillsDir: env.skillsDir,
      agentsPath: env.agentsPath,
      maxRecent: 5,
      dryRun: false,
    });

    // Assert: NO debe promover a AGENTS.md
    const updatedAgents = readFileSync(env.agentsPath, 'utf-8');
    assert.ok(
      !updatedAgents.includes('B1'),
      'AGENTS.md NO debe tener B1 porque la regla fue insertada manualmente'
    );
    // El slug debe seguir en Reglas activas
    const updatedSkill = readFileSync(
      join(env.skillsDir, 'backend-learnings', 'SKILL.md'),
      'utf-8'
    );
    assert.ok(
      updatedSkill.includes('manual-rule-only'),
      'Slug debe seguir en Reglas activas (no promovido a nivel 3 porque no tiene x2)'
    );
  });
});

describe('extractAndPromote — Idempotencia', () => {
  let env: TempEnv;

  beforeEach(() => {
    env = createTempEnv();
  });

  afterEach(() => {
    cleanupTempEnv(env);
  });

  it('ejecutar 2 veces con la misma entrada no duplica en Lecciones recientes', () => {
    // Arrange
    const learningsContent = createLearningEntry(
      'test-idempotencia-1',
      'architect',
      'Patrón de idempotencia'
    );
    writeFileSync(env.learningsPath, learningsContent);

    const skillContent = createSkillDoc('architect', [], []);
    writeSkillFile(env.skillsDir, 'architect', skillContent);
    writeFileSync(env.agentsPath, createAgentsDoc([]));

    const options = {
      learningsPath: env.learningsPath,
      skillsDir: env.skillsDir,
      agentsPath: env.agentsPath,
      maxRecent: 5,
      dryRun: false,
    };

    // Act: ejecutar 2 veces
    extractAndPromote(options);
    extractAndPromote(options);

    // Assert: solo 1 ocurrencia en Lecciones recientes
    const updatedSkill = readFileSync(
      join(env.skillsDir, 'architect-learnings', 'SKILL.md'),
      'utf-8'
    );
    const occurrences = (updatedSkill.match(/test-idempotencia-1/g) || []).length;
    assert.strictEqual(
      occurrences,
      1,
      'Slug debe aparecer exactamente 1 vez (sin duplicar)'
    );
  });
});
