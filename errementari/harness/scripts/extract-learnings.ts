#!/usr/bin/env node
/**
 * extract-learnings.ts — Extrae la última entrada de LEARNINGS.md y la
 * agrega al skill de learnings correspondiente al agente.
 *
 * Idempotente: si la última entrada ya existe en el skill, no duplica.
 * Auto-promoción en 3 niveles:
 *   Nivel 1 (1ª ocurrencia): agrega a "Lecciones recientes" en skill del agente.
 *   Nivel 2 (2ª ocurrencia): promueve a "Reglas activas" en skill del agente.
 *   Nivel 3 (3ª ocurrencia): agrega a "Accionables bloqueantes" en .claude/AGENTS.md.
 *
 * Uso:
 *   npx tsx scripts/extract-learnings.ts          # proceso normal
 *   npx tsx scripts/extract-learnings.ts --dry-run  # simula sin modificar archivos
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

// ── Config ───────────────────────────────────────────────────────────────

// Se ejecuta con tsx, que soporta __dirname en modo CJS
const REPO_ROOT = resolve(__dirname, "..");
const LEARNINGS_PATH = resolve(REPO_ROOT, ".claude", "LEARNINGS.md");
const SKILLS_DIR = resolve(REPO_ROOT, ".claude", "skills");
const AGENTS_PATH = resolve(REPO_ROOT, ".claude", "AGENTS.md");
const MAX_RECENT = 5;

const VALID_AGENTS = new Set(["qa", "backend", "frontend", "architect"]);

const DRY_RUN = process.argv.includes("--dry-run");

// ── Types ────────────────────────────────────────────────────────────────

interface LearningEntry {
  date: string;
  agent: string;
  category: string;
  tags: string[];
  slug: string;
  fullBlock: string; // Raw markdown del bloque completo (frontmatter + body)
  body: string; // Solo el cuerpo (después del segundo ---)
}

interface SkillsDoc {
  frontmatter: string;
  reglasActivas: string[];
  leccionesRecientes: {
    slug: string;
    date: string;
    summary: string;
  }[];
  rest: string; // El resto del documento después de las secciones editables
}

export interface ExtractOptions {
  /** Ruta al archivo LEARNINGS.md (default: .claude/LEARNINGS.md) */
  learningsPath?: string;
  /** Directorio de skills (default: .claude/skills) */
  skillsDir?: string;
  /** Ruta al archivo AGENTS.md (default: .claude/AGENTS.md) */
  agentsPath?: string;
  /** Máximo de entradas en Lecciones recientes (default: 5) */
  maxRecent?: number;
  /** Modo dry-run: no modifica archivos (default: false) */
  dryRun?: boolean;
}

// ── Parseo de LEARNINGS.md ───────────────────────────────────────────────

/**
 * Encuentra la última entrada con frontmatter YAML en LEARNINGS.md.
 * Busca el último bloque delimitado por `---` (inicio y fin de
 * frontmatter). El cuerpo es todo el texto entre el segundo `---`
 * y el siguiente `---` (que inicia otra entrada) o EOF.
 */
function parseLastEntry(content: string): LearningEntry | null {
  const lines = content.split("\n");
  const blocks: { startIdx: number; endIdx: number; frontmatter: string }[] =
    [];

  let inBlock = false;
  let blockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === "---" && !inBlock) {
      // Possible start of a frontmatter block
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (/^\w+:/.test(nextLine)) {
        inBlock = true;
        blockStart = i;
      }
    } else if (line === "---" && inBlock && i > blockStart) {
      // End of frontmatter block
      inBlock = false;
      const frontmatterLines = lines.slice(blockStart + 1, i);
      blocks.push({
        startIdx: blockStart,
        endIdx: i,
        frontmatter: frontmatterLines.join("\n"),
      });
      blockStart = -1;
    }
  }

  if (blocks.length === 0) return null;

  // Tomar el último bloque
  const last = blocks[blocks.length - 1];
  const frontmatterText = last.frontmatter;

  // Extraer campos del frontmatter
  const agent = extractYamlValue(frontmatterText, "agent");
  const slug = extractYamlValue(frontmatterText, "slug");
  const date = extractYamlValue(frontmatterText, "date");
  const category = extractYamlValue(frontmatterText, "category");
  const tagsStr = extractYamlValue(frontmatterText, "tags");

  if (!agent || !slug) return null;

  // Parsear tags
  let tags: string[] = [];
  if (tagsStr) {
    const match = tagsStr.match(/\[(.*?)\]/);
    if (match) {
      tags = match[1]
        .split(",")
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
  }

  // Extraer el cuerpo: después del segundo `---` hasta el siguiente `---` o EOF
  const bodyStartIdx = last.endIdx + 1;
  const nextBlockStart = blocks.find((b) => b.startIdx > last.endIdx);
  const bodyEndIdx = nextBlockStart ? nextBlockStart.startIdx : lines.length;
  const bodyLines = lines.slice(bodyStartIdx, bodyEndIdx);
  const body = bodyLines.join("\n").trim();

  // Bloque completo: frontmatter + cuerpo
  const fullBlockLines = lines.slice(last.startIdx, bodyEndIdx);
  const fullBlock = fullBlockLines.join("\n").trim();

  return {
    agent: agent.toLowerCase(),
    slug: slug.toLowerCase(),
    date: date || "unknown",
    category: category || "unknown",
    tags,
    fullBlock,
    body,
  };
}

