import type { RelationshipStats } from "../types";
import { DEFAULT_STATS } from "../types";

export interface ParsedResponse {
  text: string;
  innerThought?: string;
  feelingHint?: string;
  stats?: RelationshipStats;
  /**
   * Заполняется, если мета-блок был найден, но не разобрался:
   * блок убран из текста, а шкалы остались без изменений.
   */
  metaWarning?: string;
}

/** Оригинальный мета-протокол для ОБЛАЧНЫХ API (JSON в конце) */
export const META_PROTOCOL_INSTRUCTION = `### META-ПРОТОКОЛ СИСТЕМЫ (ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ):
В самом конце ответа (после всех реплик и художественных описаний) ты ОБЯЗАН сгенерировать блок метаданных строго в формате JSON:
\`\`\`meta
{
  "innerThought": "Искренние мысли персонажа от первого лица о текущей ситуации, сказанном игроком и своих скрытых мотивах",
  "feelingHint": "Краткое описание доминирующего чувства (1-3 слова, например: «Тепло и надежда»)",
  "stats": {
    "trust": 50,
    "affection": 30,
    "closeness": 20,
    "tension": 10,
    "conflict": 0,
    "statusTitle": "Знакомство"
  }
}
\`\`\``;

// ─────────────────────────────────────────────────────────────
// Разбор ограждённых блоков (```lang ... ```)
// ─────────────────────────────────────────────────────────────

interface FencedBlock {
  start: number;
  end: number;
  lang: string;
  body: string;
}

const META_LANGUAGES = new Set(["", "meta", "json"]);
const META_KEYS = ["innerThought", "inner_thought", "feelingHint", "feeling_hint", "stats"];

/** Блоки ```...``` с точными границами: любой другой код в ответе не трогаем. */
function findFencedBlocks(source: string): FencedBlock[] {
  const positions: number[] = [];
  let index = source.indexOf("```");

  while (index !== -1) {
    positions.push(index);
    index = source.indexOf("```", index + 3);
  }

  const blocks: FencedBlock[] = [];

  // Парные ограждения: открытие + закрытие.
  for (let i = 0; i + 1 < positions.length; i += 2) {
    const start = positions[i];
    const end = positions[i + 1] + 3;
    const inner = source.slice(start + 3, positions[i + 1]);
    const space = inner.search(/\s/);

    blocks.push({
      start,
      end,
      lang: (space === -1 ? inner : inner.slice(0, space)).trim().toLowerCase(),
      body: space === -1 ? "" : inner.slice(space),
    });
  }

  // Незакрытое ограждение (обрезанный стрим): считаем его блоком до конца текста.
  if (positions.length % 2 === 1) {
    const start = positions[positions.length - 1];
    const inner = source.slice(start + 3);
    const space = inner.search(/\s/);

    blocks.push({
      start,
      end: source.length,
      lang: (space === -1 ? inner : inner.slice(0, space)).trim().toLowerCase(),
      body: space === -1 ? "" : inner.slice(space),
    });
  }

  return blocks;
}

function looksLikeMeta(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return META_KEYS.some((key) => key in record);
}

/** Правки, которые модели чаще всего допускают в JSON. */
function repairJson(source: string): string {
  let fixed = source.replace(/^\uFEFF/, "").replace(/[\u201C\u201D]/g, '"');

  // Висячие запятые: повторяем, пока строка не перестанет меняться.
  for (let i = 0; i < 4; i += 1) {
    const next = fixed.replace(/,\s*([}\]])/g, "$1");
    if (next === fixed) break;
    fixed = next;
  }

  return fixed;
}

