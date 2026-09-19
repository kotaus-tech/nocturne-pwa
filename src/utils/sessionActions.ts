import { db } from "../db";
import { newId } from "./id";
import type { Character, ChatSession, Message } from "../types";

/** Создаёт новую ветку диалога для персонажа с его стартовым сообщением */
export async function createSession(character: Character, title?: string): Promise<ChatSession> {
  const now = Date.now();
  const session: ChatSession = {
    id: newId(),
    characterId: character.id,
    title: title ?? `Ветка ${new Date(now).toLocaleDateString("ru-RU")}`,
    directorNotes: "",
    summary: "",
    currentStats: { ...character.initialStats },
    novelMode: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.sessions.add(session);

  const firstMsg: Message = {
    id: newId(),
    sessionId: session.id,
    sender: "assistant",
    swipes: [character.firstMessage],
    currentSwipeIndex: 0,
    statsSnapshot: session.currentStats,
    timestamp: now,
  };
  await db.messages.add(firstMsg);

  return session;
}

/** Клонирует ветку "с текущего момента" — копирует все сообщения и статы в новую сессию */
export async function cloneSession(session: ChatSession, newTitle?: string): Promise<ChatSession> {
  const now = Date.now();
  const clone: ChatSession = {
    ...session,
    id: newId(),
    title: newTitle ?? `${session.title} (копия)`,
    createdAt: now,
    updatedAt: now,
  };
  await db.sessions.add(clone);

  const messages = await db.messages.where("sessionId").equals(session.id).sortBy("timestamp");
  const cloned: Message[] = messages.map((m) => ({ ...m, id: newId(), sessionId: clone.id }));
  if (cloned.length) await db.messages.bulkAdd(cloned);

  return clone;
}

export async function deleteSessionCascade(sessionId: string): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    await db.messages.where("sessionId").equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await db.sessions.update(sessionId, { title });
}

export async function deleteCharacterCascade(characterId: string): Promise<void> {
  const sessions = await db.sessions.where("characterId").equals(characterId).toArray();

  // Если персонаж был участником чужой групповой сцены — убираем его из состава,
  // чтобы в ветке не оставалось «призрака» без аватара и шкал.
  const allSessions = await db.sessions.toArray();
  const groupSessions = allSessions.filter(
    (s) => s.characterId !== characterId && (s.characterIds ?? []).includes(characterId)
  );

  await db.transaction("rw", db.characters, db.sessions, db.messages, async () => {
    for (const s of sessions) {
      await db.messages.where("sessionId").equals(s.id).delete();
    }
    await db.sessions.where("characterId").equals(characterId).delete();

    for (const s of groupSessions) {
      const nextStats = { ...(s.participantStats ?? {}) };
      delete nextStats[characterId];

      await db.sessions.update(s.id, {
        characterIds: (s.characterIds ?? []).filter((id) => id !== characterId),
        participantStats: nextStats,
      });
    }

    await db.characters.delete(characterId);
  });
}

/** Перематывает ветку назад: удаляет все сообщения после указанного (включительно/невключительно) */
export async function rewindToMessage(sessionId: string, messageId: string, keepMessage: boolean): Promise<void> {
  const messages = await db.messages.where("sessionId").equals(sessionId).sortBy("timestamp");
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  const cutIdx = keepMessage ? idx + 1 : idx;
  const toDelete = messages.slice(cutIdx).map((m) => m.id);
  if (toDelete.length) await db.messages.bulkDelete(toDelete);
}