function extractYamlValue(yaml: string, key: string): string | null {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return null;
  const value = match[1].trim();
  const commentIdx = value.indexOf("#");
  if (commentIdx >= 0) {
    return value.substring(0, commentIdx).trim();
  }
  return value;
}

// ── Parseo del skill ─────────────────────────────────────────────────────

/**
 * Parsea un archivo SKILL.md en sus secciones editables.
 */
function parseSkillsDoc(content: string): SkillsDoc | null {
  // Extraer frontmatter del skill (líneas entre el primer --- y ---)
  const lines = content.split("\n");

  let fmEnd = -1;
  let inFm = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      if (!inFm) {
        inFm = true;
      } else {
        fmEnd = i;
        break;
      }
    }
  }

  const frontmatter = fmEnd > 0 ? lines.slice(0, fmEnd + 1).join("\n") : "";

  // Parsear "Reglas activas"
  const reglasActivas = extractListItems(
    content,
    "## Reglas activas",
    "## Lecciones recientes"
  );

  // Parsear "Lecciones recientes"
  const leccionesRaw = extractListItems(
    content,
    "## Lecciones recientes",
    "## Promovidas a CLAUDE.md"
  );

  const leccionesRecientes = leccionesRaw
    .map((item) => {
      // Formato esperado (después de que extractListItems quita el prefijo `- `):
      // `[YYYY-MM-DD] <slug> — <resumen breve>`
      const match = item.match(
        /^\[(\d{4}-\d{2}-\d{2})\]\s+([\w-]+)\s*—\s*(.+)$/
      );
      if (match) {
        return { date: match[1], slug: match[2], summary: match[3].trim() };
      }
      return null;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  return {
    frontmatter,
    reglasActivas,
    leccionesRecientes,
    rest: "",
  };
}

function extractListItems(
  content: string,
  sectionHeader: string,
  nextSectionHeader: string
): string[] {
  const sectionRegex = new RegExp(
    `${escapeRegex(sectionHeader)}[\\s\\S]*?(?=\\n${escapeRegex(nextSectionHeader)}|\\n## |$)`,
    "i"
  );
  const match = content.match(sectionRegex);
  if (!match) return [];

  const sectionContent = match[0];
  const items: string[] = [];
  const lines = sectionContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") && !trimmed.startsWith("- *")) {
      items.push(trimmed.substring(2));
    }
  }
  return items;
}

function getRestOfDoc(content: string): string {
  const idx = content.indexOf("## Promovidas a CLAUDE.md");
  if (idx < 0) return "";
  return content.substring(idx);
}

// ── Generación del skill actualizado ─────────────────────────────────────

