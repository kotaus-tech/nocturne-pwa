import type { ApiConfig } from "../types";
import { callLLM, type ChatTurn } from "./apiClient";
import { safeParseJson } from "./memoryEngine";
import { isCyrillicDominant, normalizeEscapes, tidyText } from "./cardText";
import type { NormalizedCard } from "./characterCard";

/**
 * Работа модели над импортированной карточкой.
 *
 * Идея простая: скриптовая чистка (`cardText.ts`) делает грубую, предсказуемую
 * работу и не стоит ни копейки. Модель подключается только по кнопке игрока —
 * она дорогая, зато понимает смысл, адаптирует имена и переводит без ломаного
 * машинного синтаксиса.
 *
 * Протокол обмена один для всех проходов по тексту: отдаём JSON со списком
 * `{id, text}`, получаем тот же список с новыми текстами. Отсутствующие id
 * просто не применяются — частичный ответ не ломает импорт.
 */

/** Сколько символов текста отправляем модели за один запрос. */
const BATCH_CHARS = 9_000;
/** Сколько запросов к модели держать одновременно. */
const BATCH_CONCURRENCY = 3;
/** На какие куски режем одно длинное поле. */
const CHUNK_CHARS = 3_000;
/** Поле длиннее этого считается раздутым и попадает в сжатие. */
const LONG_FIELD_CHARS = 2_500;
/** Карточка длиннее этого считается огромной — ей предлагаем сжатие. */
export const HUGE_CARD_CHARS = 12_000;
/** Модели нужно место на ответ: иначе перевод обрывается на середине. */
const REQUEST_MAX_TOKENS = 8_192;
/** Сколько раз переспрашиваем модель, если она вернула пустой ответ. */
const EMPTY_RETRY_COUNT = 3;

export type CardPassMode = "translate" | "polish" | "compress";
export type CardAiMode = CardPassMode | "repair" | "enrich" | "audit";

export interface CardAiProgress {
  mode: CardAiMode;
  current: number;
  total: number;
  /** Человеческая подпись этапа: её показывает окно импорта. */
  stage?: string;
}

export interface CardAiOptions {
  apiConfig: ApiConfig;
  signal?: AbortSignal;
  onProgress?: (progress: CardAiProgress) => void;
}

// -------------------- Поля карточки --------------------

type TextFieldKey =
  | "description"
  | "personality"
  | "scenario"
  | "systemPrompt"
  | "exampleMessages"
  | "postHistoryInstructions"
  | "creatorNotes"
  | "firstMessage";

const TEXT_FIELDS: TextFieldKey[] = [
  "description",
  "personality",
  "scenario",
  "systemPrompt",
  "exampleMessages",
  "postHistoryInstructions",
  "creatorNotes",
  "firstMessage",
];

export const FIELD_LABELS: Record<TextFieldKey, string> = {
  description: "внешность и описание",
  personality: "характер",
  scenario: "сценарий и завязка",
  systemPrompt: "системные правила",
  exampleMessages: "примеры реплик",
  postHistoryInstructions: "инструкции после истории",
  creatorNotes: "подпись",
  firstMessage: "первое сообщение",
};

/** Куда записать результат после обработки. */
type SlotTarget =
  | { kind: "field"; field: TextFieldKey }
  | { kind: "greeting"; index: number }
  | { kind: "bookContent"; index: number }
  | { kind: "bookKey"; index: number; keyIndex: number; secondary?: boolean };

interface Slot {
  id: string;
  target: SlotTarget;
  /** Куски текста (одно поле могло не влезть в один запрос). */
  parts: string[];
  /** Чем склеивать куски обратно. */
  joinWith: string;
}

function slotId(target: SlotTarget): string {
  switch (target.kind) {
    case "field":
      return target.field;
    case "greeting":
      return `greeting.${target.index}`;
    case "bookContent":
      return `book.${target.index}.content`;
    case "bookKey":
      return target.secondary
        ? `book.${target.index}.key.${target.keyIndex}.secondary`
        : `book.${target.index}.key.${target.keyIndex}`;
  }
}

