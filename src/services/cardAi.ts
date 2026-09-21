import type { ApiConfig } from "../types";
import { callLLM, type ChatTurn } from "./apiClient";
import { safeParseJson } from "./memoryEngine";
import { DEFAULT_USER_NAME, isCyrillicDominant, normalizeEscapes, tidyText } from "./cardText";
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
export type CardAiMode = CardPassMode | "repair" | "enrich";

export interface CardAiProgress {
  mode: CardAiMode;
  current: number;
  total: number;
  /** Человеческая подпись этапа: её показывает окно импорта. */
  stage?: string;
}

/**
 * Итог прохода модели по тексту карточки.
 *
 * `changed` — сколько полей действительно поменялось. `sent` и `answered` —
 * сколько кусков ушло модели и сколько вернулось пригодными. Если ушло много,
 * а вернулось ноль — модель отказалась или ответила не в том формате, и окно
 * импорта скажет об этом честно вместо «перевод не потребовался».
 */
export interface CardPassResult {
  card: NormalizedCard;
  changed: number;
  sent: number;
  answered: number;
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

  // Один абзац не влезает: режем по строкам, внутри строк — по фразам,
  // а нечитаемые стены текста без знаков препинания — по словам.
  const fragments: { text: string; sep: string }[] = [];

  for (const line of source.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const sentences = trimmedLine.split(/(?<=[.!?…])\s+/).filter(Boolean);

    sentences.forEach((sentence, sentenceIndex) => {
      // Разделитель перед фрагментом: новая строка — перенос,
      // продолжение строки — пробел, самый первый фрагмент — ничего.
      const sentenceSep =
        fragments.length === 0 ? "" : sentenceIndex === 0 ? "\n" : " ";

      if (sentence.length <= limit) {
        fragments.push({ text: sentence, sep: sentenceSep });
        return;
      }

      // Фраза длиннее лимита: рубим по границе слов.
      let rest = sentence;
      let isFirstChunk = true;

      while (rest.length > limit) {
        let cut = rest.lastIndexOf(" ", limit);
        if (cut <= 0) cut = limit;

        fragments.push({
          text: rest.slice(0, cut).trim(),
          sep: isFirstChunk ? sentenceSep : " ",
        });

        rest = rest.slice(cut).trimStart();
        isFirstChunk = false;
      }

      if (rest.trim()) {
        fragments.push({
          text: rest.trim(),
          sep: isFirstChunk ? sentenceSep : " ",
        });
      }
    });
  }

  const groups: string[] = [];
  let current = "";