function generateSkillContent(doc: SkillsDoc, finalRest: string): string {
  const frontmatter = doc.frontmatter;

  // Reglas activas
  let reglasSection = "## Reglas activas (validadas \u22652 veces)\n";
  if (doc.reglasActivas.length === 0) {
    reglasSection +=
      "*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en \u22652 entradas de LEARNINGS.md, se promueve aquí.*\n";
  } else {
    for (const regla of doc.reglasActivas) {
      reglasSection += `- ${regla}\n`;
    }
  }

  // Lecciones recientes
  let leccionesSection = "## Lecciones recientes\n";
  if (doc.leccionesRecientes.length === 0) {
    leccionesSection +=
      "*Últimas 5 entradas de `.claude/LEARNINGS.md` con `agent` correspondiente. Se actualizan automáticamente al cierre de cada scope.*\n";
  } else {
    for (const lec of doc.leccionesRecientes) {
      leccionesSection += `- [${lec.date}] ${lec.slug} — ${lec.summary}\n`;
    }
  }

  return `${frontmatter}\n\n${reglasSection}\n${leccionesSection}\n${finalRest}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Funciones de utilidad ────────────────────────────────────────────────

function generateSummary(body: string): string {
  // Extrae la primera línea significativa después de **Lección**: o similar
  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("**Lección**:") ||
      trimmed.startsWith("**Leccion**:")
    ) {
      return trimmed
        .replace(/^\*\*Lecc[ió]n\*\*:\s*/i, "")
        .replace(/^\*\*Leccion\*\*:\s*/, "")
        .trim()
        .substring(0, 120);
    }
  }
  // Fallback: primeras 2 líneas del cuerpo
  const firstLines = body
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 2)
    .join(" ");
  return firstLines.substring(0, 120);
}

// ── Nivel 3: AGENTS.md Accionables Bloqueantes ────────────────────────────

/**
 * Encuentra el siguiente ID de bloqueante disponible (B1, B2, B3, ...).
 */
function getNextBlockerId(content: string): string {
  const pattern = /\|\s*B(\d+)\s*\|/g;
  let maxId = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    if (id > maxId) maxId = id;
  }
  return `B${maxId + 1}`;
}

/**
 * Agrega una entrada a la tabla "Accionables bloqueantes" en AGENTS.md.
 * Si el slug ya existe, no duplica (idempotente).
 *
 * @returns true si se modificó el archivo, false si no
 */
function addToAgentsBlockingActionables(
  slug: string,
  agent: string,
  summary: string,
  agentsPath: string,
  dryRun: boolean
): boolean {
  if (!existsSync(agentsPath)) {
    console.log(
      `[extract-learnings] AGENTS.md not found at ${agentsPath} — cannot promote to level 3`
    );
    return false;
  }

  const content = readFileSync(agentsPath, "utf-8");

  // Verificar idempotencia: slug ya está en la tabla
  if (content.includes(slug)) {
    console.log(
      `[extract-learnings] Slug "${slug}" already in AGENTS.md Accionables bloqueantes — nothing to do`
    );
    return false;
  }

  const nextId = getNextBlockerId(content);

  // Construir la nueva fila de la tabla
  const newRow = `| ${nextId} | ${agent} | slug \`${slug}\` repetido 3+ veces | ${summary} |`;

  // Reemplazar la fila "(vacío...)" si existe, o insertar antes de ella
  let newContent: string;
  if (content.includes("*(vacío")) {
    // Hay una fila vacía: reemplazar primero con la nueva fila, luego agregar nueva fila vacía
    // O simplemente insertar antes de la fila vacía
    newContent = content.replace(
      /(\|\s*\*\(vacío[^)]*\)[^|]*\|\s*\|)/,
      `${newRow}\n$1`
    );
  } else {
    // No hay fila vacía: insertar después del header de la tabla
    newContent = content.replace(
      /(\|\s*ID\s*\|[\s\S]*?\n)(\n|---)/,
      `$1${newRow}\n$2`
    );
  }

  if (dryRun) {
    console.log(
      `[extract-learnings] DRY RUN — would add to AGENTS.md: ${nextId} | ${agent} | ${slug}`
    );
    return true;
  }

  writeFileSync(agentsPath, newContent);
  console.log(
    `[extract-learnings] ✅ Added ${nextId} to AGENTS.md Accionables bloqueantes (level 3): ${slug}`
  );
  return true;
}

// ── Lógica principal (extraída para testeabilidad) ────────────────────────

/**
 * Procesa la última entrada de LEARNINGS.md y aplica el nivel de promoción
 * correspondiente. Si se llama desde CLI, usa los paths por defecto.
 *
 * @param options - Paths y configuración (inyectables para testing)
 */