/** Нарезает текст на куски: сначала по абзацам, очень длинные — по фразам. */
export function splitTextForModel(text: string, limit = CHUNK_CHARS): string[] {
  const source = text.trim();
  if (source.length <= limit) return [source];

  const paragraphs = source.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const longest = paragraphs.reduce((max, part) => Math.max(max, part.length), 0);

  if (longest <= limit) {
    // Абзацы сами по себе короткие — собираем из них пачки.
    const groups: string[] = [];
    let current = "";

    for (const paragraph of paragraphs) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (candidate.length > limit && current) {
        groups.push(current);
        current = paragraph;
      } else {
        current = candidate;
      }
    }

    if (current) groups.push(current);
    return groups;
  }

  // Один абзац не влезает: режем по фразам.
  const sentences = source.split(/(?<=[.!?…])\s+/);
  const groups: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > limit && current) {
      groups.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) groups.push(current);
  return groups;
}

function collectSlots(card: NormalizedCard): Slot[] {
  const slots: Slot[] = [];

  for (const field of TEXT_FIELDS) {
    const text = (card[field] ?? "").trim();
    if (!text) continue;

    slots.push({
      id: slotId({ kind: "field", field }),
      target: { kind: "field", field },
      parts: splitTextForModel(text),
      joinWith: "\n\n",
    });
  }

  card.alternateGreetings.forEach((text, index) => {
    if (!text.trim()) return;

    slots.push({
      id: slotId({ kind: "greeting", index }),
      target: { kind: "greeting", index },
      parts: splitTextForModel(text),
      joinWith: "\n\n",
    });
  });

  card.book.forEach((entry, index) => {
    if (entry.content.trim()) {
      slots.push({
        id: slotId({ kind: "bookContent", index }),
        target: { kind: "bookContent", index },
        parts: splitTextForModel(entry.content),
        joinWith: "\n\n",
      });
    }

    entry.keys.forEach((key, keyIndex) => {
      if (!key.trim()) return;

      slots.push({
        id: slotId({ kind: "bookKey", index, keyIndex }),
        target: { kind: "bookKey", index, keyIndex },
        parts: [key.trim()],
        joinWith: " ",
      });
    });

    entry.secondaryKeys.forEach((key, keyIndex) => {
      if (!key.trim()) return;

      slots.push({
        id: slotId({ kind: "bookKey", index, keyIndex, secondary: true }),
        target: { kind: "bookKey", index, keyIndex, secondary: true },
        parts: [key.trim()],
        joinWith: " ",
      });
    });
  });

  return slots;
}

function applySlot(card: NormalizedCard, target: SlotTarget, value: string): NormalizedCard {
  switch (target.kind) {
    case "field":
      return { ...card, [target.field]: value };

    case "greeting": {
      const greetings = [...card.alternateGreetings];
      greetings[target.index] = value;
      return { ...card, alternateGreetings: greetings.filter((item) => item.trim().length > 0) };
    }

    case "bookContent": {
      const book = [...card.book];
      book[target.index] = { ...book[target.index], content: value };
      return { ...card, book };
    }

    case "bookKey": {
      const book = [...card.book];
      const entry = { ...book[target.index] };

      if (target.secondary) {
        const secondary = [...entry.secondaryKeys];
        secondary[target.keyIndex] = value;
        entry.secondaryKeys = secondary;
      } else {
        const keys = [...entry.keys];
        keys[target.keyIndex] = value;
        entry.keys = keys;
      }

      book[target.index] = entry;
      return { ...card, book };
    }
  }
}

// -------------------- Вызов модели --------------------

