import type { Character, LorebookEntry } from "../types";
import { DEFAULT_STATS } from "../types";
import { newId } from "../utils/id";
import { readPngTextChunk, readPngTextChunks } from "../utils/pngChunks";
import { APP_VERSION } from "../appInfo";
import {
  cleanCardField,
  cleanLooseText,
  distributeBlocks,
  joinParts,
  joinUniqueLines,
  normalizeKey,
  shortName,
  splitExampleDialogue,
  type BracketBlock,
} from "./cardText";

/**
 * Character Card — открытый формат карточек персонажей, который понимают
 * SillyTavern, Risu, Chub, JanitorAI и другие ролевые клиенты.
 *
 * Поддерживаем три поколения:
 *  - **V3** (`spec: "chara_card_v3"`) — данные в `data`, картинки в `assets`;
 *  - **V2** (`spec: "chara_card_v2"`) — данные в `data`, лорбук в `character_book`;
 *  - **V1** — исторический плоский формат: поля лежат в корне JSON.
 *
 * Модуль намеренно чистый: никакого DOM и IndexedDB, только преобразование
 * данных. Поэтому его легко проверить тестами, а файловые операции (чтение
 * `File`, canvas для PNG) живут в `utils/characterCardFile.ts`.
 */

export type CardSpec = "v1" | "v2" | "v3";

/** Ключевые слова PNG-чанков, в которых хранится JSON карточки. */
const CARD_CHUNK_KEYWORDS = ["ccv3", "chara"];

/**
 * Признаки карточки. Список подобран так, чтобы не спутать карточку с плоским
 * экспортом самого NOCTURNE: у того поля в camelCase (`firstMessage`),
 * а в карточках — в snake_case (`first_mes`).
 */
const CARD_MARKER_KEYS = [
  "spec",
  "spec_version",
  "data",
  "first_mes",
  "mes_example",
  "creator_notes",
  "character_book",
  "alternate_greetings",
  "post_history_instructions",
  "creator",
];

const SPEC_LABELS: Record<CardSpec, string> = {
  v1: "V1",
  v2: "V2",
  v3: "V3",
};

/** Заголовки секций, которыми карточка дополняет системный промпт. */
const EXAMPLE_HEADER = "### ПРИМЕРЫ РЕПЛИК ИЗ КАРТОЧКИ";
const HISTORY_HEADER = "### ИНСТРУКЦИИ ПОСЛЕ ИСТОРИИ";
const NOTES_HEADER = "### ЗАМЕТКИ АВТОРА КАРТОЧКИ";

/** До какой длины обрезаем подпись (tagline), взятую из заметок автора. */
const TAGLINE_LIMIT = 160;

export interface CardBookEntry {
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  name?: string;
  comment?: string;
  insertionOrder: number;
  priority?: number;
}

/** Карточка, приведённая к общему виду — дальше разницы между версиями нет. */
export interface NormalizedCard {
  spec: CardSpec;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  alternateGreetings: string[];
  systemPrompt: string;
  exampleMessages: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  creator?: string;
  characterVersion?: string;
  tags: string[];
  /** Мир/сеттинг карточки (`extensions.world`) — им заполняем жанр. */
  world?: string;
  /** Возраст, если он был блоком `[Age: …]`. */
  age?: string;
  book: CardBookEntry[];
  /** Ссылка на иконку из `assets` (V3) — по возможности становится аватаром. */
  iconUri?: string;
}

export interface CardOrigin {
  spec: CardSpec;
  creator?: string;
}

/** Что показываем в окне импорта, чтобы игрок понял, что за файл открыл. */
export interface CardPreviewInfo {
  spec: CardSpec;
  /** Готовая подпись: «Character Card V2». */
  label: string;
  creator?: string;
  tags: string[];
  alternateGreetings: number;
  /** Карточку достали из PNG (значит, её обложка стала аватаром). */
  fromPng: boolean;
  /** Отчёт чистки: пусто, если игрок выключил очистку текста. */
  clean?: CardCleanReport;
}

export function describeCard(
  card: NormalizedCard,
  { fromPng = false }: { fromPng?: boolean } = {}
): CardPreviewInfo {
  return {
    spec: card.spec,
    label: `Character Card ${SPEC_LABELS[card.spec]}`,
    creator: card.creator,
    tags: card.tags,
    alternateGreetings: card.alternateGreetings.length,
    fromPng,
  };
}

// -------------------- Мелкие помощники --------------------

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }

  return out;
}

function uniqueKeys(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const group of groups) {
    for (const key of group) {
      const text = key.trim();
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      out.push(text);
    }
  }

  return out;
}

/** base64 → UTF-8. `atob` есть и в браузере, и в Node 18+. */
function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder("utf-8").decode(bytes);
}

/** UTF-8 → base64. Побитово, чтобы не упереться в лимит аргументов `btoa`. */
export function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

