import type { RelationshipStats } from "../types";
import { DEFAULT_STATS } from "../types";

export interface ParsedResponse {
  text: string;
  innerThought?: string;
  feelingHint?: string;
  stats?: RelationshipStats;
  /**
   * Кого модель вернула в сцену (мета-поле `returned`): персонажи,
   * ушедшие за кадр, могут возвращаться сами по ходу истории.
   */
  returnedNames?: string[];
  /**
   * Кто ушёл из сцены по ходу истории (мета-поле `left`): герой может уйти
   * сам, и чат уберёт его за кадр до подходящего момента возвращения.
   */
  left?: { name: string; reason?: string }[];
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
\`\`\`

Необязательное поле "returned": ["Имя"] — кого из персонажей за кадром этот ответ вернул в сцену (нужно только в групповых сценах, когда кто-то был в отлучке).
Необязательное поле "left": {"Имя": "короткая причина"} — кто ушёл из сцены по ходу этого ответа (ушёл по делам, вышел, уехал). Не отправляй героев за кадр без причины и не уводи всех сразу.`;

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
const META_KEYS = [
  "innerThought",
  "inner_thought",
  "feelingHint",
  "feeling_hint",
  "stats",
  "returned",
  "returnedNames",
  "returned_names",
  "вернулся",
  "left",
  "leftNames",
  "left_names",
  "ушли",
];

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

/**
 * Приводит мета-поле `returned` к списку имён: принимает строку, массив
 * строк или массив объектов с полем name.
 */
export function parseReturnedNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const names: string[] = [];

  for (const item of list) {
    const raw =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
        ? (item as Record<string, unknown>).name
        : undefined;

    if (typeof raw !== "string") continue;

    // Модель может перечислить всех в одной строке: «Мира, Кай».
    for (const part of raw.split(/[,;]/)) {
      const name = part.trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }

  return names;
}

/**
 * Приводит мета-поле `left` к списку «кто ушёл и почему». Принимает словарь
 * `{"Имя": "причина"}`, строку, список имён или список объектов с name/reason.
 */
export function parseLeftScene(value: unknown): { name: string; reason?: string }[] {
  const entries: { name: string; reason?: string }[] = [];

  const push = (name: unknown, reason?: unknown) => {
    if (typeof name !== "string") return;

    for (const part of name.split(/[,;]/)) {
      const clean = part.trim();
      if (!clean || entries.some((item) => item.name === clean)) continue;
      const cleanReason =
        typeof reason === "string" && reason.trim()
          ? reason.trim().slice(0, 120)
          : undefined;
      entries.push(cleanReason ? { name: clean, reason: cleanReason } : { name: clean });
    }
  };

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [name, reason] of Object.entries(value as Record<string, unknown>)) {
      push(name, reason);
    }
    return entries;
  }

  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];

  for (const item of list) {
    if (typeof item === "string") push(item);
    else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      push(record.name ?? record.character ?? record["имя"], record.reason ?? record.why);
    }
  }

  return entries;
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

  // Локальный стандарт: <returned names="Ая, Рин" />
  const returnedMatch = raw.match(/<returned\s+[^>]*?names?\s*=\s*["']([^"']+)["'][^>]*>/i);
  let returnedNames = returnedMatch ? parseReturnedNames(returnedMatch[1]) : [];

  if (returnedMatch) {
    text = text.replace(/<returned\s+[^>]*?>/i, "");
  }

  // Локальный стандарт: <left names="Ая" reason="ушла в магазин" />
  const leftMatch = raw.match(
    /<left\s+[^>]*?names?\s*=\s*["']([^"']+)["'][^>]*?(?:reason\s*=\s*["']([^"']*)["'][^>]*?)?\/?>/i
  );
  let left = leftMatch ? parseLeftScene({ [leftMatch[1]]: leftMatch[2] }) : [];

  if (leftMatch) {
    text = text.replace(/<left\s+[^>]*?>/i, "");
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

    const returned =
      metaJson.returned ??
      metaJson.returnedNames ??
      metaJson.returned_names ??
      metaJson["вернулся"];

    const cloudNames = parseReturnedNames(returned);
    if (cloudNames.length > 0) returnedNames = cloudNames;

    const cloudLeft =
      metaJson.left ?? metaJson.leftNames ?? metaJson.left_names ?? metaJson["ушли"];

    const cloudLeftNames = parseLeftScene(cloudLeft);
    if (cloudLeftNames.length > 0) left = cloudLeftNames;
  }

  return {
    text: text.trim(),
    innerThought,
    feelingHint,
    stats: newStats,
    returnedNames: returnedNames.length > 0 ? returnedNames : undefined,
    left: left.length > 0 ? left : undefined,
    metaWarning,
  };
}
