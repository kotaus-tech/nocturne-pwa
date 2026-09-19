import type { Character, ChatSession, Message, RelationshipStats } from "../types";

/**
 * Групповые сцены: чистая логика «кто в сцене» и «кто это сказал».
 *
 * Основной персонаж ветки (session.characterId) всегда первый — остальные
 * участники идут в порядке session.characterIds. Все функции терпимы к
 * отсутствующим данным: если персонаж удалён, состав просто сокращается.
 */

export type CharacterIndex = Map<string, Character>;

export function buildCharacterIndex(
  characters: Character[] | undefined
): CharacterIndex {
  return new Map((characters ?? []).map((item) => [item.id, item]));
}

/** Участники сцены: основной персонаж + сохранённые в ветке, без дублей. */
export function resolveParticipants(
  session: Pick<ChatSession, "characterId" | "characterIds"> | undefined,
  mainCharacter: Character | undefined,
  charactersById: CharacterIndex
): Character[] {
  if (!mainCharacter) return [];

  const extras: Character[] = [];

  for (const id of session?.characterIds ?? []) {
    const found = charactersById.get(id);
    if (!found || found.id === mainCharacter.id) continue;
    if (extras.some((item) => item.id === found.id)) continue;
    extras.push(found);
  }

  return [mainCharacter, ...extras];
}

/** Автор реплики: для групповой сцены — по message.characterId, иначе основной. */
export function resolveSpeaker(
  message: Message,
  mainCharacter: Character,
  charactersById: CharacterIndex
): Character {
  if (message.characterId) {
    const found = charactersById.get(message.characterId);
    if (found) return found;

    // Персонажа удалили — оставляем реплику за ним по снимку имени,
    // иначе чужая фраза «прилипнет» к основному персонажу.
    if (message.characterName) {
      return {
        ...mainCharacter,
        id: message.characterId,
        name: message.characterName,
        avatarUrl: "",
      };
    }
  }

  return mainCharacter;
}

/** Имя автора реплики (снимок имени переживает удаление персонажа). */
export function resolveSpeakerName(
  message: Message,
  mainCharacter: Character,
  charactersById: CharacterIndex,
  playerName: string
): string {
  if (message.sender === "user") return playerName;

  if (message.characterId) {
    return (
      charactersById.get(message.characterId)?.name ||
      message.characterName ||
      mainCharacter.name
    );
  }

  return mainCharacter.name;
}

/** Шкалы отношений конкретного персонажа сцены. */
export function statsForCharacter(
  session: Pick<ChatSession, "characterId" | "currentStats" | "participantStats">,
  characterId: string,
  charactersById: CharacterIndex
): RelationshipStats {
  if (characterId === session.characterId) return session.currentStats;

  return (
    session.participantStats?.[characterId] ??
    charactersById.get(characterId)?.initialStats ??
    session.currentStats
  );
}

/**
 * Подпись реплик для контекста запроса: свои реплики остаются без префикса,
 * реплики других персонажей помечаются именем — модель видит, кто что сказал.
 */
export function buildAssistantLabeler(
  speakerId: string,
  mainCharacterId: string,
  nameFor: (message: Message) => string
): (message: Message) => string | undefined {
  return (message: Message) => {
    const authorId = message.characterId ?? mainCharacterId;
    if (authorId === speakerId) return undefined;
    return nameFor(message);
  };
}

/**
 * Кто ещё не ответил на последнюю реплику игрока — нужно, чтобы дожать
 * прерванный ход групповой сцены кнопкой «Повторить запрос».
 */
export function pendingSpeakers(
  messages: Message[],
  participants: Character[],
  mainCharacterId: string
): Character[] {
  let lastUserId = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].sender === "user") {
      lastUserId = index;
      break;
    }
  }

  if (lastUserId === -1) return participants;

  const answered = new Set(
    messages
      .slice(lastUserId + 1)
      .filter((message) => message.sender === "assistant")
      .map((message) => message.characterId ?? mainCharacterId)
  );

  return participants.filter((item) => !answered.has(item.id));
}