/** Модели нужно место на ответ: иначе длинный перевод обрывается. */
function withCardTokens(config: ApiConfig): ApiConfig {
  return {
    ...config,
    maxTokens: Math.max(config.maxTokens ?? 0, REQUEST_MAX_TOKENS),
  };
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

/**
 * Зовём модель и требуем непустой ответ.
 *
 * Провайдеры (особенно Gemini) иногда возвращают пустой ответ на валидный
 * запрос. Для игрока это выглядит как «кнопка не работает», поэтому пустой или
 * «модель вернула пустой ответ» — повод переспросить, а не падать.
 */
async function callModelText(
  config: ApiConfig,
  system: string,
  turns: ChatTurn[],
  signal?: AbortSignal
): Promise<string> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < EMPTY_RETRY_COUNT; attempt += 1) {
    try {
      const raw = await callLLM(config, system, turns, undefined, signal);
      if (raw && raw.trim()) return raw;
    } catch (cause) {
      if (isAbortError(cause) || signal?.aborted) throw cause;
      if (cause instanceof Error && /пустой ответ/i.test(cause.message)) {
        lastError = cause;
        continue;
      }
      throw cause;
    }
  }

  throw (
    lastError ??
    new Error("Модель вернула пустой ответ. Попробуйте ещё раз или выберите другую модель.")
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

// -------------------- Протокол обмена --------------------

const TRANSLATE_SYSTEM = `Ты — профессиональный литературный переводчик карточек персонажей для ролевых игр. Переводишь с английского на русский.

ПРАВИЛА:
1. Переводи точно: без пропусков, без сокращений и без добавлений от себя.
2. Сохраняй разметку: абзацы, переносы строк, списки, «*действия в звёздочках*», прямую речь через тире (— Реплика).
3. Сохраняй характер и голос: грубость, сарказм, стёб, нежность, эротика — не смягчай, не цензурируй, не облагораживай.
4. Обращения к игроку и местоимения передавай естественно по-русски, без рабского следования оригиналу.
5. Никаких примечаний переводчика, пояснений и комментариев: только перевод.

АДАПТАЦИЯ ИМЁН И НАЗВАНИЙ (обязательно):
- Реальные имена, города и страны — общепринятая русская форма: Arthur → Артур, London → Лондон.
- Вымышленные имена, клички, названия рас, мест и миров, а также авторские термины — транслитерация, естественная для русского уха: Rosalia → Розалия, Ethralis → Этралис, Varamis → Варамис, Shadowfen → Шэдоуфен.
- Латиницу оставляй только там, где адаптировать действительно нечего.
- Ключи-триггеры (короткие метки для поиска) переведи и дай в естественных русских формах, включая падежные варианты: «Varamis, Varamis'а» → «Варамис, Варамиса».

ФОРМАТ ОТВЕТА — строго JSON, без пояснений и без обёрток:
{"items":[{"id":"как во входе","text":"перевод"}]}`;

const POLISH_SYSTEM = `Ты — редактор карточек персонажей. Тебе дают куски текста карточки, и ты убираешь из них мусор.

ЧТО УДАЛЯТЬ:
- changelog и заметки автора: «Update: …», «17/07 Update», «fixed typos», «added greeting»;
- рекламу и приглашения: Discord, Patreon, Ko-fi, Boosty, Telegram, Twitter, ссылки на скачивание лорбука;
- HTML-теги, остатки вёрстки, невидимые символы, разделители из одних тире или звёзд;
- плейсхолдеры вида {{user}}, {{char}}, <user> и подобные;
- дубли одного и того же абзаца и пустые абзацы.

ЧТО НЕ ТРОГАТЬ:
- смысл, факты, характер и стиль персонажа;
- длину текста: не сокращай содержание, если оно не мусор;
- оформление: *действия*, тире в диалогах, абзацы.

Если чистить нечего — верни текст как есть.

ФОРМАТ ОТВЕТА — строго JSON:
{"items":[{"id":"как во входе","text":"исправленный текст"}]}`;

function compressSystem(limit: number): string {
  return `Ты — редактор карточек персонажей. Тебе дают раздутый текст карточки, его нужно сжать примерно до ${limit} символов.

ПРАВИЛА:
1. Сохрани все ключевые факты: внешность, характер, речь, прошлое, цели, отношения, важные детали мира.
2. Выбрось повторы, воду, канцелярит и разжёвывание очевидного.
3. Сохрани голос персонажа и оформление: *действия в звёздочках*, тире в диалогах.
4. Не добавляй новых фактов и не придумывай продолжение.
5. Пиши по-русски, связно, без вступлений вида «вот сжатый текст».

ФОРМАТ ОТВЕТА — строго JSON:
{"items":[{"id":"как во входе","text":"сжатый текст"}]}`;
}

function systemForMode(mode: CardPassMode, limit: number): string {
  if (mode === "translate") return TRANSLATE_SYSTEM;
  if (mode === "polish") return POLISH_SYSTEM;
  return compressSystem(limit);
}

export interface ModelItem {
  id: string;
  text: string;
}

/** Разбирает ответ модели: терпим к обрывкам, лишнему тексту и пропускам. */
export function parseModelItems(raw: string): Map<string, string> {
  const result = new Map<string, string>();

  let parsed: unknown;
  try {
    parsed = safeParseJson(raw);
  } catch {
    return result;
  }

  const items: unknown =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { items?: unknown }).items
      : parsed;

  if (!Array.isArray(items)) return result;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const id = (item as { id?: unknown }).id;
    const text = (item as { text?: unknown }).text;

    if (typeof id !== "string" || typeof text !== "string") continue;
    if (!text.trim()) continue;

    result.set(id, text);
  }

  return result;
}