  for (const { text, sep } of fragments) {
    const candidate = current ? `${current}${sep}${text}` : text;

    if (candidate.length > limit && current) {
      groups.push(current);
      current = text;
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
1. Переводи точно: без пропусков, без сокращений и без добавлений от себя. Каждый фрагмент списка переводится целиком и возвращается отдельной записью — не объединяй и не разбивай фрагменты.
2. Сохраняй разметку: абзацы, переносы строк, списки, «*действия в звёздочках*», прямую речь через тире (— Реплика).
3. Сохраняй характер и голос: грубость, сарказм, стёб, нежность, эротика — не смягчай, не цензурируй, не облагораживай.
4. Обращения к игроку и местоимения передавай естественно по-русски, без рабского следования оригиналу.
5. Никаких примечаний переводчика, пояснений и комментариев: только перевод.
6. Служебные макросы {{user}}, {{char}}, {{...}}, <user>, <char>, <START> не переводи и не меняй: переноси их в перевод как есть. Если вместо них уже стоят имена — переводи имена естественно.

АДАПТАЦИЯ ИМЁН И НАЗВАНИЙ (обязательно):
- Реальные имена, города и страны — общепринятая русская форма: Arthur → Артур, London → Лондон.
- Вымышленные имена, клички, названия рас, мест и миров, а также авторские термины — транслитерация, естественная для русского уха: Rosalia → Розалия, Ethralis → Этралис, Varamis → Варамис, Shadowfen → Шэдоуфен.
- Латиницу оставляй только там, где адаптировать действительно нечего.
- Ключи-триггеры (короткие метки для поиска) переведи и дай в естественных русских формах, включая падежные варианты: «Varamis, Varamis'а» → «Варамис, Варамиса».

ФОРМАТ ОТВЕТА — строго JSON, без пояснений и без обёрток. Для каждого входного id верни ровно одну запись с тем же id, ничего не обрезая:
{"items":[{"id":"как во входе","text":"перевод"}]}`;

/**
 * Системный промпт чистки: подставляем реальные имена, чтобы модель
 * заменяла плейсхолдеры осмысленно, а не вырезала их вместе с фразой.
 */
export function polishSystem(cardName: string, userName: string): string {
  const charLabel = cardName.trim() || "персонаж";
  const userLabel = userName.trim() || DEFAULT_USER_NAME;

  return `Ты — редактор карточек персонажей для ролевых игр. Тебе дают куски текста карточки. Убери из них мусор, не трогая содержание.

ЧТО УДАЛЯТЬ:
- записи автора и changelog: «Update: …», «17/07 Update», «fixed typos», «added greeting», номера версий;
- рекламу и приглашения: Discord, Patreon, Ko-fi, Boosty, Telegram, Twitter, ссылки на скачивание лорбука или других персонажей;
- HTML-теги и остатки вёрстки, невидимые символы, разделители из одних тире или звёзд;
- дубли абзацев и пустые абзацы.

ПЛЕЙСХОЛДЕРЫ — заменять, а не вырезать:
- {{user}}, <user>, {{user_name}} и похожие замени на имя игрока «${userLabel}» в подходящей падежной форме;
- {{char}}, <char>, {{char_name}} и похожие замени на имя персонажа «${charLabel}» в подходящей падежной форме;
- если предложение начинается с плейсхолдера, сохрани предложение целиком, просто подставив имя.

ЧТО НЕ ТРОГАТЬ:
- смысл, факты, характер и голос персонажа: грубость, стёб, нежность, эротика остаются как есть;
- длину текста: не сокращай содержание, если оно не мусор, и не дописывай от себя;
- оформление: *действия в звёздочках*, прямую речь через тире, абзацы.

Если чистить нечего — верни текст как есть, без изменений.

ФОРМАТ ОТВЕТА — строго JSON, без пояснений и без обёрток:
{"items":[{"id":"как во входе","text":"исправленный текст"}]}`;
}

/**
 * Сжатие с относительной целью: «сожми примерно на 40%».
 *
 * Абсолютный лимит на запрос здесь не работает: поле нарезано на куски,
 * и «сожми до 2500 символов» для куска в 3000 не сжимает почти ничего,
 * а для куска в 1000 — не имеет смысла. Относительная цель масштабируется
 * на любой размер и любую модель.
 */
function compressSystem(): string {
  return `Ты — редактор карточек персонажей для ролевых игр. Тебе дают раздутые куски текста карточки. Сожми каждый примерно на 40% по объёму, сохранив всё важное.

ПРАВИЛА:
1. Сохрани все ключевые факты: внешность, характер, речь, прошлое, цели, отношения, важные детали мира.
2. Выбрось повторы, воду, канцелярит и разжёвывание очевидного.
3. Сохрани голос персонажа и оформление: *действия в звёздочках*, тире в диалогах.
4. Не добавляй новых фактов и не придумывай продолжение.
5. Пиши на языке исходного текста, связно, без вступлений вида «вот сжатый текст».

ФОРМАТ ОТВЕТА — строго JSON, без пояснений и без обёрток:
{"items":[{"id":"как во входе","text":"сжатый текст"}]}`;
}

function systemForMode(
  mode: CardPassMode,
  polishNames: { cardName: string; userName: string }
): string {
  if (mode === "translate") return TRANSLATE_SYSTEM;
  if (mode === "polish") return polishSystem(polishNames.cardName, polishNames.userName);
  return compressSystem();
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
  polishNames: { cardName: string; userName: string }
): Promise<Map<string, string>> {
  const config = withCardTokens(options.apiConfig);
  const system = systemForMode(mode, polishNames);
  const turns: ChatTurn[] = [{ role: "user", content: buildItemsRequest(batch.items) }];

  const raw = await callModelText(config, system, turns, options.signal);
  let parsed = parseModelItems(raw);

  // Модель ответила не по форме (пояснения вместо JSON, отказ, другой
  // язык ответа): переспрашиваем один раз с жёстким напоминанием формата.
  if (parsed.size === 0 && batch.items.length > 0) {
    const retry = await callModelText(
      config,
      system,
      [
        ...turns,
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            'Это не тот формат. Верни строго JSON без пояснений и обёрток: {"items":[{"id":"...","text":"..."}]} — ровно по одной записи на каждый входной id.',
        },
      ],
      options.signal
    );

    parsed = parseModelItems(retry);
  }

  return parsed;
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
): Promise<CardPassResult> {
  const slots = collectSlots(card).filter((slot) =>
    mode === "translate" ? slot.parts.some((part) => needsTranslation(part)) : true
  );

  if (slots.length === 0) return { card, changed: 0, sent: 0, answered: 0 };

  const batches = planBatches(slots);
  const results = new Map<string, string>();
  let done = 0;

  const polishNames = { cardName: card.name, userName: DEFAULT_USER_NAME };

  // Пачки независимы, поэтому пускаем их параллельно: длинная карточка
  // обрабатывается в разы быстрее, чем по очереди.
  await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batch) => {
    const parsed = await runBatch(mode, batch, options, polishNames);

    for (const [id, text] of parsed) results.set(id, text);

    done += 1;
    options.onProgress?.({ mode, current: done, total: batches.length });
  });

  const sent = slots.reduce((total, slot) => total + slot.parts.length, 0);

  let next = card;
  let changed = 0;
  let answered = 0;

  for (const slot of slots) {
    const was = tidyText(slot.parts.join(slot.joinWith));

    const parts = slot.parts.map((part, partIndex) => {
      const id = slot.parts.length > 1 ? `${slot.id}#${partIndex}` : slot.id;
      const value = results.get(id);

      if (value) answered += 1;

      return value ? normalizeEscapes(value) : part;
    });

