/**
 * Очистка текста карточек Character Card.
 *
 * Реальность такова: карточки с Chub, Wyvern и им подобных часто записывают
 * вообще всё в одно поле `description` блоками вида
 *
 *   [Name: Rosalia] [Sex: Female] [Personality: она — ледяная королева…]
 *
 * а в `system_prompt` уносят changelog автора, HTML-рекламу, ссылки на Google
 * Диск и чужие Discord. Формально поля считаны верно, но на деле игрок видит
 * мусор: в приветствии — `{{user}}` и картинка, в сценарии — `[Genre: …]`.
 *
 * Модуль приводит такой текст к виду, с которым можно играть:
 *  1. убирает HTML, сущности, zero-width и markdown-картинки;
 *  2. заменяет `{{user}}` / `{{char}}` на имя персоны и персонажа;
 *  3. вынимает блоки `[Ключ: значение]` и раскладывает их по полям персонажа;
 *  4. выбрасывает служебный шум: changelog, рекламу, ссылки на внешние сервисы;
 *  5. сворачивает лишние переводы строк.
 *
 * Всё чистые функции — без DOM и IndexedDB, поэтому проверяются тестами
 * на настоящем содержимом чужих карточек.
 */

/** Невидимые символы, которые Chub вставляет между абзацами. */
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#x2f": "/",
};

/** Имя игрока, если персону узнать не удалось. */
export const DEFAULT_USER_NAME = "игрок";

export interface BracketBlock {
  /** Ключ блока в исходном регистре: `Personality`, `Speaking Style`. */
  key: string;
  value: string;
}

export interface CleanFieldResult {
  text: string;
  /** Ссылки на картинки, найденные в тексте (удалены из него). */
  images: string[];
  /** Блоки `[Ключ: значение]`, вынутые из текста. */
  blocks: BracketBlock[];
  /** Сколько плейсхолдеров `{{user}}` / `{{char}}` заменено. */
  placeholders: number;
  /** Сколько служебных абзацев выброшено. */
  noise: number;
}

// -------------------- Разметка --------------------

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, rawCode: string) => {
    const code = rawCode.toLowerCase();
    const named = ENTITIES[code];
    if (named) return named;

    if (code.startsWith("#x")) {
      const value = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }

    if (code.startsWith("#")) {
      const value = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }

    return match;
  });
}

/**
 * Раскрывает побеги, которые приползают из JSON чужих карточек.
 *
 * Встречается постоянно: автор пишет в карточке `привет\n*действие*`, и в
 * готовом персонаже это выглядит как мусор из символов `\n` и одиноких
 * обратных слэшей. Правим до разбора на абзацы — иначе changelog и мусор не
 * отделить от нормального текста.
 */
export function normalizeEscapes(source: string): string {
  return source
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    // Одинокий обратный слэш перед переводом строки или в конце текста.
    .replace(/\\(?=\r?\n|$)/g, "");
}

/**
 * Убирает разметку, которую NOCTURNE не умеет показывать: HTML, markdown,
 * сущности и невидимые символы. Ссылки на картинки не выбрасываются бесследно —
 * они возвращаются отдельным списком.
 */
export function stripMarkup(source: string): { text: string; images: string[] } {
  const images: string[] = [];
  let text = normalizeEscapes(source);

  // Декоративные и рекламные блоки — вместе с содержимым, это не про персонажа.
  text = text.replace(
    /<(div|section|details|aside|table)\b[^>]*style\s*=\s*["'][^"']*(background|border|color)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi,
    " "
  );
  text = text.replace(/<(script|style|svg|head)[\s\S]*?<\/\1\s*>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Chub любит двойную обёртку: ![]([url](url)) — раскрываем до ![](url).
  text = text.replace(
    /\[(\s*https?:\/\/[^\s\]]+\s*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi,
    "$2"
  );

  // Картинки: в чате они всё равно не отрисуются, поэтому убираем.
  text = text.replace(/!\[[^\]]*\]\(\s*([^)]*?)\s*\)/g, (_match, url: string) => {
    const clean = url.trim();
    if (/^https?:\/\//i.test(clean)) images.push(clean);
    return " ";
  });

  // Обычные ссылки оставляем подпись, если она есть.
  text = text.replace(
    /\[([^\]]*)\]\(\s*([^)]*?)\s*\)/g,
    (_match, label: string, url: string) => (label.trim() ? label : url)
  );

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  text = text.replace(/<[^>]*>/g, " ");

  text = decodeEntities(text).replace(ZERO_WIDTH, "");

  // Разделитель примеров диалога SillyTavern.
  text = text.replace(/<\s*START\s*>/gi, " ");

  // Снятые теги оставляют цепочки пробелов.
  text = text.replace(/[^\S\n]{2,}/g, " ");

  return { text, images };
}