/** Собирает запрос к модели: список `{id, text}` в JSON. */
export function buildItemsRequest(items: ModelItem[]): string {
  return JSON.stringify({ items }, null, 2);
}

// -------------------- Проход по тексту карточки --------------------

interface Batch {
  items: ModelItem[];
  /** Номера слотов, из которых взяты куски (для сборки результата). */
  refs: { slotIndex: number; partIndex: number }[];
}

/** Раскладывает куски слотов по запросам, чтобы не превысить лимит. */
export function planBatches(slots: Slot[], limit = BATCH_CHARS): Batch[] {
  const batches: Batch[] = [];
  let current: Batch = { items: [], refs: [] };
  let size = 0;

  slots.forEach((slot, slotIndex) => {
    slot.parts.forEach((part, partIndex) => {
      const id = slot.parts.length > 1 ? `${slot.id}#${partIndex}` : slot.id;

      if (size + part.length > limit && current.items.length > 0) {
        batches.push(current);
        current = { items: [], refs: [] };
        size = 0;
      }

      current.items.push({ id, text: part });
      current.refs.push({ slotIndex, partIndex });
      size += part.length;
    });
  });

  if (current.items.length > 0) batches.push(current);
  return batches;
}

async function runBatch(
  mode: CardPassMode,
  batch: Batch,
  options: CardAiOptions,
  limit: number
): Promise<Map<string, string>> {
  const raw = await callModelText(
    withCardTokens(options.apiConfig),
    systemForMode(mode, limit),
    [{ role: "user", content: buildItemsRequest(batch.items) }],
    options.signal
  );

  return parseModelItems(raw);
}

/**
 * Один проход модели по всем текстовым полям карточки.
 *
 * Перевод, чистка и сжатие идут по одной схеме: режем на куски, отправляем
 * пачками (несколько одновременно), собираем обратно. Если модель вернула не
 * всё — остаётся исходный текст.
 */
export async function runCardPass(
  card: NormalizedCard,
  mode: CardPassMode,
  options: CardAiOptions
): Promise<{ card: NormalizedCard; changed: number }> {
  const slots = collectSlots(card).filter((slot) =>
    mode === "translate" ? slot.parts.some((part) => needsTranslation(part)) : true
  );

  if (slots.length === 0) return { card, changed: 0 };

  const batches = planBatches(slots);
  const results = new Map<string, string>();
  let done = 0;

  // Пачки независимы, поэтому пускаем их параллельно: длинная карточка
  // обрабатывается в разы быстрее, чем по очереди.
  await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batch) => {
    const parsed = await runBatch(mode, batch, options, LONG_FIELD_CHARS);

    for (const [id, text] of parsed) results.set(id, text);

    done += 1;
    options.onProgress?.({ mode, current: done, total: batches.length });
  });

  let next = card;
  let changed = 0;

  for (const slot of slots) {
    const was = tidyText(slot.parts.join(slot.joinWith));

    const parts = slot.parts.map((part, partIndex) => {
      const id = slot.parts.length > 1 ? `${slot.id}#${partIndex}` : slot.id;
      const value = results.get(id);
      return value ? normalizeEscapes(value) : part;
    });

    const value = tidyText(parts.join(slot.joinWith));
    if (!value) continue;

    // Считаем только то, что правда изменилось: модель часто возвращает
    // текст без правок, и это не должно попадать в отчёт как работа.
    if (value !== was) changed += 1;

    next = applySlot(next, slot.target, value);
  }

  return { card: next, changed };
}

