import {
  db,
  sanitizeCharacter,
  sanitizeSession,
  sanitizeMessage,
} from "../db";
import { newId } from "./id";
import { downloadBlob, safeFileName } from "./download";
import type { CardPreviewInfo, NormalizedCard } from "../services/characterCard";
import type { Character, ChatSession, Message } from "../types";

export interface CharacterExportBundle {
  version: 2;
  appName: "NOCTURNE";
  exportedAt: number;
  type: "character_full_archive";
  character: Character;
  sessions: ChatSession[];
  messages: Message[];
  stats: {
    sessionsCount: number;
    messagesCount: number;
    factsCount: number;
    diaryCount: number;
    loreCount: number;
  };
}

export interface ParsedCharacterPreview {
  character: Character;
  isFullArchive: boolean;
  sessions: ChatSession[];
  messages: Message[];
  stats: {
    sessionsCount: number;
    messagesCount: number;
    factsCount: number;
    diaryCount: number;
    loreCount: number;
  };
  /** Заполняется только при импорте карточки Character Card. */
  cardInfo?: CardPreviewInfo;
  /**
   * Сама карточка до превращения в персонажа. Нужна, чтобы прогнать её через
   * модель (перевод, чистка) и собрать превью заново.
   */
  card?: NormalizedCard;
}

/** Экспортирует персонажа вместе со всеми связанными ветками, историей сообщений, памятью и дневниками */
export async function exportCharacterFullBundle(characterId: string): Promise<void> {
  const character = await db.characters.get(characterId);
  if (!character) {
    throw new Error("Персонаж не найден в базе данных.");
  }

  const sessions = await db.sessions
    .where("characterId")
    .equals(characterId)
    .toArray();

  const sessionIds = sessions.map((s) => s.id);

  let messages: Message[] = [];
  if (sessionIds.length > 0) {
    messages = await db.messages
      .where("sessionId")
      .anyOf(sessionIds)
      .sortBy("timestamp");
  }

  let totalFacts = 0;
  let totalDiary = 0;
  for (const s of sessions) {
    totalFacts += s.extractedFacts?.length ?? 0;
    totalDiary += s.diary?.length ?? 0;
  }

  const bundle: CharacterExportBundle = {
    version: 2,
    appName: "NOCTURNE",
    exportedAt: Date.now(),
    type: "character_full_archive",
    character,
    sessions,
    messages,
    stats: {
      sessionsCount: sessions.length,
      messagesCount: messages.length,
      factsCount: totalFacts,
      diaryCount: totalDiary,
      loreCount: character.lorebook?.length ?? 0,
    },
  };

  const safeName = safeFileName(character.name, "character");
  const dateStr = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });

  downloadBlob(blob, `nocturne-character-${safeName}-${dateStr}.json`);
}

/** Валидирует файл архива персонажа и формирует превью данных без записи в базу данных */
export async function parseCharacterBundle(file: File): Promise<ParsedCharacterPreview> {
  const text = await file.text();
  let raw: any;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Выбранный файл не является корректным JSON-документом.");
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Некорректная структура файла персонажа: файл пуст или поврежден.");
  }

  let characterRaw: any;
  let sessionsRaw: any[] = [];
  let messagesRaw: any[] = [];
  let isFullArchive = false;

  if (raw.type === "character_full_archive" || (raw.character && typeof raw.character === "object")) {
    isFullArchive = true;
    characterRaw = raw.character;
    sessionsRaw = Array.isArray(raw.sessions) ? raw.sessions : [];
    messagesRaw = Array.isArray(raw.messages) ? raw.messages : [];
  } else if (typeof raw.name === "string" && (raw.firstMessage || raw.systemPrompt || raw.personality)) {
    // Поддержка плоского JSON персонажа
    isFullArchive = false;
    characterRaw = raw;
    sessionsRaw = [];
    messagesRaw = [];
  } else {
    throw new Error(
      "Файл не похож ни на архив NOCTURNE, ни на карточку Character Card (V1/V2/V3)."
    );
  }

  const character = sanitizeCharacter(characterRaw);
  const sessions = sessionsRaw.map(sanitizeSession);
  const messages = messagesRaw.map(sanitizeMessage);

  let totalFacts = 0;
  let totalDiary = 0;
  for (const s of sessions) {
    totalFacts += s.extractedFacts?.length ?? 0;
    totalDiary += s.diary?.length ?? 0;
  }

  return {
    character,
    isFullArchive,
    sessions,
    messages,
    stats: {
      sessionsCount: sessions.length,
      messagesCount: messages.length,
      factsCount: totalFacts,
      diaryCount: totalDiary,
      loreCount: character.lorebook?.length ?? 0,
    },
  };
}

export interface SaveImportedCharacterOptions {
  preview: ParsedCharacterPreview;
  customName?: string;
  includeChats?: boolean;
}

/** Выполняет транзакционное сохранение персонажа с каскадной перелинковкой всех идентификаторов */
export async function saveImportedCharacterBundle({
  preview,
  customName,
  includeChats = true,
}: SaveImportedCharacterOptions): Promise<{ characterId: string; sessionsCount: number }> {
  const newCharacterId = newId();

  const characterToSave: Character = {
    ...preview.character,
    id: newCharacterId,
    name: customName?.trim() || preview.character.name,
    createdAt: Date.now(),
  };

  const sessionsToSave: ChatSession[] = [];
  const messagesToSave: Message[] = [];

  if (includeChats && preview.sessions.length > 0) {
    // Карта сопоставления старых sessionId -> новым sessionId
    const sessionIdMap = new Map<string, string>();

    for (const rawSession of preview.sessions) {
      const freshSessionId = newId();
      sessionIdMap.set(rawSession.id, freshSessionId);

      sessionsToSave.push({
        ...rawSession,
        id: freshSessionId,
        characterId: newCharacterId,
        updatedAt: Date.now(),
      });
    }

    for (const rawMsg of preview.messages) {
      const mappedSessionId = sessionIdMap.get(rawMsg.sessionId);
      if (mappedSessionId) {
        messagesToSave.push({
          ...rawMsg,
          id: newId(),
          sessionId: mappedSessionId,
        });
      }
    }
  }

  await db.transaction("rw", db.characters, db.sessions, db.messages, async () => {
    await db.characters.put(characterToSave);

    if (sessionsToSave.length > 0) {
      await db.sessions.bulkPut(sessionsToSave);
    }
    if (messagesToSave.length > 0) {
      await db.messages.bulkPut(messagesToSave);
    }
  });

  return {
    characterId: newCharacterId,
    sessionsCount: sessionsToSave.length,
  };
}