// -------------------- Плейсхолдеры --------------------

const USER_TOKEN = String.raw`\{\{\s*user(?:[_\s-]?name)?\s*\}\}|\{\s*user\s*\}|<\s*user\s*>|\[\[\s*user\s*\]\]`;
const CHAR_TOKEN = String.raw`\{\{\s*char(?:[_\s-]?name)?\s*\}\}|\{\s*char\s*\}|\{\{\s*character\s*\}\}|<\s*char\s*>|\[\[\s*char\s*\]\]`;

/** `{{user}}` → имя персоны, `{{char}}` → имя персонажа. */
export function replacePlaceholders(
  source: string,
  { userName = DEFAULT_USER_NAME, charName = "" }: { userName?: string; charName?: string } = {}
): { text: string; count: number } {
  let count = 0;
  let text = source;

  const substitute = (pattern: RegExp, value: string) => {
    text = text.replace(pattern, () => {
      count += 1;
      return value;
    });
  };

  // Притяжательную форму меняем отдельно, до основной замены.
  const suffix = isCyrillicDominant(source) ? "" : "'s";

  substitute(new RegExp(`(${USER_TOKEN})'s`, "gi"), `${userName}${suffix}`);
  substitute(new RegExp(USER_TOKEN, "gi"), userName);

  if (charName.trim()) {
    substitute(new RegExp(`(${CHAR_TOKEN})'s`, "gi"), `${charName}${suffix}`);
    substitute(new RegExp(CHAR_TOKEN, "gi"), charName);
  }

  return { text, count };
}

/**
 * Короткое имя: `Rosalia Convallaria` → `Rosalia`.
 *
 * В тексте карточки `{{char}}` стоит в середине предложения, и полное имя
 * читается тяжело: «Rosalia Convallaria doesn't seem to register…».
 */
export function shortName(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";

  const [first] = trimmed.split(/\s+/);
  return first ?? trimmed;
}

/**
 * Кириллический текст или латиница.
 *
 * От этого зависит, оставлять ли английское притяжательное `'s`: в русской
 * карточке «Розалия's взгляд» читается плохо, а в английской «Странник взгляд»
 * теряет смысл.
 */
export function isCyrillicDominant(source: string): boolean {
  const cyrillic = source.match(/[\p{Script=Cyrillic}]/gu)?.length ?? 0;
  const latin = source.match(/[A-Za-z]/g)?.length ?? 0;
  return cyrillic > latin;
}

/** Строка вида `{{user}}:` — это пример диалога, а не правило для модели. */
const EXAMPLE_LINE = new RegExp(`^\\s*(?:${USER_TOKEN}|${CHAR_TOKEN})\\s*:`, "i");

/**
 * Отделяет примеры диалога от инструкций.
 *
 * Карточки часто кладут `<START>` с примером реплик прямо в `system_prompt`,
 * и тогда правила персонажа превращаются в кашу из чужих диалогов.
 */
export function splitExampleDialogue(source: string): {
  rules: string;
  examples: string;
} {
  if (!source.trim()) return { rules: "", examples: "" };

  const rules: string[] = [];
  const examples: string[] = [];

  // Считаем абзац примером, если в нём есть реплика персонажа или игрока.
  // Иначе changelog после примеров уедет в примеры и не будет вычищен.
  for (const paragraph of source.split(/\n\s*\n/)) {
    const isExample = paragraph
      .split(/\r?\n/)
      .some((line) => EXAMPLE_LINE.test(line));

    (isExample ? examples : rules).push(paragraph);
  }

  return { rules: rules.join("\n\n"), examples: examples.join("\n\n") };
}

// -------------------- Блоки [Ключ: значение] --------------------