/** Переводить ли этот текст: кириллический текст модель не трогаем. */
export function needsTranslation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!/[A-Za-zА-Яа-яЁё]/.test(trimmed)) return false;
  return !isCyrillicDominant(trimmed);
}

export async function translateCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<{ card: NormalizedCard; changed: number }> {
  return runCardPass(card, "translate", options);
}

export async function polishCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<{ card: NormalizedCard; changed: number }> {
  return runCardPass(card, "polish", options);
}

/** Вес карточки в символах — по нему решаем, предлагать ли сжатие. */
export function cardTextLength(card: NormalizedCard): number {
  let total = 0;

  for (const field of TEXT_FIELDS) total += (card[field] ?? "").length;
  for (const greeting of card.alternateGreetings) total += greeting.length;
  for (const entry of card.book) {
    total += entry.content.length;
    total += entry.keys.join(" ").length + entry.secondaryKeys.join(" ").length;
  }

  return total;
}

/** Стоит ли предлагать сжатие: только для действительно огромных карточек. */
export function shouldCompressCard(card: NormalizedCard): boolean {
  return cardTextLength(card) > HUGE_CARD_CHARS;
}

/** Сжимает только раздутые поля — короткие не трогаем. */
export async function compressCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<{ card: NormalizedCard; changed: number }> {
  const slots = collectSlots(card).filter((slot) =>
    slot.parts.some((part) => part.length > LONG_FIELD_CHARS)
  );

  if (slots.length === 0) return { card, changed: 0 };

  const batches = planBatches(slots);
  const results = new Map<string, string>();
  let done = 0;

  await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batch) => {
    const parsed = await runBatch("compress", batch, options, LONG_FIELD_CHARS);

    for (const [id, text] of parsed) results.set(id, text);

    done += 1;
    options.onProgress?.({ mode: "compress", current: done, total: batches.length });
  });

  let next = card;
  let changed = 0;

  for (const slot of slots) {
    const was = tidyText(slot.parts.join(slot.joinWith));

    const parts = slot.parts.map((part, partIndex) => {
      const id = slot.parts.length > 1 ? `${slot.id}#${partIndex}` : slot.id;
      const value = results.get(id);
      return value ? normalizeEscapes(value) : part;
    });

    const value = tidyText(parts.join(slot.joinWith));
    if (!value) continue;

    if (value !== was) changed += 1;

    next = applySlot(next, slot.target, value);
  }

  return { card: next, changed };
}

// -------------------- Исправление карточки --------------------

const REPAIR_SYSTEM = `Ты — редактор карточек персонажей. Тебе дают карточку, импортированную из чужого клиента. Приведи её в порядок.

ЧТО ДЕЛАТЬ:
1. Если поля перепутаны — расставь их правильно:
   - description — внешность, тело, одежда, возраст, раса;
   - personality — характер, речь, привычки, вкусы, слабости;
   - scenario — прошлое, сеттинг, цели, связи, завязка;
   - systemPrompt — технические правила для модели, а не описание персонажа;
   - exampleMessages — примеры реплик;
   - firstMessage — первая реплика персонажа.
2. Удали мусор: changelog, «Update:», рекламу, Discord и Patreon, ссылки, HTML-теги, невидимые символы, лишние обратные слэши, символы \\n, плейсхолдеры {{user}} и {{char}}, дубли и обрывки текста.
3. Если поле пустое, но факты для него есть в других полях карточки — заполни его этими фактами. НИЧЕГО НЕ ВЫДУМЫВАЙ: нет данных — оставь поле пустым.
4. Не меняй смысл, стиль и длину там, где править нечего. Не переписывай текст целиком ради перестраховки.

ФОРМАТ ОТВЕТА — строго JSON, только изменённые поля:
{"fields":{"description":"...","personality":"...","scenario":"...","systemPrompt":"...","exampleMessages":"...","firstMessage":"..."},"notes":["что исправил одной короткой фразой"]}`;

function repairUserPrompt(card: NormalizedCard): string {
  const lines = TEXT_FIELDS.map(
    (field) => `${FIELD_LABELS[field]}: ${(card[field] ?? "").trim() || "— пусто —"}`
  );

  if (card.alternateGreetings.length > 0) {
    lines.push(`альтернативные приветствия: ${card.alternateGreetings.join(" | ")}`);
  }

  return lines.join("\n\n");
}