/**
 * Дополняет системный промпт секциями из карточки.
 *
 * Повторный импорт не должен раздувать промпт: если заголовок уже есть,
 * секция не добавляется второй раз.
 */
function foldSections(
  base: string,
  sections: { header: string; body: string }[]
): string {
  let result = base.trim();

  for (const { header, body } of sections) {
    const text = body.trim();
    if (!text) continue;
    if (result.includes(header)) continue;
    result = result ? `${result}\n\n${header}\n${text}` : `${header}\n${text}`;
  }

  return result;
}

/** Первая строка заметок автора — готовая подпись для карточки в библиотеке. */
function toTagline(notes: string): string {
  const firstLine = notes.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (firstLine.length <= TAGLINE_LIMIT) return firstLine;
  return `${firstLine.slice(0, TAGLINE_LIMIT).trimEnd()}…`;
}

// -------------------- Распознавание --------------------

/** Похоже ли содержимое файла на карточку Character Card (любой версии). */
export function looksLikeCharacterCard(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  return CARD_MARKER_KEYS.some((key) => key in record);
}

function detectSpec(raw: Record<string, unknown>): CardSpec {
  const spec = str(raw.spec).toLowerCase();
  const version = str(raw.spec_version);

  if (spec === "chara_card_v3" || version.startsWith("3")) return "v3";
  if (spec === "chara_card_v2" || version.startsWith("2")) return "v2";
  if (spec === "chara_card_v1" || version.startsWith("1")) return "v1";

  // Обёртка `data` появилась во второй версии; без неё — исторический формат.
  return raw.data && typeof raw.data === "object" ? "v2" : "v1";
}

function parseBook(raw: unknown): CardBookEntry[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries)
      ? ((raw as { entries: unknown[] }).entries)
      : [];

  return source
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => ({
      keys: strArray(item.keys),
      secondaryKeys: strArray(item.secondary_keys),
      content: str(item.content),
      enabled: item.enabled !== false,
      name: str(item.name) || undefined,
      comment: str(item.comment) || undefined,
      insertionOrder:
        typeof item.insertion_order === "number" ? item.insertion_order : index,
      priority: typeof item.priority === "number" ? item.priority : undefined,
    }))
    .filter((entry) => entry.content.length > 0);
}

/** V3 хранит картинки в `assets`; берём первую подходящую как аватар. */
function parseIconAsset(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    const type = str(record.type).toLowerCase();
    if (type && type !== "icon" && type !== "user_icon") continue;

    const uri = str(record.uri);
    // "ccdefault:" — ссылка на картинку по умолчанию внутри чужого клиента.
    if (!uri || uri.startsWith("ccdefault:")) continue;
    if (uri.startsWith("data:image/") || uri.startsWith("http")) return uri;
  }

  return undefined;
}

/** Что именно чистка выбросила или переложила — показываем игроку. */
export interface CardCleanReport {
  /** Сколько ссылок на картинки убрано из текста. */
  images: number;
  /** Сколько плейсхолдеров `{{user}}` / `{{char}}` заменено. */
  placeholders: number;
  /** Сколько блоков `[Ключ: значение]` разобрано по полям. */
  blocks: number;
  /** Сколько служебных абзацев (changelog, реклама) выброшено. */
  noise: number;
  /** Аватар взят из первой картинки в тексте карточки. */
  avatarFromText: boolean;
}

/**
 * Приводит текст карточки к виду, с которым можно играть.
 *
 * Многие карточки (Chub, Wyvern) складывают лист персонажа блоками
 * `[Personality: …]` в одно поле, а в системный промпт уносят changelog автора
 * и рекламу. Здесь это разбирается по полкам, а мусор выбрасывается.
 */
