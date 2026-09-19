import type {
  Character,
  ChatSession,
  Message,
  RelationshipStats,
  SceneRelation,
} from "../types";
import { newId } from "../utils/id";

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
/**
 * Сопоставляет имена из мета-поля `returned` с персонажами за кадром.
 * Модель может писать имя в другой форме («Мира» — «Миры»), поэтому сначала
 * ищем точное совпадение, затем совпадение по основе слова.
 */
export function matchReturnedCharacters(
  names: string[],
  candidates: Character[]
): Character[] {
  const flat = names.flatMap((item) =>
    typeof item === "string" ? item.split(/[,;]/) : []
  );

  const normalize = (value: string) =>
    value.trim().toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N} ]/gu, "");

  // Основа слова: у имён длиннее двух букв отбрасываем последнюю букву, чтобы
  // «Кай» и «Кая», «Рин» и «Рина» сходились между собой.
  const stems = (value: string) => {
    const word = normalize(value).split(/\s+/)[0] ?? "";
    return word.length >= 3 ? word.slice(0, -1) : word;
  };

  const found: Character[] = [];

  const push = (character: Character) => {
    if (!found.some((item) => item.id === character.id)) found.push(character);
  };

  // Первый проход — только точные совпадения, чтобы «Кира» не перебивала «Киру».
  const pending: string[] = [];
  for (const raw of flat) {
    const needle = normalize(raw);
    if (needle.length < 2) continue;

    const exact = candidates.find(
      (item) => normalize(item.name) === needle && !found.some((f) => f.id === item.id)
    );

    if (exact) push(exact);
    else pending.push(raw);
  }

  // Второй проход — по основе слова (падежи, уменьшительные формы).
  for (const raw of pending) {
    const needle = normalize(raw);
    if (needle.length < 3) continue;

    const stem = stems(raw);
    const match = candidates.find((item) => {
      if (found.some((f) => f.id === item.id)) return false;
      const name = normalize(item.name);
      if (name.length < 3) return false;
      if (name.includes(needle) || needle.includes(name)) return true;

      const nameStem = stems(item.name);
      if (stem.length < 2 || nameStem.length < 2) return false;

      return nameStem.startsWith(stem) || stem.startsWith(nameStem);
    });

    if (match) push(match);
  }

  return found;
}

/**
 * Сопоставляет «кто ушёл» из мета-поля `left` с героями, которые сейчас
 * в сцене: причина из мета-блока едет вместе с найденным персонажем.
 */
export function matchLeftCharacters(
  entries: { name: string; reason?: string }[],
  candidates: Character[]
): { character: Character; reason?: string }[] {
  const result: { character: Character; reason?: string }[] = [];

  for (const entry of entries) {
    const [match] = matchReturnedCharacters([entry.name], candidates);
    if (!match || result.some((item) => item.character.id === match.id)) continue;
    result.push({ character: match, reason: entry.reason });
  }

  return result;
}

/** Сколько связей вообще держим в ветке: больше не помещается в промпт. */
const MAX_SCENE_RELATIONS = 12;

export interface SceneRelationUpdate {
  /** Итоговый список связей ветки. */
  relations: SceneRelation[];
  /** Какие пары модель действительно переписала — для тоста игроку. */
  changed: { from: string; to?: string }[];
}

/**
 * Живые связи: модель возвращает в мета-блоке только изменившиеся отношения,
 * а мы находим эту пару в ветке и обновляем текст. Новые пары добавляются,
 * незнакомые имена игнорируются.
 */
export function mergeSceneRelations(
  existing: SceneRelation[],
  incoming: { from: string; to?: string; text: string }[],
  participants: Character[]
): SceneRelationUpdate {
  const relations = existing.map((item) => ({ ...item }));
  const changed: { from: string; to?: string }[] = [];

  for (const update of incoming) {
    const [from] = matchReturnedCharacters([update.from], participants);
    if (!from) continue;

    const to = update.to
      ? matchReturnedCharacters([update.to], participants)[0]
      : undefined;
    if (update.to && !to) continue;

    const text = update.text.trim().slice(0, 400);
    if (!text) continue;

    const samePair = relations.find(
      (item) => item.from === from.id && (item.to ?? undefined) === (to?.id ?? undefined)
    );

    if (samePair) {
      if (samePair.text === text) continue;
      samePair.text = text;
      samePair.updatedAt = Date.now();
      changed.push({ from: from.name, to: to?.name });
      continue;
    }

    if (relations.length >= MAX_SCENE_RELATIONS) continue;

    relations.push({
      id: newId(),
      from: from.id,
      to: to?.id,
      text,
      updatedAt: Date.now(),
    });
    changed.push({ from: from.name, to: to?.name });
  }

  return { relations, changed };
}

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