export interface CardRepair {
  fields: Partial<Record<TextFieldKey, string>>;
  notes: string[];
}

const REPAIR_FIELDS: TextFieldKey[] = [
  "description",
  "personality",
  "scenario",
  "systemPrompt",
  "exampleMessages",
  "firstMessage",
];

export function parseRepair(raw: string): CardRepair {
  let parsed: unknown;
  try {
    parsed = safeParseJson(raw);
  } catch {
    return { fields: {}, notes: [] };
  }

  if (!parsed || typeof parsed !== "object") return { fields: {}, notes: [] };

  const record = parsed as Record<string, unknown>;
  const fields: Partial<Record<TextFieldKey, string>> = {};

  const rawFields = record.fields && typeof record.fields === "object" ? record.fields : record;

  for (const field of REPAIR_FIELDS) {
    const value = (rawFields as Record<string, unknown>)?.[field];
    if (typeof value !== "string") continue;

    const text = tidyText(normalizeEscapes(value));
    if (!text) continue;

    fields[field] = text;
  }

  const notes = Array.isArray(record.notes)
    ? record.notes
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return { fields, notes };
}

/**
 * Исправляет карточку: перепутанные поля, остатки мусора, пустые места.
 *
 * Отдельный проход нужен потому, что перепутанные поля видно только целиком:
 * по одному полю модель не поймёт, что характер записали во внешность.
 */
export async function repairCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<{ card: NormalizedCard; notes: string[] }> {
  options.onProgress?.({ mode: "repair", current: 1, total: 1, stage: "Исправляем поля" });

  const raw = await callModelText(
    withCardTokens(options.apiConfig),
    REPAIR_SYSTEM,
    [{ role: "user", content: repairUserPrompt(card) }],
    options.signal
  );

  const { fields, notes } = parseRepair(raw);
  const changed = Object.keys(fields) as TextFieldKey[];

  if (changed.length === 0) return { card, notes: [] };

  let next = card;
  for (const field of changed) {
    const value = fields[field];
    if (value) next = { ...next, [field]: value };
  }

  return {
    card: next,
    notes: notes.length > 0 ? notes : changed.map((field) => `поправлено: ${FIELD_LABELS[field]}`),
  };
}

// -------------------- Дополнение полей --------------------

export interface CardEnrichment {
  tagline?: string;
  genre?: string;
  tags?: string[];
}

const ENRICH_SYSTEM = `Ты — помощник по карточкам персонажей. Тебе дают карточку, в которой часть полей пуста. Заполни ТОЛЬКО пустые поля.

ПРАВИЛА:
1. tagline — одна короткая фраза (до 120 символов), суть персонажа. Только по фактам карточки.
2. genre — жанр и сеттинг одним-двумя словами («Тёмное фэнтези», «Киберпанк»). Только если это явно следует из карточки.
3. tags — от 3 до 6 коротких тегов по-русски: кто это, где, какой сюжет. Только по фактам карточки.
4. ГЛАВНОЕ: не выдумывай. Если данных мало — верни пустую строку или пустой массив. Лучше пусто, чем фантазия.
5. Пиши по-русски, без кавычек и пояснений.

ФОРМАТ ОТВЕТА — строго JSON:
{"tagline":"...","genre":"...","tags":["...","..."]}`;

function enrichUserPrompt(card: NormalizedCard): string {
  const parts: string[] = [
    `Имя: ${card.name}`,
    `Описание: ${card.description || "—"}`,
    `Характер: ${card.personality || "—"}`,
    `Сценарий: ${card.scenario || "—"}`,
    `Системные правила: ${card.systemPrompt || "—"}`,
    `Заметки автора: ${card.creatorNotes || "—"}`,
  ];

  if (card.tags.length > 0) parts.push(`Уже есть теги: ${card.tags.join(", ")}`);
  if (card.world) parts.push(`Уже есть мир: ${card.world}`);

  return parts.join("\n");
}