export function extractAndPromote(options: ExtractOptions = {}): void {
  const learningsPath = options.learningsPath ?? LEARNINGS_PATH;
  const skillsDir = options.skillsDir ?? SKILLS_DIR;
  const agentsPath = options.agentsPath ?? AGENTS_PATH;
  const maxRecent = options.maxRecent ?? MAX_RECENT;
  const dryRun = options.dryRun ?? DRY_RUN;

  // 1. Leer LEARNINGS.md
  if (!existsSync(learningsPath)) {
    console.error(
      `[extract-learnings] LEARNINGS.md not found at ${learningsPath}`
    );
    process.exit(1);
  }

  const learningsContent = readFileSync(learningsPath, "utf-8");

  // 2. Parsear última entrada
  const entry = parseLastEntry(learningsContent);
  if (!entry) {
    console.log("[extract-learnings] No structured entry found in LEARNINGS.md");
    return;
  }

  console.log(
    `[extract-learnings] Last entry: agent=${entry.agent} slug=${entry.slug} date=${entry.date}`
  );

  // 3. Verificar si el agente tiene un skill de learnings
  if (!VALID_AGENTS.has(entry.agent)) {
    console.log(
      `[extract-learnings] Agent "${entry.agent}" has no learnings skill — skipping`
    );
    return;
  }

  const skillDir = resolve(skillsDir, `${entry.agent}-learnings`);
  const skillFile = resolve(skillDir, "SKILL.md");

  if (!existsSync(skillFile)) {
    console.log(
      `[extract-learnings] Skill file ${skillFile} does not exist — skipping`
    );
    return;
  }

  // 4. Leer y parsear skill actual
  const skillContent = readFileSync(skillFile, "utf-8");
  const doc = parseSkillsDoc(skillContent);
  if (!doc) {
    console.error(
      `[extract-learnings] Could not parse skill file ${skillFile}`
    );
    process.exit(1);
  }

  const rest = getRestOfDoc(skillContent);

  // 5. Determinar nivel de promoción
  const existingInLecciones = doc.leccionesRecientes.findIndex(
    (l) => l.slug === entry.slug
  );

  if (existingInLecciones >= 0) {
    // ── Nivel 2: slug ya está en Lecciones recientes → promover a Reglas activas ──
    console.log(
      `[extract-learnings] Slug "${entry.slug}" already in Lecciones recientes — promoting to Reglas activas (level 2)`
    );

    const promoted = doc.leccionesRecientes[existingInLecciones];
    const reglaText = `**${promoted.slug}** (x2, ${promoted.date}) — ${promoted.summary}`;

    if (!doc.reglasActivas.some((r) => r.includes(promoted.slug))) {
      doc.reglasActivas.push(reglaText);
      console.log(`  → Added to Reglas activas: ${promoted.slug}`);
    }

    // Remover de lecciones recientes (queda promovido)
    doc.leccionesRecientes.splice(existingInLecciones, 1);
    console.log(`  → Removed from Lecciones recientes (promoted to level 2)`);
  } else if (doc.reglasActivas.some((r) => r.includes(entry.slug))) {
    // Slug ya está en Reglas activas — verificar si fue por nivel 2 (tiene marcador x2)
    const reglaIdx = doc.reglasActivas.findIndex((r) =>
      r.includes(entry.slug)
    );
    const reglaText = doc.reglasActivas[reglaIdx];

    if (reglaText.includes("(x2,")) {
      // ── Nivel 3: slug tiene marcador x2 → promover a AGENTS.md ──
      console.log(
        `[extract-learnings] Slug "${entry.slug}" has (x2,) marker — promoting to AGENTS.md Accionables bloqueantes (level 3)`
      );

      // Remover de Reglas activas (queda promovido a nivel 3)
      doc.reglasActivas.splice(reglaIdx, 1);
      console.log(`  → Removed from Reglas activas (promoted to level 3)`);

      // Generar summary desde la regla promovida o desde la entrada actual
      const summary = generateSummary(entry.body);

      // Agregar a AGENTS.md
      addToAgentsBlockingActionables(
        entry.slug,
        entry.agent,
        summary,
        agentsPath,
        dryRun
      );
    } else {
      // Regla insertada manualmente (sin x2) — no promocionar
      console.log(
        `[extract-learnings] Slug "${entry.slug}" in Reglas activas without (x2,) marker — skipping (manually added)`
      );
      return;
    }
  } else {
    // ── Nivel 1: primera ocurrencia → agregar a Lecciones recientes ──
    const summary = generateSummary(entry.body);
    doc.leccionesRecientes.unshift({
      date: entry.date,
      slug: entry.slug,
      summary,
    });

    // Mantener máximo
    if (doc.leccionesRecientes.length > maxRecent) {
      const removed = doc.leccionesRecientes.splice(
        maxRecent,
        doc.leccionesRecientes.length - maxRecent
      );
      console.log(
        `  → Trimmed ${removed.length} old entries from Lecciones recientes`
      );
    }

    console.log(
      `[extract-learnings] Added "${entry.slug}" to Lecciones recientes (level 1) (${doc.leccionesRecientes.length}/${maxRecent})`
    );
  }

  // 6. Generar nuevo contenido del skill
  const newContent = generateSkillContent(doc, rest);

  if (dryRun) {
    console.log(
      "\n[extract-learnings] DRY RUN — would write the following skill content:\n"
    );
    console.log(newContent);
    return;
  }

  // 7. Escribir skill actualizado
  writeFileSync(skillFile, newContent);
  console.log(
    `[extract-learnings] ✅ Updated ${skillFile}`
  );
}

// ── CLI entry point ──────────────────────────────────────────────────────

function main(): void {
  extractAndPromote();
}

// Guard de ejecución: solo ejecutar main cuando se invoca directamente
// tsx runs scripts under CommonJS; require.main === module is true when invoked directly
if (require.main === module) {
  main();
}