export function cleanCard(
  card: NormalizedCard,
  options: { userName?: string } = {}
): { card: NormalizedCard; report: CardCleanReport } {
  const report: CardCleanReport = {
    images: 0,
    placeholders: 0,
    blocks: 0,
    noise: 0,
    avatarFromText: false,
  };

  const images: string[] = [];
  const blocks: BracketBlock[] = [];

  const clean = (source: string): string => {
    const result = cleanCardField(source, {
      userName: options.userName,
      // В тексте карточки персонажа зовут коротко: «Rosalia», а не полностью.
      charName: shortName(card.name),
    });

    images.push(...result.images);
    blocks.push(...result.blocks);
    report.placeholders += result.placeholders;
    report.noise += result.noise;

    return result.text;
  };

  // Примеры диалога в системном промпте — не правила: переезжают в примеры.
  const { rules, examples } = splitExampleDialogue(card.systemPrompt);

  // Все поля чистим до сборки результата: картинки из текста могут стать
  // аватаром, поэтому список ссылок должен быть полон к моменту выбора.
  const systemPrompt = clean(rules);
  const examplesFromPrompt = clean(examples);
  const description = clean(card.description);
  const personality = clean(card.personality);
  const scenario = clean(card.scenario);
  const firstMessage = clean(card.firstMessage);
  const alternateGreetings = card.alternateGreetings.map(clean).filter(Boolean);
  const exampleMessages = joinUniqueLines([clean(card.exampleMessages), examplesFromPrompt]);
  const postHistoryInstructions = clean(card.postHistoryInstructions);
  const creatorNotes = clean(card.creatorNotes);

  // Блок [Name: …] не нужен, если он просто повторяет имя из самой карточки.
  const uniqueBlocks = blocks.filter(
    (block) =>
      !(
        normalizeKey(block.key) === "name" &&
        block.value.trim() === card.name.trim()
      )
  );

  const distributed = distributeBlocks(uniqueBlocks);
  report.blocks = blocks.length;
  report.images = images.length;

  const book = card.book.map((entry) => {
    // В лорбуке только снимаем разметку: блоки [Ключ: значение] там — часть
    // записи, а не лист персонажа, и перекладывать их в описание нельзя.
    const loose = cleanLooseText(entry.content, {
      userName: options.userName,
      charName: card.name,
    });

    report.placeholders += loose.placeholders;
    images.push(...loose.images);

    return { ...entry, content: loose.text };
  });

  const tags: string[] = [];
  for (const tag of [...card.tags, ...distributed.tags]) {
    if (!tags.includes(tag)) tags.push(tag);
  }

  let iconUri = card.iconUri;
  if (!iconUri && images.length > 0) {
    // Картинка из текста — чаще всего портрет героя: пусть станет аватаром.
    iconUri = images[0];
    report.avatarFromText = true;
  }

  return {
    card: {
      ...card,
      description: joinParts([description, ...distributed.description, ...distributed.unknown]),
      personality: joinParts([personality, ...distributed.personality]),
      scenario: joinParts([scenario, ...distributed.scenario]),
      systemPrompt,
      exampleMessages,
      postHistoryInstructions,
      creatorNotes,
      firstMessage,
      alternateGreetings,
      tags,
      world: card.world ?? distributed.genre,
      age: card.age ?? distributed.age,
      book,
      iconUri,
    },
    report,
  };
}

/** Приводит распарсенный JSON карточки любой версии к общему виду. */
export function normalizeCard(raw: unknown): NormalizedCard {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Карточка заполнена некорректно: ожидался JSON-объект.");
  }

  const record = raw as Record<string, unknown>;
  const spec = detectSpec(record);
  const data = (
    spec !== "v1" && record.data && typeof record.data === "object"
      ? record.data
      : record
  ) as Record<string, unknown>;

  const name = str(data.name) || str(data.nickname);
  if (!name) {
    throw new Error("В карточке не указано имя персонажа.");
  }

  return {
    spec,
    name,
    description: str(data.description),
    personality: str(data.personality),
    scenario: str(data.scenario),
    firstMessage: str(data.first_mes),
    alternateGreetings: strArray(data.alternate_greetings),
    systemPrompt: str(data.system_prompt),
    exampleMessages: str(data.mes_example),
    postHistoryInstructions: str(data.post_history_instructions),
    creatorNotes: str(data.creator_notes),
    creator: str(data.creator) || undefined,
    characterVersion: str(data.character_version) || undefined,
    tags: strArray(data.tags),
    world: (() => {
      const extensions = data.extensions;
      const world =
        extensions && typeof extensions === "object"
          ? (extensions as Record<string, unknown>).world
          : undefined;
      return str(world) || undefined;
    })(),
    book: parseBook(data.character_book),
    iconUri: parseIconAsset(data.assets),
    age: undefined,
  };
}

/** Разбирает текст JSON карточки, бросает понятные пользователю ошибки. */
export function parseCardJson(text: string): NormalizedCard {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Файл карточки не является корректным JSON.");
  }

  return normalizeCard(raw);
}

// -------------------- Карточка → персонаж --------------------

/** Подпись происхождения: видно в карточке персонажа в библиотеке. */
export function formatCardOrigin(card: CardOrigin): string {
  const label = `Импорт · Character Card ${SPEC_LABELS[card.spec]}`;
  return card.creator ? `${label} · ${card.creator}` : label;
}

/**
 * Превращает карточку в персонажа NOCTURNE.
 *
 * Что важно: альтернативные приветствия не теряются — они ложатся в
 * `alternateGreetings` и становятся свайпами первого сообщения ветки.
 */