export function parseEnrichment(raw: string): CardEnrichment {
  let parsed: unknown;
  try {
    parsed = safeParseJson(raw);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object") return {};

  const record = parsed as Record<string, unknown>;
  const result: CardEnrichment = {};

  if (typeof record.tagline === "string" && record.tagline.trim()) {
    result.tagline = record.tagline.trim().slice(0, 160);
  }

  if (typeof record.genre === "string" && record.genre.trim()) {
    result.genre = record.genre.trim().slice(0, 80);
  }

  if (Array.isArray(record.tags)) {
    const tags = record.tags
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6);

    if (tags.length > 0) result.tags = tags;
  }

  return result;
}

/**
 * Дополняет пустые поля карточки.
 *
 * Модель работает только с тем, чего в карточке нет: заполненные поля
 * не переписываются, а недостающие факты не выдумываются.
 */
export async function enrichCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<{ card: NormalizedCard; filled: string[] }> {
  const filled: string[] = [];
  const needTagline = !card.creatorNotes.trim();
  const needGenre = !card.world?.trim();
  const needTags = card.tags.length < 3;

  if (!needTagline && !needGenre && !needTags) {
    return { card, filled };
  }

  options.onProgress?.({ mode: "enrich", current: 1, total: 1, stage: "Дополняем поля" });

  const raw = await callModelText(
    withCardTokens(options.apiConfig),
    ENRICH_SYSTEM,
    [{ role: "user", content: enrichUserPrompt(card) }],
    options.signal
  );

  const enrichment = parseEnrichment(raw);
  let next = card;

  if (needTagline && enrichment.tagline) {
    next = { ...next, creatorNotes: enrichment.tagline };
    filled.push("подпись");
  }

  if (needGenre && enrichment.genre) {
    next = { ...next, world: enrichment.genre };
    filled.push("жанр");
  }

  if (needTags && enrichment.tags?.length) {
    const merged = [...next.tags];
    for (const tag of enrichment.tags) {
      if (!merged.some((item) => item.toLowerCase() === tag.toLowerCase())) {
        merged.push(tag);
      }
    }
    next = { ...next, tags: merged };
    filled.push(`теги (${enrichment.tags.length})`);
  }

  return { card: next, filled };
}

// -------------------- Проверка полей --------------------

export interface CardAuditIssue {
  field: string;
  problem: string;
  suggestion: string;
}

export interface CardAudit {
  issues: CardAuditIssue[];
  /** Поля, которые пусты (считаем локально — это не требует модели). */
  emptyFields: string[];
  summary: string;
}

const AUDIT_SYSTEM = `Ты — редактор карточек персонажей. Проверь карточку и найди проблемы.

ЧТО ИСКАТЬ:
1. Перепутанные поля: во внешности лежит характер, в характере — предыстория, в сценарии — технические инструкции.
2. Остатки мусора: HTML-теги, разметка, changelog, «Update:», реклама, ссылки, Discord и Patreon, плейсхолдеры {{user}} и {{char}}, символы \\n, обрывки вёрстки.
3. Бессмыслица: незакрытые скобки, оборванные фразы, дубли абзацев, текст не на том языке.
4. Противоречия внутри карточки: возраст, пол и внешность не сходятся с описанием.

ПРАВИЛА:
- Сообщай только реальные проблемы, не придирайся к стилю.
- suggestion — короткая конкретная правка (одно предложение).
- Если проблем нет — верни пустой список issues и напиши в summary, что карточка в порядке.
- Не переписывай карточку, только находи проблемы.

ФОРМАТ ОТВЕТА — строго JSON:
{"issues":[{"field":"...","problem":"...","suggestion":"..."}],"summary":"..."}`;

const AUDIT_FIELDS: { key: TextFieldKey | "alternateGreetings" | "book"; label: string }[] = [
  { key: "description", label: "внешность и описание" },
  { key: "personality", label: "характер" },
  { key: "scenario", label: "сценарий и завязка" },
  { key: "systemPrompt", label: "системные правила" },
  { key: "exampleMessages", label: "примеры реплик" },
  { key: "firstMessage", label: "первое сообщение" },
  { key: "alternateGreetings", label: "альтернативные приветствия" },
  { key: "book", label: "лорбук" },
];

/** Пустые поля считаем сами: модели незачем тратить на это токены. */
export function findEmptyFields(card: NormalizedCard): string[] {
  const empty: string[] = [];

  for (const { key, label } of AUDIT_FIELDS) {
    if (key === "alternateGreetings") {
      if (card.alternateGreetings.length === 0) empty.push(label);
      continue;
    }

    if (key === "book") {
      if (card.book.length === 0) empty.push(label);
      continue;
    }

    if (!(card[key] ?? "").trim()) empty.push(label);
  }

  return empty;
}