    const value = tidyText(parts.join(slot.joinWith));
    if (!value) continue;

    // Считаем только то, что правда изменилось: модель часто возвращает
    // текст без правок, и это не должно попадать в отчёт как работа.
    if (value !== was) changed += 1;

    next = applySlot(next, slot.target, value);
  }

  return { card: next, changed, sent, answered };
}

/**
 * Переводить ли этот текст: кириллический текст модель не трогаем.
 *
 * Одного сравнения «кого больше» мало: при чистке `{{user}}` заменяется на
 * имя персоны игрока, и в коротких английских полях с кучей обращений русское
 * имя перевешивает остаток английских слов — поле ошибочно выглядит русским.
 * Поэтому заметный объём латиницы (абзац английской прозы) считаем признаком
 * перевода независимо от вкраплений кириллицы.
 */
const SIGNIFICANT_LATIN_CHARS = 40;

export function needsTranslation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!/[A-Za-zА-Яа-яЁё]/.test(trimmed)) return false;

  const latin = trimmed.match(/[A-Za-z]/g)?.length ?? 0;
  if (latin >= SIGNIFICANT_LATIN_CHARS) return true;

  return !isCyrillicDominant(trimmed);
}

export async function translateCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<CardPassResult> {
  return runCardPass(card, "translate", options);
}

