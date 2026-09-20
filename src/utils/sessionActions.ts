import { db } from "../db";
import { newId } from "./id";
import type { Character, ChatSession, Message, RelationshipStats } from "../types";

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

  // Альтернативные приветствия карточки становятся свайпами первой реплики:
  // игрок может перебрать варианты открытия сцены, не открывая редактор.
  const greetings = [
    character.firstMessage,
    ...(character.alternateGreetings ?? []),
  ].filter((text, index, list) => text.trim().length > 0 && list.indexOf(text) === index);

  const firstMsg: Message = {
    id: newId(),
    sessionId: session.id,
    sender: "assistant",
    swipes: greetings.length > 0 ? greetings : [character.firstMessage],
    currentSwipeIndex: 0,
    statsSnapshot: session.currentStats,
    timestamp: now,
  };
  await db.messages.add(firstMsg);

  return session;
}

/**
 * Создаёт групповую ветку: лидер сцены + остальные участники (2–4 героя).
 *
 * Если передан общий опенинг (например, из AI-генератора группы), он становится
 * первым сообщением от лица лидера; иначе ветка открывается стартовыми
 * репликами всех участников по порядку.
 */
export async function createGroupSession(
  leader: Character,
  others: Character[],
  options?: { title?: string; opening?: string }
): Promise<ChatSession> {
  const now = Date.now();

  const rest = others.filter(
    (item, index) =>
      item &&
      item.id !== leader.id &&
      others.findIndex((other) => other.id === item.id) === index
  );

  const participants = [leader, ...rest];
  const names = participants.map((item) => item.name).join(", ");

  const participantStats: Record<string, RelationshipStats> = {};
  for (const item of rest) {
    participantStats[item.id] = { ...item.initialStats };
  }

  const session: ChatSession = {
    id: newId(),
    characterId: leader.id,
    isGroup: true,
    characterIds: rest.map((item) => item.id),
    participantStats,
    title: options?.title ?? `Групповая сцена: ${names}`,
    directorNotes: "",
    summary: "",
    currentStats: { ...leader.initialStats },
    novelMode: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.sessions.add(session);

  const messages: Message[] = [];

  if (options?.opening?.trim()) {
    messages.push({
      id: newId(),
      sessionId: session.id,
      sender: "assistant",
      characterId: leader.id,
      characterName: leader.name,
      swipes: [options.opening.trim()],
      currentSwipeIndex: 0,
      statsSnapshot: session.currentStats,
      timestamp: now,
    });
  } else {
    participants.forEach((item, index) => {
      messages.push({
        id: newId(),
        sessionId: session.id,
        sender: "assistant",
        characterId: item.id,
        characterName: item.name,
        swipes: [item.firstMessage],
        currentSwipeIndex: 0,
        statsSnapshot: participantStats[item.id] ?? { ...item.initialStats },
        timestamp: now + index,
      });
    });
  }

  if (messages.length > 0) await db.messages.bulkAdd(messages);

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
