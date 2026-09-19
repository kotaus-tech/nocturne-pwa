import {
  db,
  sanitizeSession,
  sanitizeCharacter,
  sanitizeMessage,
  sanitizeStats,
} from "../db";
import { newId } from "./id";
import type { Character, ChatSession, Message, RelationshipStats } from "../types";

export interface ChatExportBundle {
  version: 2;
  appName: "NOCTURNE";
  exportedAt: number;
  session: ChatSession;
  character?: Character;
  /** Групповая сцена: остальные участники ветки. */
  participants?: Character[];
  messages: Message[];
}

export interface ParsedChatPreview {
  title: string;
  createdAt: number;
  updatedAt: number;
  stats?: RelationshipStats;
  messagesCount: number;
  lastMessagePreview: string;
  character?: Character;
  /** Групповая сцена: остальные участники ветки. */
  participants: Character[];
  rawSession: Partial<ChatSession>;
  rawMessages: any[];
}

function stripMeta(text: string): string {
  return text
    .replace(/```(?:meta|json)?[\s\S]*?```/gi, "")
    .replace(/\*/g, "")
    .trim();
}

/** Экспортирует конкретную ветку чата в JSON-файл */
export async function exportChatSession(sessionId: string): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) {
    throw new Error("Ветка диалога не найдена в базе данных.");
  }

  const [character, messages] = await Promise.all([
    db.characters.get(session.characterId),
    db.messages.where("sessionId").equals(sessionId).sortBy("timestamp"),
  ]);

  const participantIds = (session.characterIds ?? []).filter(
    (id) => id !== session.characterId
  );

  const participantCharacters = participantIds.length
    ? (await db.characters.bulkGet(participantIds)).filter(
        (item): item is Character => Boolean(item)
      )
    : [];

  const bundle: ChatExportBundle = {
    version: 2,
    appName: "NOCTURNE",
    exportedAt: Date.now(),
    session,
    character,
    participants: participantCharacters,
    messages,
  };

  const safeTitle = (character?.name || session.title || "chat")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 30);

  const dateStr = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `nocturne-chat-${safeTitle}-${dateStr}.json`;
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Валидирует файл и извлекает метаданные для предпросмотра без записи в базу данных */
export async function parseChatBundle(file: File): Promise<ParsedChatPreview> {
  const text = await file.text();
  let raw: any;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Выбранный файл не является валидным JSON-документом.");
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Некорректная структура файла диалога: корень не является объектом.");
  }

  // Поддержка нового формата бандла, плоской структуры и legacy-бэкапов
  const rawSession = raw.session || raw;
  const rawMessages = Array.isArray(raw.messages)
    ? raw.messages
    : Array.isArray(raw)
      ? raw
      : [];
  const rawCharacter = raw.character;

  if (!rawSession || typeof rawSession !== "object") {
    throw new Error("В файле отсутствует описание ветки диалога.");
  }

  const title = typeof rawSession.title === "string" && rawSession.title.trim()
    ? rawSession.title.trim()
    : "Импортированная история";

  const stats = rawSession.currentStats ? sanitizeStats(rawSession.currentStats) : undefined;

  let lastMessagePreview = "Диалог пуст.";
  if (rawMessages.length > 0) {
    const last = rawMessages[rawMessages.length - 1];
    let content = "";
    if (Array.isArray(last?.swipes) && last.swipes.length > 0) {
      content = String(last.swipes[last.currentSwipeIndex ?? 0] ?? "");
    } else if (typeof last?.content === "string") {
      content = last.content;
    } else if (typeof last?.text === "string") {
      content = last.text;
    }
    const clean = stripMeta(content);
    if (clean) {
      lastMessagePreview = clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
    }
  }

  let character: Character | undefined;
  if (rawCharacter && typeof rawCharacter === "object" && rawCharacter.name) {
    character = sanitizeCharacter(rawCharacter);
  }

  const participants: Character[] = Array.isArray(raw.participants)
    ? raw.participants
        .filter((item: any) => item && typeof item === "object" && item.name)
        .map((item: any) => sanitizeCharacter(item))
    : [];

  return {
    title,
    createdAt: typeof rawSession.createdAt === "number" ? rawSession.createdAt : Date.now(),
    updatedAt: typeof rawSession.updatedAt === "number" ? rawSession.updatedAt : Date.now(),
    stats,
    messagesCount: rawMessages.length,
    lastMessagePreview,
    character,
    participants,
    rawSession,
    rawMessages,
  };
}