export async function polishCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<CardPassResult> {
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

/** Один раздутый кусок текста, который уйдёт в сжатие. */
interface CompressJob {
  id: string;
  text: string;
  target: SlotTarget;
  partIndex: number;
}

/**
 * Сжимает только раздутые куски — короткие не трогаем вовсе.
 *
 * Раньше при любом длинном куске модели отдавалось всё поле целиком,
 * и короткие части переписывались без нужды. Теперь каждый кусок
 * длиннее порога сжимается отдельно и встаёт ровно на своё место.
 */
export async function compressCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<CardPassResult> {
  const slots = collectSlots(card);
  const jobs: CompressJob[] = [];

  slots.forEach((slot) => {
    slot.parts.forEach((part, partIndex) => {
      if (part.length <= LONG_FIELD_CHARS) return;

      jobs.push({
        id: slot.parts.length > 1 ? `${slot.id}#${partIndex}` : slot.id,
        text: part,
        target: slot.target,
        partIndex,
      });
    });
  });

  if (jobs.length === 0) return { card, changed: 0, sent: 0, answered: 0 };

  // Собираем куски в запросы по лимиту символов — как обычный проход,
  // но без привязки к слотам: куски уже независимы.
  const packed: Batch[] = [];
  let current: Batch = { items: [], refs: [] };
  let size = 0;

  jobs.forEach((job, jobIndex) => {
    if (size + job.text.length > BATCH_CHARS && current.items.length > 0) {
      packed.push(current);
      current = { items: [], refs: [] };
      size = 0;
    }

    current.items.push({ id: job.id, text: job.text });
    current.refs.push({ slotIndex: jobIndex, partIndex: 0 });
    size += job.text.length;
  });

  if (current.items.length > 0) packed.push(current);

  const results = new Map<string, string>();
  let done = 0;

  await mapWithConcurrency(packed, BATCH_CONCURRENCY, async (batch) => {
    const parsed = await runBatch("compress", batch, options, {
      cardName: card.name,
      userName: DEFAULT_USER_NAME,
    });

    for (const [id, text] of parsed) results.set(id, text);

    done += 1;
    options.onProgress?.({ mode: "compress", current: done, total: packed.length });
  });

  let next = card;
  let changed = 0;
  let answered = 0;

  for (const slot of slots) {
    let touched = false;

    const parts = slot.parts.map((part, partIndex) => {
      const id = slot.parts.length > 1 ? `${slot.id}#${partIndex}` : slot.id;
      const value = results.get(id);

      if (!value) return part;

      answered += 1;
      touched = true;
      return normalizeEscapes(value);
    });

    if (!touched) continue;

    const was = tidyText(slot.parts.join(slot.joinWith));
    const value = tidyText(parts.join(slot.joinWith));
    if (!value) continue;

    if (value !== was) changed += 1;

    next = applySlot(next, slot.target, value);
  }

  return { card: next, changed, sent: jobs.length, answered };
}

// -------------------- Исправление карточки --------------------

const REPAIR_SYSTEM = `Ты — редактор карточек персонажей для ролевых игр. Тебе дают карточку, импортированную из чужого клиента. Приведи её в порядок.

НАЗНАЧЕНИЕ ПОЛЕЙ:
- description — внешность, тело, одежда, возраст, раса, манера двигаться;
- personality — характер, привычки, манера речи, вкусы, слабости, интимная сфера;
- scenario — прошлое, мир и сеттинг, цели, связи, завязка сюжета;
- systemPrompt — технические правила для модели (стиль ответов, запреты), а не описание персонажа;
- postHistoryInstructions — короткие финальные напоминания модели;
- exampleMessages — примеры реплик и диалогов;
- firstMessage — первая реплика персонажа игроку.

ПРАВИЛА:
1. Если содержимое лежит не в своём поле — перенеси его в подходящее. Текст при этом не теряй и не сокращай.
2. Удали мусор: changelog и «Update:», рекламу (Discord, Patreon, Ko-fi и т.п.), ссылки, HTML-теги, невидимые символы, лишние обратные слэши и литеральные \\n, дубли и оборванные обрывки.
3. Плейсхолдеры {{user}} и {{char}} замени на имя игрока и имя персонажа в подходящей падежной форме — не вырезай фразы вместе с ними.
4. Не дублируй один и тот же текст в несколько полей: каждый факт должен жить в одном месте.
5. Если поле пустое и фактов для него в карточке нет — оставь его пустым. НИЧЕГО НЕ ВЫДУМЫВАЙ.
6. Не переписывай то, что и так на месте: смысл, стиль и язык сохраняй.

ФОРМАТ ОТВЕТА — строго JSON, только изменённые поля, без пояснений и обёрток:
{"fields":{"description":"...","personality":"...","scenario":"...","systemPrompt":"...","postHistoryInstructions":"...","exampleMessages":"...","firstMessage":"..."},"notes":["что исправил, одной короткой фразой"]}
Если менять нечего — верни {"fields":{},"notes":[]}.`;

function repairUserPrompt(card: NormalizedCard): string {
  const lines = [
    `Имя персонажа: ${card.name}`,
    `Имя игрока: ${DEFAULT_USER_NAME}`,
    "",
    "Дальше — поля карточки. В скобках назначение поля, после двоеточия — содержимое.",
  ];

  for (const field of TEXT_FIELDS) {
    lines.push(`${field} (${FIELD_LABELS[field]}): ${(card[field] ?? "").trim() || "— пусто —"}`);
  }

  if (card.alternateGreetings.length > 0) {
    lines.push(`alternateGreetings (альтернативные приветствия): ${card.alternateGreetings.join(" | ")}`);
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
  "postHistoryInstructions",
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

    // Пустая строка — осмысленный ответ: модель перенесла содержимое в
    // правильное поле и это нужно очистить. Неопубликованное поле (нет ключа)
    // не трогаем — его здесь нет.
    fields[field] = tidyText(normalizeEscapes(value));
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

  // Ответ модели может содержать несколько полей целиком: на большой карточке
  // 8192 токенов не хватает, поэтому бюджет растёт вместе с размером карточки.
  const repairTokens = Math.max(
    REQUEST_MAX_TOKENS,
    Math.min(16_384, Math.ceil(cardTextLength(card) / 2))
  );

  const raw = await callModelText(
    { ...options.apiConfig, maxTokens: repairTokens },
    REPAIR_SYSTEM,
    [{ role: "user", content: repairUserPrompt(card) }],
    options.signal
  );

  const { fields, notes } = parseRepair(raw);
  const changed = Object.keys(fields) as TextFieldKey[];

  if (changed.length === 0) return { card, notes: [] };

  let next = card;
  for (const field of changed) {
    // Пустая строка тоже применяется: так модель очищает поле, из которого
    // содержимое уехало в правильное место.
    next = { ...next, [field]: fields[field] ?? "" };
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

// -------------------- Один проход «привести в порядок» --------------------

export interface FixCardResult {
  card: NormalizedCard;
  notes: string[];
}

/**
 * Приводит карточку в порядок за одно нажатие.
 *
 * Порядок важен: огромную карточку сначала сжимаем, потом снимаем мусор
 * по тексту, расставляем перепутанные поля и пустые места и в конце
 * дополняем метаданные.
 */
export async function fixCard(
  card: NormalizedCard,
  options: CardAiOptions
): Promise<FixCardResult> {
  const notes: string[] = [];
  let next = card;

  // Огромную карточку сначала сжимаем: чистка и исправление на раздутых
  // полях работают хуже и чаще обрываются на середине ответа.
  if (shouldCompressCard(next)) {
    const compressed = await compressCard(next, options);
    next = compressed.card;
    if (compressed.changed > 0) {
      notes.push(`Сжаты раздутые поля: ${compressed.changed}.`);
    }
  }

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

  if (notes.length === 0) {
    notes.push("Карточка уже в порядке — правок не потребовалось.");
  }

  return { card: next, notes };
}