const KEY_PATTERN = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё _\-/]{0,39}$/;

/** Достаёт блоки `[Ключ: значение]`, включая вложенные скобки внутри значения. */
export function extractBracketBlocks(source: string): {
  text: string;
  blocks: BracketBlock[];
} {
  const blocks: BracketBlock[] = [];
  let text = "";
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("[", index);
    if (open === -1) {
      text += source.slice(index);
      break;
    }

    text += source.slice(index, open);

    const colon = source.indexOf(":", open);
    const newline = source.indexOf("\n", open);

    // Ключ должен быть коротким и без переводов строки.
    if (colon === -1 || colon > open + 60 || (newline !== -1 && newline < colon)) {
      text += "[";
      index = open + 1;
      continue;
    }

    const key = source.slice(open + 1, colon).trim();
    const words = key.split(/\s+/).filter(Boolean).length;

    // Проза с двоеточием — не блок: у ключа до четырёх слов.
    if (!KEY_PATTERN.test(key) || words > 4) {
      text += "[";
      index = open + 1;
      continue;
    }

    // Ищем парную закрывающую скобку, считая вложенность.
    let depth = 1;
    let cursor = colon + 1;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === "[") depth += 1;
      else if (char === "]") depth -= 1;
      cursor += 1;
    }

    if (depth !== 0) {
      text += "[";
      index = open + 1;
      continue;
    }

    const value = source.slice(colon + 1, cursor - 1).trim();
    if (!value) {
      text += "[";
      index = open + 1;
      continue;
    }

    blocks.push({ key, value });
    index = cursor;
  }

  return { text, blocks };
}

// -------------------- Служебный шум --------------------

const NOISE_URL =
  /\b(discord\.gg|discord\.com\/invite|ko-?fi\.com|patreon\.com|boosty\.to|subscribestar|buymeacoffee|paypal\.me|drive\.google|docs\.google|mega\.nz|mediafire|gofile\.io|gumroad)\b/i;

/** Упоминание чужих клиентов почти всегда означает рекламу или changelog. */
const NOISE_CLIENT =
  /\b(sillytavern|chub\.ai|janitorai|characterai|c\.ai|wyvern\.ai|agnai|risuai)\b/i;

/** Записи автора: «17/07 Update: …», «Update 03/05: …». */
const NOISE_CHANGELOG =
  /(\b\d{1,2}\/\d{1,2}\b|\b20\d{2}\b)[^\n]{0,80}\bupdate[sd]?\b|\bupdate[sd]?\b[^\n]{0,40}\b\d{1,2}\/\d{1,2}\b/i;

const NOISE_SOCIAL =
  /\b(discord|patreon|ko-?fi|boosty|subscribestar|buymeacoffee|paypal|tipeee|telegram|twitter|instagram|tiktok)\b/i;

const NOISE_LOREBOOK =
  /\bdownload\b[\s\S]{0,100}\blorebook\b|\blorebook\b[\s\S]{0,60}\bdownload\b/i;

function isNoiseParagraph(paragraph: string): boolean {
  if (/^\s*([-–—=*_])\s*\1{2,}\s*$/.test(paragraph)) return true;
  if (NOISE_URL.test(paragraph)) return true;
  if (NOISE_CLIENT.test(paragraph)) return true;
  if (NOISE_CHANGELOG.test(paragraph)) return true;
  if (NOISE_LOREBOOK.test(paragraph)) return true;

  // Приглашения « join my Discord » и прочие сборы денег — не про персонажа.
  if (
    NOISE_SOCIAL.test(paragraph) &&
    (paragraph.length <= 240 ||
      /\b(join|follow|subscribe|support|donate|tip|my)\b/i.test(paragraph))
  ) {
    return true;
  }

  const trimmed = paragraph.trim();
  return (
    /^\s*\*{0,2}\s*update\b/i.test(trimmed) &&
    /\b(update|changelog|fixed|added|removed|re-?implemented)\b/i.test(trimmed)
  );
}