export interface SaveImportedSessionOptions {
  preview: ParsedChatPreview;
  targetCharacterId: string;
  customTitle?: string;
  createNewCharacter?: boolean;
}

/** Транзакционно сохраняет импортированную сессию и сообщения в Dexie */
export async function saveImportedSession({
  preview,
  targetCharacterId,
  customTitle,
  createNewCharacter = false,
}: SaveImportedSessionOptions): Promise<{ sessionId: string }> {
  let finalCharacterId = targetCharacterId;

  // Если запрошено создание нового персонажа из файла
  if (createNewCharacter && preview.character) {
    const newChar: Character = {
      ...preview.character,
      id: newId(),
      createdAt: Date.now(),
    };
    await db.characters.put(newChar);
    finalCharacterId = newChar.id;
  } else {
    // Проверяем, существует ли целевой персонаж
    const existing = await db.characters.get(finalCharacterId);
    if (!existing) {
      if (preview.character) {
        const restored = sanitizeCharacter(preview.character);
        await db.characters.put(restored);
        finalCharacterId = restored.id;
      } else {
        const fallback = sanitizeCharacter({
          id: finalCharacterId || newId(),
          name: preview.title ? `Герой: ${preview.title}` : "Восстановленный персонаж",
          tagline: "Восстановлен из импортированного диалога",
        });
        await db.characters.put(fallback);
        finalCharacterId = fallback.id;
      }
    }
  }

  // Участники групповой сцены: чужие ветки не перезаписываем, недостающих создаём.
  const participantIds: string[] = [];
  for (const participant of preview.participants ?? []) {
    if (!participant?.id || participant.id === finalCharacterId) continue;

    const existing = await db.characters.get(participant.id);
    if (!existing) {
      await db.characters.put({ ...participant, id: participant.id });
    }
    participantIds.push(participant.id);
  }

  const originalMainId =
    typeof preview.rawSession.characterId === "string"
      ? preview.rawSession.characterId
      : undefined;

  const newSessionId = newId();
  const sessionToSave = sanitizeSession({
    ...preview.rawSession,
    id: newSessionId,
    characterId: finalCharacterId,
    title: customTitle?.trim() || preview.title,
    characterIds: participantIds.length > 0 ? participantIds : undefined,
    participantStats:
      participantIds.length > 0 ? preview.rawSession.participantStats : undefined,
    updatedAt: Date.now(),
  });

  const messagesToSave: Message[] = preview.rawMessages.map((m) => {
    const clean = sanitizeMessage(m);
    return {
      ...clean,
      characterId:
        clean.characterId && originalMainId && clean.characterId === originalMainId
          ? finalCharacterId
          : clean.characterId,
      id: newId(),
      sessionId: newSessionId,
    };
  });

  await db.transaction("rw", db.sessions, db.messages, async () => {
    await db.sessions.put(sessionToSave);
    if (messagesToSave.length > 0) {
      await db.messages.bulkPut(messagesToSave);
    }
  });

  return { sessionId: newSessionId };
}

/** Обратная совместимость для быстрого импорта */
export async function importChatSession(file: File): Promise<{ sessionId: string }> {
  const preview = await parseChatBundle(file);
  const targetCharId = preview.character?.id || preview.rawSession.characterId || newId();
  return saveImportedSession({
    preview,
    targetCharacterId: targetCharId,
    createNewCharacter: Boolean(preview.character),
  });
}