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

/** Меняет элементы местами: сдвиг на одну позицию вверх/вниз с границами. */
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length) return items;
  if (target < 0 || target >= items.length) return items;

  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ------------------------------------------------------------------
// Присутствие: кто физически в сцене, а кто за кадром
// ------------------------------------------------------------------

export interface ScenePresence {
  /** В сцене: могут говорить и действовать. */
  present: Character[];
  /** За кадром: говорить за них запрещено, указываем причину. */
  absent: { character: Character; reason?: string }[];
}

/**
 * Раскладывает состав на присутствующих и отсутствующих.
 * `activeCharacterIds` не задан — значит в сцене все (одиночные ветки и старые данные).
 */
export function resolvePresence(
  session:
    | Pick<ChatSession, "characterId" | "characterIds" | "activeCharacterIds" | "absentReasons">
    | undefined,
  cast: Character[]
): ScenePresence {
  const activeIds = session?.activeCharacterIds;

  if (!activeIds || activeIds.length === 0) {
    return { present: cast, absent: [] };
  }

  const active = new Set(activeIds);
  const present: Character[] = [];
  const absent: { character: Character; reason?: string }[] = [];

  for (const character of cast) {
    if (active.has(character.id)) {
      present.push(character);
      continue;
    }

    const reason = session?.absentReasons?.[character.id];
    absent.push({ character, reason: reason?.trim() || undefined });
  }

  // Если в сцене не осталось никого (например, персонажа удалили) — сцену не ломаем.
  if (present.length === 0) return { present: cast, absent: [] };

  return { present, absent };
}

/** Следующий по кругу говорящий после указанного (для «Продолжить»). */
export function nextSpeaker(
  present: Character[],
  lastSpeakerId?: string
): Character | undefined {
  if (present.length === 0) return undefined;
  if (!lastSpeakerId) return present[0];

  const index = present.findIndex((item) => item.id === lastSpeakerId);
  if (index === -1) return present[0];

  return present[(index + 1) % present.length];
}

/** Кого игрок назвал по имени в своей реплике (грубое совпадение, для роутинга). */
export function findMentionedCharacter(
  text: string,
  present: Character[]
): Character | undefined {
  const haystack = ` ${text.toLocaleLowerCase("ru-RU")} `;

  let best: { character: Character; at: number } | null = null;

  for (const character of present) {
    const name = character.name.trim().toLocaleLowerCase("ru-RU");
    if (name.length < 2) continue;

    const at = haystack.indexOf(name);
    if (at === -1) continue;

    // Берём самое раннее упоминание: обычно к кому обратились в начале.
    if (!best || at < best.at) best = { character, at };
  }

  return best?.character;
}