/** Сворачивает лишние переводы строк и хвостовые пробелы. */
export function tidyText(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    // Снятые теги оставляют цепочки пробелов — их не должно быть в тексте.
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** Выбрасывает changelog, рекламу и разделители, считая выброшенные абзацы. */
export function stripServiceNoise(source: string): { text: string; noise: number } {
  if (!source.trim()) return { text: "", noise: 0 };

  let noise = 0;
  const kept = source.split(/\n\s*\n/).filter((paragraph) => {
    if (!paragraph.trim()) return false;
    if (isNoiseParagraph(paragraph)) {
      noise += 1;
      return false;
    }
    return true;
  });

  const lines = kept
    .join("\n\n")
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return true;
      // Сплошные разделители: ---, ***, ===
      if (/^\s*([-–—=*_])\s*\1{2,}\s*$/.test(line)) return false;
      if (/^\s*&nbsp;?\s*$/i.test(line)) return false;
      return true;
    });

  return { text: tidyText(lines.join("\n")), noise };
}

// -------------------- Разбор блоков по полям --------------------

export type BlockTarget =
  | "description"
  | "personality"
  | "scenario"
  | "tags"
  | "genre"
  | "age"
  | "skip";

/** Ключи, у которых нет русской подписи: это и есть содержание поля целиком. */
const PRIMARY_KEYS = new Set([
  "appearance",
  "body",
  "body and appearance",
  "physical",
  "physical appearance",
  "looks",
  "personality",
  "backstory",
  "background",
  "history",
  "scenario",
]);

const KEY_LABELS: Record<string, string> = {
  name: "Имя",
  sex: "Пол",
  gender: "Пол",
  race: "Раса",
  species: "Раса",
  age: "Возраст",
  occupation: "Род занятий",
  job: "Род занятий",
  class: "Род занятий",
  title: "Титул",
  height: "Рост",
  measurements: "Параметры",
  clothing: "Одежда",
  "clothing style": "Одежда",
  outfit: "Одежда",
  equipment: "Снаряжение",
  weapons: "Снаряжение",
  inventory: "Снаряжение",
  home: "Дом",
  residence: "Дом",
  "speaking style": "Манера речи",
  speech: "Манера речи",
  voice: "Голос",
  mannerisms: "Привычки",
  quirks: "Привычки",
  habits: "Привычки",
  likes: "Любит",
  loves: "Любит",
  dislikes: "Не любит",
  hates: "Не любит",
  fears: "Страхи",
  flaws: "Слабости",
  weaknesses: "Слабости",
  strengths: "Сильные стороны",
  "sexual info": "Интимная сфера",
  "sexual info and kinks": "Интимная сфера",
  kinks: "Интимная сфера",
  sexual: "Интимная сфера",
  nsfw: "Интимная сфера",
  goals: "Цели",
  goal: "Цели",
  motivations: "Мотивы",
  skills: "Навыки",
  abilities: "Навыки",
  powers: "Способности",
  relationships: "Связи",
  setting: "Мир",
  world: "Мир",
  lore: "Мир",
  context: "Контекст",
  plot: "Завязка",
  summary: "Кратко",
};

const TARGET_KEYS: Record<Exclude<BlockTarget, "tags" | "genre" | "age" | "skip">, string[]> = {
  description: [
    "name",
    "sex",
    "gender",
    "race",
    "species",
    "age",
    "occupation",
    "job",
    "class",
    "title",
    "appearance",
    "body",
    "body and appearance",
    "physical",
    "physical appearance",
    "looks",
    "height",
    "measurements",
    "clothing",
    "clothing style",
    "outfit",
    "equipment",
    "weapons",
    "inventory",
    "home",
    "residence",
  ],
  personality: [
    "personality",
    "traits",
    "character",
    "temperament",
    "speaking style",
    "speech",
    "voice",
    "mannerisms",
    "quirks",
    "habits",
    "likes",
    "loves",
    "dislikes",
    "hates",
    "fears",
    "flaws",
    "weaknesses",
    "strengths",
    "sexual info",
    "sexual info and kinks",
    "kinks",
    "sexual",
    "nsfw",
  ],
  scenario: [
    "scenario",
    "backstory",
    "background",
    "history",
    "lore",
    "goals",
    "goal",
    "motivations",
    "plot",
    "setting",
    "world",
    "context",
    "skills",
    "abilities",
    "powers",
    "relationships",
    "summary",
  ],
};