function auditUserPrompt(card: NormalizedCard): string {
  const lines = AUDIT_FIELDS.map(({ key, label }) => {
    if (key === "alternateGreetings") {
      return `${label}: ${card.alternateGreetings.join(" | ") || "—"}`;
    }

    if (key === "book") {
      const entries = card.book
        .map((entry) => `[${[...entry.keys, ...entry.secondaryKeys].join(", ")}] ${entry.content}`)
        .join("\n");
      return `${label}:\n${entries || "—"}`;
    }

    return `${label}: ${(card[key] ?? "").trim() || "—"}`;
  });

  return lines.join("\n\n");
}

export function parseAudit(raw: string): { issues: CardAuditIssue[]; summary: string } {
  let parsed: unknown;
  try {
    parsed = safeParseJson(raw);
  } catch {
    return { issues: [], summary: "Модель вернула непонятный ответ — проверка не удалась." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { issues: [], summary: "Модель вернула непонятный ответ — проверка не удалась." };
  }

  const record = parsed as Record<string, unknown>;
  const issues: CardAuditIssue[] = [];

  if (Array.isArray(record.issues)) {
    for (const item of record.issues) {
      if (!item || typeof item !== "object") continue;

      const entry = item as Record<string, unknown>;
      const field = typeof entry.field === "string" ? entry.field.trim() : "";
      const problem = typeof entry.problem === "string" ? entry.problem.trim() : "";
      const suggestion = typeof entry.suggestion === "string" ? entry.suggestion.trim() : "";

      if (!problem) continue;
      issues.push({ field: field || "карточка", problem, suggestion });
    }
  }

  return {
    issues: issues.slice(0, 8),
    summary: typeof record.summary === "string" ? record.summary.trim() : "",
  };
}

/** Проверяет карточку: перепутанные поля, остатки мусора, пустые места. */
export async function auditCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<CardAudit> {
  options.onProgress?.({ mode: "audit", current: 1, total: 1, stage: "Проверяем поля" });

  let raw = "";

  try {
    raw = await callModelText(
      withCardTokens(options.apiConfig),
      AUDIT_SYSTEM,
      [{ role: "user", content: auditUserPrompt(card) }],
      options.signal
    );
  } catch (cause) {
    if (!isAbortError(cause) && !options.signal?.aborted) {
      // Проверка — дело необязательное: карточка уже импортирована и правки
      // применены. Молча падать из-за неё нельзя.
      return {
        issues: [],
        emptyFields: findEmptyFields(card),
        summary: cause instanceof Error ? cause.message : "Проверка не удалась.",
      };
    }
    throw cause;
  }

  const { issues, summary } = parseAudit(raw);

  return { issues, summary, emptyFields: findEmptyFields(card) };
}

// -------------------- Один проход «привести в порядок» --------------------

export interface FixCardResult {
  card: NormalizedCard;
  notes: string[];
  audit: CardAudit | null;
}

/**
 * Приводит карточку в порядок за одно нажатие.
 *
 * Порядок важен: снимаем мусор по тексту, потом расставляем перепутанные поля
 * и пустые места, затем дополняем метаданные и только в конце проверяем —
 * чтобы отчёт показывал то, что осталось, а не то, что мы уже исправили.
 */
export async function fixCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<FixCardResult> {
  const notes: string[] = [];
  let next = card;

  const polished = await polishCard(next, options);
  next = polished.card;
  if (polished.changed > 0) notes.push(`Модель почистила полей: ${polished.changed}.`);

  const repaired = await repairCard(next, options);
  next = repaired.card;
  notes.push(...repaired.notes);

  const enriched = await enrichCard(next, options);
  next = enriched.card;
  if (enriched.filled.length > 0) {
    notes.push(`Дополнено по фактам карточки: ${enriched.filled.join(", ")}.`);
  }

  const audit = await auditCard(next, options);

  if (notes.length === 0 && audit.issues.length === 0) {
    notes.push("Карточка уже в порядке — правок не потребовалось.");
  }

  return { card: next, notes, audit };
}