export function cardToCharacter(
  card: NormalizedCard,
  options: { avatarUrl?: string; now?: number } = {}
): Character {
  const greetings = uniqueKeys(
    [card.firstMessage],
    card.alternateGreetings
  );

  const systemPrompt = foldSections(card.systemPrompt, [
    { header: EXAMPLE_HEADER, body: card.exampleMessages },
    { header: HISTORY_HEADER, body: card.postHistoryInstructions },
    // Заметки автора дублируем полностью, только если они не влезли в подпись.
    {
      header: NOTES_HEADER,
      body: card.creatorNotes.length > TAGLINE_LIMIT ? card.creatorNotes : "",
    },
  ]);

  const lorebook: LorebookEntry[] = card.book.map((entry) => {
    const keys = uniqueKeys(entry.keys, entry.secondaryKeys);

    return {
      id: newId(),
      keys: keys.length > 0 ? keys : [entry.name?.trim() || "знание"],
      content: entry.content,
      isActive: entry.enabled,
    };
  });

  return {
    id: newId(),
    name: card.name,
    // Явный аватар (обложка PNG) главнее; иначе берём иконку из самой карточки.
    avatarUrl: options.avatarUrl ?? card.iconUri ?? "",
    tagline: toTagline(card.creatorNotes),
    genre: card.world,
    age: card.age,
    tags: card.tags,
    isFavorite: false,
    isPinned: false,
    originTag: formatCardOrigin(card),
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    systemPrompt,
    firstMessage: greetings[0] ?? "*Смотрит на тебя в тишине...*",
    alternateGreetings: greetings.slice(1),
    initialStats: { ...DEFAULT_STATS, customStats: {} },
    lorebook,
    createdAt: options.now ?? Date.now(),
  };
}

// -------------------- Персонаж → карточка --------------------

function buildCharacterBook(character: Character) {
  const entries = (character.lorebook ?? []).map((entry, index) => {
    const keys = entry.keys.filter((key) => key.trim().length > 0);

    return {
      id: index,
      keys: keys.length > 0 ? keys : ["знание"],
      secondary_keys: [] as string[],
      comment: keys[0] ?? "",
      content: entry.content,
      enabled: entry.isActive !== false,
      insertion_order: index,
      name: keys[0] ?? `Запись ${index + 1}`,
      priority: 10,
      selective: false,
      constant: false,
      position: "before_char",
      extensions: {},
    };
  });

  return {
    entries,
    name: `${character.name || "Персонаж"} — мир`,
    description: "",
    scan_depth: 3,
    token_budget: 1024,
    recursive_scanning: false,
    extensions: {},
  };
}

/**
 * Собирает карточку версии V2 — самый совместимый вариант: его принимают
 * SillyTavern, Risu, Chub и JanitorAI.
 *
 * `now` передаётся отдельно, чтобы результат был детерминированным в тестах.
 */
export function characterToCardV2(
  character: Character,
  { now = Date.now() }: { now?: number } = {}
): Record<string, unknown> {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: character.name,
      description: character.description ?? "",
      personality: character.personality ?? "",
      scenario: character.scenario ?? "",
      first_mes: character.firstMessage,
      mes_example: "",
      creator_notes: character.tagline ?? "",
      system_prompt: character.systemPrompt ?? "",
      post_history_instructions: "",
      alternate_greetings: character.alternateGreetings ?? [],
      character_book: buildCharacterBook(character),
      tags: character.tags ?? [],
      creator: "NOCTURNE",
      character_version: "",
      extensions: {
        world: character.genre ?? "",
        source: "NOCTURNE",
        nocturne: {
          app: "NOCTURNE",
          appVersion: APP_VERSION,
          exportedAt: now,
        },
      },
    },
  };
}

export function characterToCardJson(
  character: Character,
  options?: { now?: number }
): string {
  return JSON.stringify(characterToCardV2(character, options), null, 2);
}

// -------------------- PNG --------------------

/**
 * Достаёт текст карточки из PNG: сначала чанк `ccv3` (V3), затем `chara` (V2).
 *
 * Содержимое чанка бывает и обычным JSON, и base64 — пробуем оба варианта.
 * Если знакомых чанков нет, перебираем остальные текстовые: часть генераторов
 * пишет карточку под своими ключевыми словами.
 */
export function extractCardTextFromPng(bytes: Uint8Array): string | null {
  const decode = (raw: string | null): string | null => {
    const trimmed = raw?.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("{")) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        // Похоже на JSON, но битый — пробуем расшифровать как base64.
      }
    }

    try {
      const decoded = decodeBase64Utf8(trimmed).trim();
      if (!decoded.startsWith("{")) return null;
      JSON.parse(decoded);
      return decoded;
    } catch {
      return null;
    }
  };

  for (const keyword of CARD_CHUNK_KEYWORDS) {
    const decoded = decode(readPngTextChunk(bytes, keyword));
    if (decoded) return decoded;
  }

  for (const chunk of readPngTextChunks(bytes)) {
    const decoded = decode(chunk.text);
    if (decoded) return decoded;
  }

  return null;
}