export function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** В какое поле персонажа уходит блок с таким ключом. */
export function classifyBlock(key: string): BlockTarget {
  const normalized = normalizeKey(key);

  if (normalized === "tags" || normalized === "tag") return "tags";
  if (normalized === "genre" || normalized === "genres") return "genre";

  for (const [target, keys] of Object.entries(TARGET_KEYS)) {
    if (keys.includes(normalized)) return target as BlockTarget;
  }

  return "skip";
}

export interface DistributedBlocks {
  description: string[];
  personality: string[];
  scenario: string[];
  tags: string[];
  genre?: string;
  age?: string;
  /** Блоки, которые никуда не подошли, — их не выбрасываем. */
  unknown: string[];
}

function splitList(value: string): string[] {
  return value
    .split(/[,;/]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Раскладывает блоки `[Ключ: значение]` по полям персонажа. */
export function distributeBlocks(blocks: BracketBlock[]): DistributedBlocks {
  const result: DistributedBlocks = {
    description: [],
    personality: [],
    scenario: [],
    tags: [],
    unknown: [],
  };

  for (const block of blocks) {
    const normalized = normalizeKey(block.key);
    const target = classifyBlock(block.key);
    const value = tidyText(block.value);

    if (!value) continue;

    if (target === "tags") {
      result.tags.push(...splitList(value));
      continue;
    }

    if (target === "genre") {
      result.genre = result.genre ?? value;
      result.tags.push(...splitList(value));
      continue;
    }

    if (target === "skip") {
      result.unknown.push(`${block.key.trim()}: ${value}`);
      continue;
    }

    const label = PRIMARY_KEYS.has(normalized) ? "" : (KEY_LABELS[normalized] ?? block.key.trim());
    const line = label ? `${label}: ${value}` : value;

    if (normalized === "age" && !result.age) {
      result.age = value;
    }

    if (target === "description" || target === "personality" || target === "scenario") {
      result[target].push(line);
    } else {
      result.unknown.push(line);
    }
  }

  return result;
}

// -------------------- Полный проход по полю --------------------

/**
 * Полная очистка одного поля карточки: разметка → плейсхолдеры → блоки → шум.
 */
export function cleanCardField(
  source: string,
  options: { userName?: string; charName?: string } = {}
): CleanFieldResult {
  if (!source?.trim()) {
    return { text: "", images: [], blocks: [], placeholders: 0, noise: 0 };
  }

  const markup = stripMarkup(source);
  const placeholders = replacePlaceholders(markup.text, options);
  const blocks = extractBracketBlocks(placeholders.text);
  const noise = stripServiceNoise(blocks.text);

  return {
    text: noise.text,
    images: markup.images,
    blocks: blocks.blocks,
    placeholders: placeholders.count,
    noise: noise.noise,
  };
}

/**
 * Склеивает реплики примеров, выбрасывая повторы построчно.
 *
 * Один и тот же диалог часто лежит и в `mes_example`, и в `system_prompt`
 * (причём с разными переводами строк), поэтому сравниваем строки, а не абзацы.
 */
export function joinUniqueLines(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of parts) {
    for (const rawLine of part.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;

      const key = line.toLocaleLowerCase("ru-RU");
      if (seen.has(key)) continue;

      seen.add(key);
      out.push(line);
    }
  }

  return out.join("\n");
}

/** Склеивает части поля, не оставляя пустых дыр. */
export function joinParts(parts: string[]): string {
  return tidyText(
    parts
      .map((part) => tidyText(part))
      .filter((part) => part.length > 0)
      .join("\n\n")
  );
}

/**
 * Мягкая очистка: только разметка и плейсхолдеры.
 *
 * Нужна там, где содержимое трогать нельзя — например, в записях лорбука:
 * блоки `[Ключ: значение]` там часть самой записи, а changelog не встречается.
 */
export function cleanLooseText(
  source: string,
  options: { userName?: string; charName?: string } = {}
): { text: string; images: string[]; placeholders: number } {
  if (!source?.trim()) return { text: "", images: [], placeholders: 0 };

  const markup = stripMarkup(source);
  const placeholders = replacePlaceholders(markup.text, options);

  return {
    text: tidyText(placeholders.text),
    images: markup.images,
    placeholders: placeholders.count,
  };
}