/** Возвращает объект метаданных либо null, если это не мета-блок. */
function tryParseMeta(source: string): Record<string, unknown> | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  for (const candidate of [trimmed, repairJson(trimmed)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (looksLikeMeta(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // пробуем следующий вариант
    }
  }

  return null;
}

/** JSON без ограждения: ищем объект в самом конце ответа. */
function findTrailingMetaObject(
  source: string
): { start: number; parsed: Record<string, unknown> } | null {
  let index = source.lastIndexOf("{");
  let attempts = 0;

  while (index !== -1 && attempts < 40) {
    const candidate = source.slice(index);
    const parsed = tryParseMeta(candidate);

    if (parsed && candidate.trimEnd().endsWith("}")) {
      return { start: index, parsed };
    }

    index = source.lastIndexOf("{", index - 1);
    attempts += 1;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Шкалы
// ─────────────────────────────────────────────────────────────

type NumericStatKey = "trust" | "affection" | "closeness" | "tension" | "conflict";

const STAT_KEYS: NumericStatKey[] = [
  "trust",
  "affection",
  "closeness",
  "tension",
  "conflict",
];

function clampStat(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Приводит значение шкалы к числу: поддерживает абсолютные значения,
 * дельты ("+5"/"-3") и числа, приехавшие строкой.
 */
function coerceStat(value: unknown, current: number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampStat(value);
  }

  if (typeof value === "string") {
    const match = value.trim().match(/^([+-]?)(\d+(?:[.,]\d+)?)$/);
    if (!match) return null;

    const amount = Number(match[2].replace(",", "."));
    if (!Number.isFinite(amount)) return null;

    return clampStat(match[1] ? current + (match[1] === "-" ? -amount : amount) : amount);
  }

  return null;
}

function buildStats(
  source: Record<string, unknown>,
  base?: RelationshipStats
): RelationshipStats {
  const current = base ?? DEFAULT_STATS;
  const stats: RelationshipStats = {
    trust: current.trust,
    affection: current.affection,
    closeness: current.closeness,
    tension: current.tension,
    conflict: current.conflict,
    statusTitle: current.statusTitle,
    customStats: current.customStats || {},
  };

  for (const key of STAT_KEYS) {
    const next = coerceStat(source[key], stats[key]);
    if (next !== null) stats[key] = next;
  }

  if (typeof source.statusTitle === "string" && source.statusTitle.trim()) {
    stats.statusTitle = source.statusTitle.trim();
  }

  if (source.customStats && typeof source.customStats === "object") {
    stats.customStats = source.customStats as RelationshipStats["customStats"];
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────
// Парсер ответа
// ─────────────────────────────────────────────────────────────

/**
 * Парсер ответа модели.
 * 1. Для облачных API: извлекает ```meta { ... }``` (берётся последний валидный блок).
 * 2. Для локальных LLM: извлекает теги <thought>...</thought> и <stats .../>.
 *
 * Важно: любой другой код-блок в ответе остаётся в тексте нетронутым, а если
 * мета-блок не разобрался — шкалы не меняются молча (см. metaWarning).
 */
export function parseMetaBlock(
  raw: string,
  baseStats?: RelationshipStats
): ParsedResponse {
  if (!raw) return { text: "" };

  let innerThought: string | undefined;
  let feelingHint: string | undefined;
  let newStats: RelationshipStats | undefined;
  let metaWarning: string | undefined;

  const blocks = findFencedBlocks(raw);
  const removals: Array<{ start: number; end: number }> = [];

  // Шаг 1. Последний валидный мета-блок побеждает: ранее модель могла
  // показать в ответе какой-то ещё код, и он не должен «перекрывать» мету.
  let chosen: FencedBlock | null = null;
  let metaJson: Record<string, unknown> | null = null;

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (!META_LANGUAGES.has(block.lang)) continue;

    const parsed = tryParseMeta(block.body);
    if (parsed) {
      chosen = block;
      metaJson = parsed;
      break;
    }
  }

  // Шаг 2. Собираем к удалению остальные мета-блоки (дубли и явные ```meta).
  for (const block of blocks) {
    if (block === chosen) continue;
    if (!META_LANGUAGES.has(block.lang)) continue;

    if (tryParseMeta(block.body)) {
      removals.push(block);
      continue;
    }

    // Явная метка meta с битым содержимым: убираем, чтобы JSON не попал в реплику.
    if (block.lang === "meta") {
      removals.push(block);
      metaWarning = "Мета-блок не разобрался — шкалы остались без изменений.";
    }
  }

  if (chosen) removals.push(chosen);

  // Шаг 3. JSON без ограждения в конце ответа (модель забыла про ```).
  if (!chosen) {
    const trailing = findTrailingMetaObject(raw);
    if (trailing) {
      removals.push({ start: trailing.start, end: raw.length });
      metaJson = trailing.parsed;
    }
  }

  // Вырезаем найденное, сохраняя всё остальное как есть.
  const ordered = [...removals].sort((a, b) => a.start - b.start);
  let text = "";
  let cursor = 0;

  for (const range of ordered) {
    if (range.start < cursor) continue;
    text += raw.slice(cursor, range.start);
    cursor = range.end;
  }

  text += raw.slice(cursor);

  // ───────────────────────────────────────────────────────────
  // Локальный стандарт: <thought>, <think>, <stats .../>
  // ───────────────────────────────────────────────────────────
  const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/i);

  if (thoughtMatch) {
    innerThought = thoughtMatch[1].trim();
    text = text.replace(/<thought>[\s\S]*?<\/thought>/i, "");
  } else {
    // Рассуждения reasoning-моделей: показывать их в реплике не нужно.
    for (const tag of ["think", "thinking"]) {
      const pattern = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "gi");
      text = text.replace(pattern, "");
    }
  }

  const statsMatch = text.match(/<stats\s+([^>]+?)\/?>/i);

  if (statsMatch) {
    const attrString = statsMatch[1];
    text = text.replace(/<stats\s+[^>]+?\/?>/i, "");

    const current = baseStats ?? DEFAULT_STATS;
    const parsedAttrs: Record<string, unknown> = { customStats: current.customStats };

    for (const key of STAT_KEYS) {
      const match = attrString.match(
        new RegExp(`(?:^|\\s)${key}\\s*=\\s*["']([^"']+)["']`, "i")
      );
      if (match) parsedAttrs[key] = match[1];
    }

    const hintMatch = attrString.match(/(?:^|\s)hint\s*=\s*["']([^"']+)["']/i);
    if (hintMatch) feelingHint = hintMatch[1].trim();

    const statusMatch = attrString.match(
      /(?:^|\s)(?:status|statusTitle)\s*=\s*["']([^"']+)["']/i
    );
    if (statusMatch) parsedAttrs.statusTitle = statusMatch[1].trim();

    if (Object.keys(parsedAttrs).length > 1 || statusMatch) {
      newStats = buildStats(parsedAttrs, baseStats);
    }
  }

  // ───────────────────────────────────────────────────────────
  // Облачные метаданные перекрывают разобранные теги
  // ───────────────────────────────────────────────────────────
  if (metaJson) {
    const thought = metaJson.innerThought ?? metaJson.inner_thought;
    if (typeof thought === "string" && thought.trim()) innerThought = thought.trim();

    const hint = metaJson.feelingHint ?? metaJson.feeling_hint;
    if (typeof hint === "string" && hint.trim()) feelingHint = hint.trim();

    const stats = metaJson.stats;
    if (stats && typeof stats === "object" && !Array.isArray(stats)) {
      newStats = buildStats(stats as Record<string, unknown>, baseStats);
    }
  }

  return {
    text: text.trim(),
    innerThought,
    feelingHint,
    stats: newStats,
    metaWarning,
  };
}
