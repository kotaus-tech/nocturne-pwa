import type { Character } from "../types";
import { sanitizeCharacter } from "../db";
import {
  cardToCharacter,
  characterToCardJson,
  cleanCard,
  describeCard,
  encodeBase64Utf8,
  extractCardTextFromPng,
  looksLikeCharacterCard,
  normalizeCard,
  parseCardJson,
  type NormalizedCard,
} from "../services/characterCard";
import { replacePngTextChunk } from "./pngChunks";
import { AVATAR_OPTIONS, prepareImageFile } from "./image";
import { downloadBlob, safeFileName } from "./download";
import { parseCharacterBundle, type ParsedCharacterPreview } from "./characterExport";

/**
 * Файловый слой карточек Character Card: чтение `File`, подготовка аватара,
 * запись PNG и скачивание. Вся чистая логика формата — в
 * `services/characterCard.ts`, здесь только работа с браузерными API.
 *
 * PNG-экспорт пишет карточку версии V2 в текстовый чанк `chara` (base64) —
 * это вариант, который понимают SillyTavern, Risu, Chub и JanitorAI.
 */

/** Куда кладём JSON карточки внутри PNG. */
const CARD_CHUNK_KEYWORD = "chara";

function isPngFile(file: File): boolean {
  return (
    file.type === "image/png" || file.name.toLowerCase().endsWith(".png")
  );
}

export interface ParseCharacterFileOptions {
  /** Имя персоны игрока: им заменяем `{{user}}` в тексте карточки. */
  userName?: string;
  /** Чистить служебный мусор и раскладывать блоки `[Ключ: значение]`. */
  clean?: boolean;
}

function previewFromCard(
  card: NormalizedCard,
  options: { avatarUrl?: string; fromPng: boolean; userName?: string; clean?: boolean }
): ParsedCharacterPreview {
  const { card: prepared, report } =
    options.clean === false
      ? { card, report: undefined }
      : cleanCard(card, { userName: options.userName });

  const character = sanitizeCharacter(
    cardToCharacter(prepared, { avatarUrl: options.avatarUrl })
  );

  return {
    character,
    isFullArchive: false,
    sessions: [],
    messages: [],
    stats: {
      sessionsCount: 0,
      messagesCount: 0,
      factsCount: 0,
      diaryCount: 0,
      loreCount: character.lorebook?.length ?? 0,
    },
    cardInfo: {
      ...describeCard(prepared, { fromPng: options.fromPng }),
      clean: report,
    },
    card: prepared,
  };
}

/**
 * Читает карточку из PNG: сам JSON достаём из чанка, а обложку используем как
 * аватар персонажа (с уменьшением, как при обычной загрузке картинки).
 */
export async function parseCharacterCardPng(
  file: File,
  options: ParseCharacterFileOptions = {}
): Promise<ParsedCharacterPreview> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = extractCardTextFromPng(bytes);

  if (!text) {
    throw new Error(
      "В PNG не найдена карточка персонажа. Файл должен быть выгружен из SillyTavern, Risu, Chub или другого клиента вместе с вложенной карточкой."
    );
  }

  const card = parseCardJson(text);

  // Иконка из V3-карточки приоритетнее: обложка PNG — это лишь упаковка.
  let avatarUrl = card.iconUri;

  if (!avatarUrl) {
    try {
      avatarUrl = await prepareImageFile(file, AVATAR_OPTIONS);
    } catch {
      // Кривая обложка не повод отказываться от импорта: карточка важнее.
      avatarUrl = "";
    }
  }

  return previewFromCard(card, { avatarUrl, fromPng: true, ...options });
}

/**
 * Единая точка входа импорта персонажа.
 *
 * Порядок важен: сначала проверяем признаки карточки (у неё snake_case-поля),
 * а уже затем отдаём файл родному парсеру NOCTURNE — иначе полный архив с
 * полем `creator` можно принять за карточку.
 */
export async function parseCharacterFile(
  file: File,
  options: ParseCharacterFileOptions = {}
): Promise<ParsedCharacterPreview> {
  if (isPngFile(file)) return parseCharacterCardPng(file, options);

  let raw: unknown = null;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    raw = null;
  }

  if (looksLikeCharacterCard(raw)) {
    const card = normalizeCard(raw);
    return previewFromCard(card, { avatarUrl: card.iconUri, fromPng: false, ...options });
  }

  return parseCharacterBundle(file);
}

/**
 * Пересобирает персонажа из карточки, не трогая остальное превью.
 *
 * Нужно после работы модели: перевод и чистка меняют карточку, а аватар и
 * статистика превью должны остаться прежними.
 */
export function rebuildPreviewCharacter(
  preview: ParsedCharacterPreview,
  card: NormalizedCard
): ParsedCharacterPreview {
  return {
    ...preview,
    card,
    character: sanitizeCharacter(
      cardToCharacter(card, { avatarUrl: preview.character.avatarUrl })
    ),
  };
}

export function supportsCardImport(file: File): boolean {
  return isPngFile(file) || file.name.toLowerCase().endsWith(".json");
}

// -------------------- Экспорт --------------------

function exportFileName(character: Character, extension: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `nocturne-card-${safeFileName(character.name, "character")}-${date}.${extension}`;
}

/** Скачивает карточку в формате Character Card V2 (JSON). */
export function exportCharacterCardJson(character: Character): void {
  const blob = new Blob([characterToCardJson(character)], {
    type: "application/json",
  });

  downloadBlob(blob, exportFileName(character, "json"));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Не удалось загрузить аватар персонажа."));

    image.src = src;
  });
}

/** Рисует текущий аватар в PNG нужного размера и отдаёт его байты. */
async function renderAvatarToPng(character: Character): Promise<Uint8Array> {
  const image = await loadImage(character.avatarUrl);

  const width = Math.min(image.naturalWidth || 512, 1024);
  const height = Math.min(image.naturalHeight || 512, 1024);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Браузер не поддерживает обработку изображений.");
  }

  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/png");
  });

  if (!blob) {
    throw new Error("Не удалось подготовить PNG-карточку. Попробуйте другой аватар.");
  }

  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Скачивает карточку, вложенную в PNG с текущим аватаром: файл можно сразу
 * перетащить в окно персонажей другого клиента.
 */
export async function exportCharacterCardPng(character: Character): Promise<void> {
  if (!character.avatarUrl?.trim()) {
    throw new Error(
      "Добавьте персонажу аватар: PNG-карточка вкладывается в изображение."
    );
  }

  const pngBytes = await renderAvatarToPng(character);
  const cardJson = characterToCardJson(character);

  const withCard = replacePngTextChunk(
    pngBytes,
    CARD_CHUNK_KEYWORD,
    encodeBase64Utf8(cardJson)
  );

  // Копия с собственным ArrayBuffer: так байты точно подходят под BlobPart.
  downloadBlob(
    new Blob([new Uint8Array(withCard)], { type: "image/png" }),
    exportFileName(character, "png")
  );
}
