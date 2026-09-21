import type {
  Character,
  ChatSession,
  Intention,
  IntentionScope,
  Message,
  ParticipantMemory,
  RelationshipStats,
  SceneRelation,
} from "../types";
import { newId } from "../utils/id";

// ─────────────────────────────────────────────────────────────
// Симметричная личная память участников (константы и хелперы)
// ─────────────────────────────────────────────────────────────

/** Максимум личных заметок на персонажа одновременно. */
export const MAX_PRIVATE_NOTES = 5;
/** Максимальная длина одной личной заметки. */
export const MAX_PRIVATE_NOTE_LENGTH = 300;
/** Максимальная длина формулировки намерения. */
export const MAX_INTENTION_LENGTH = 200;
/** Сколько релевантных сообщений нужно накопить до плановой экстракции. */
export const PERSONAL_MEMORY_DIRTY_THRESHOLD = 3;
/** Интервал по умолчанию между offscreen-тиками, в ходах сцены. */
export const OFFSCREEN_TICK_INTERVAL = 6;
/** Границы пользовательской настройки интервала тика. */
export const OFFSCREEN_TICK_INTERVAL_MIN = 4;
export const OFFSCREEN_TICK_INTERVAL_MAX = 20;
/** Минимум тиков между двумя значимыми событиями одного персонажа. */
export const OFFSCREEN_MIN_TICKS_BETWEEN_SIGNIFICANT = 2;
/** Минимум значимых событий между двумя дистанционными контактами. */
export const REMOTE_CONTACT_MIN_TICKS = 3;

const INTENTION_SCOPES: IntentionScope[] = [
  "location",
  "time",
  "scene",
  "persistent",
];

/** Пустая запись личной памяти — состояние «персонаж ещё ничего не накопил». */
export function emptyParticipantMemory(characterId = ""): ParticipantMemory {
  return {
    characterId,
    privateNotes: [],
    intention: null,
    lastExtractedMessageId: null,
    absentSinceMessageId: null,
    ticksSinceLastSignificant: OFFSCREEN_MIN_TICKS_BETWEEN_SIGNIFICANT,
    // С начала отсутствия дистанционный контакт не «предразрешён»: сначала
    // должны пройти REMOTE_CONTACT_MIN_TICKS значимых событий.
    significantSinceLastContact: 0,
  };
}

/**
 * Запись памяти персонажа из ветки. Отсутствие записи трактуется как «пустое»
 * состояние — по аналогии с тем, как отсутствие `participantStats` означает
 * использование стартовых шкал карточки.
 */
export function getParticipantMemory(
  session: Pick<ChatSession, "participantMemory"> | undefined,
  characterId: string
): ParticipantMemory {
  const stored = session?.participantMemory?.[characterId];
  if (!stored) return emptyParticipantMemory(characterId);

  return {
    ...emptyParticipantMemory(characterId),
    ...stored,
    characterId,
    privateNotes: sanitizePrivateNotes(stored.privateNotes),
    intention: sanitizeIntention(stored.intention),
  };
}

/** Заметки: только непустые строки, обрезка по длине и количеству. */
export function sanitizePrivateNotes(rawNotes: unknown): string[] {
  if (!Array.isArray(rawNotes)) return [];

  const seen = new Set<string>();
  const notes: string[] = [];

  for (const value of rawNotes) {
    if (typeof value !== "string") continue;
    const note = value.trim().slice(0, MAX_PRIVATE_NOTE_LENGTH);
    if (!note || seen.has(note)) continue;
    seen.add(note);
    notes.push(note);
    if (notes.length >= MAX_PRIVATE_NOTES) break;
  }

  return notes;
}

/** Намерение: кламп текста, белый список скоупов, мусор отбрасывается. */
export function sanitizeIntention(rawIntention: unknown): Intention | null {
  if (!rawIntention || typeof rawIntention !== "object") return null;

  const candidate = rawIntention as Partial<Intention>;
  const text =
    typeof candidate.text === "string"
      ? candidate.text.trim().slice(0, MAX_INTENTION_LENGTH)
      : "";
  if (!text) return null;

  const scope = INTENTION_SCOPES.includes(candidate.scope as IntentionScope)
    ? (candidate.scope as IntentionScope)
    : "scene";

  return {
    text,
    scope,
    createdAtMessageId:
      typeof candidate.createdAtMessageId === "string"
        ? candidate.createdAtMessageId
        : "",
    ...(candidate.origin === "offscreen" ? { origin: "offscreen" as const } : {}),
  };
}

/**
 * Дешёвая подпись списка заметок: если к моменту применения фонового патча
 * заметки уже изменил другой источник — патч по заметкам отбрасывается.
 */
export function notesSignature(notes: string[]): string {
  // Сигнатура должна различать одинаковые по длине, но разные заметки:
  // короткий length-счётчик дал бы ложное «патч всё ещё свежий».
  return JSON.stringify(notes);
}

export function intentionSignature(intention: Intention | null): string {
  return JSON.stringify(intention ?? null);
}

/** Инвалидация намерений по скоупу при скачке времени/локации (см. ТЗ §2.2). */
export function intentionSurvivesShift(
  intention: Intention | null,
  shift: { time?: "hours" | "day" | "days" | null; locationChanged?: boolean } | null | undefined
): boolean {
  if (!intention || !shift) return Boolean(intention);

  switch (intention.scope) {
    case "persistent":
      return true;
    case "location":
      return !shift.locationChanged;
    case "time":
      return shift.time == null;
    case "scene":
      return !shift.locationChanged && shift.time == null;
    default:
      return true;
  }
}

/**
 * Позиция сообщения по id в актуальной истории. Безопасность перемотки:
 * работаем только с идентификаторами, числовые индексы не храним.
 */
export function messageIndexById(
  messages: Message[],
  messageId: string | null | undefined
): number {
  if (!messageId) return -1;
  return messages.findIndex((message) => message.id === messageId);
}

/**
 * Сколько ходов сцены (завершённых ответов ассистента) прошло после сообщения.
 * Эхо «живой сцены» и remote-thread ходами не считаются. Если указатель
 * не найден/пуст — считаем от начала истории.
 */
export function sceneTurnsSince(
  messages: Message[],
  sinceMessageId: string | null | undefined
): number {
  const from = messageIndexById(messages, sinceMessageId);
  const start = from === -1 ? 0 : from + 1;

  let turns = 0;
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];
    if (
      message.sender === "assistant" &&
      !message.isLiveSceneEcho &&
      !message.remoteKind &&
      (!message.characterId ||
        !message.presentCharacterIds ||
        message.presentCharacterIds.includes(message.characterId))
    ) {
      turns += 1;
    }
  }
  return turns;
}

/**
 * Грязный флаг персональной экстракции: сколько сообщений, относящихся к
 * персонажу, накопилось с момента его прошлой экстракции.
 *
 * Релевантными считаются: собственные реплики персонажа (кроме эхо
 * «живой сцены»), реплики игрока, адресованные ему, и реплики, где он
 * упомянут по имени. Указатель-сообщение проверяется на фактическое
 * существование — после перемотки отсчёт безопасно начинается заново.
 */
export function countRelevantMessagesSince(
  messages: Message[],
  characterId: string,
  sinceMessageId: string | null | undefined,
  cast?: Character[]
): number {
  const from = messageIndexById(messages, sinceMessageId);
  const start = from === -1 ? 0 : from + 1;

  const target = cast?.find((item) => item.id === characterId);

  let count = 0;
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.sender === "user") {
      if (
        message.addressedTo === characterId ||
        message.targetCharacterId === characterId
      ) {
        count += 1;
      }
      continue;
    }

    if (message.sender !== "assistant" || message.isLiveSceneEcho) continue;

    if ((message.characterId ?? "") === characterId) {
      count += 1;
      continue;
    }

    if (target && messageVisibleToCharacter(message, characterId)) {
      const text = message.swipes[message.currentSwipeIndex] ?? "";
      if (findMentionedCharacter(text, [target])) count += 1;
    }
  }

  return count;
}

/**
 * Перемоткобезопасное разрешение указателя памяти (§11.2). Возвращает
 * актуальный id: сам указатель, если сообщение ещё в истории, либо запасную
 * точку (например, последнюю собственную реплику), либо null.
 */
export function resolveMemoryPointer(
  messages: Message[],
  pointer: string | null | undefined,
  fallback: (messages: Message[]) => string | null
): string | null {
  if (pointer && messageIndexById(messages, pointer) !== -1) return pointer;
  return fallback(messages);
}

/** Id последней собственной реплики персонажа (кроме эхо «живой сцены»). */
export function lastOwnMessageId(
  messages: Message[],
  characterId: string
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender !== "assistant" || message.isLiveSceneEcho) continue;
    if ((message.characterId ?? "") === characterId) return message.id;
  }
  return null;
}

/**
 * Фрагмент истории для фоновых запросов: подписанные реплики после указателя.
 * Эхо «живой сцены» как источник внутреннего состояния исключается (§9 ТЗ).
 */
export function buildTranscriptSince(
  messages: Message[],
  sinceMessageId: string | null | undefined,
  nameFor: (message: Message) => string,
  maxMessages = 24,
  exclude?: (message: Message) => boolean
): string {
  const from = messageIndexById(messages, sinceMessageId);
  const start = from === -1 ? 0 : from + 1;

  return messages
    .slice(start)
    .filter(
      (message) =>
        message.sender !== "system" &&
        !message.isLiveSceneEcho &&
        !message.remoteKind &&
        !exclude?.(message)
    )
    .slice(-maxMessages)
    .map(
      (message) =>
        `${nameFor(message)}: ${message.swipes[message.currentSwipeIndex] ?? ""}`
    )
    .join("\n");
}

/**
 * Видел ли персонаж конкретное сообщение в момент его создания.
 * Новые сообщения несут snapshot присутствия; старые записи без snapshot
 * используют осторожный fallback по прямому обращению/упоминанию.
 */
export function messageVisibleToCharacter(
  message: Message,
  characterId: string
): boolean {
  if (message.sender === "system" || message.isLiveSceneEcho) return false;

  if (message.sender === "user") {
    const targetId = message.targetCharacterId ?? message.addressedTo;
    if (targetId === characterId) return true;

    // Пользовательская часть remote-thread адресована только отсутствующему
    // герою. Она не должна становиться знанием присутствующих персонажей.
    if (message.remoteKind) return false;

    // Для старых записей без remoteKind snapshot показывает, был ли target
    // физически в комнате. Если target отсутствовал, остальные это сообщение
    // не слышали; если присутствовал, обычная адресованная реплика остаётся
    // слышимой остальным участникам по прежнему правилу.
    if (targetId && message.presentCharacterIds) {
      if (!message.presentCharacterIds.includes(targetId)) return false;
    }

    return message.presentCharacterIds
      ? message.presentCharacterIds.includes(characterId)
      : true;
  }

  if (message.characterId === characterId) return true;
  return message.presentCharacterIds
    ? message.presentCharacterIds.includes(characterId)
    : false;
}

/**
 * Является ли сообщение частью дистанционной ветки, а не обычной сцены.
 * Новые записи несут `remoteKind`; для старых сохранений дополнительно
 * используются snapshot присутствия и канонический target/addressed id.
 */
export function isRemoteThreadMessage(
  message: Message,
  participants: Character[],
  present: Character[]
): boolean {
  if (message.remoteKind || message.isRemoteReply) return true;

  // Старые ответы отсутствующего героя могли не иметь remoteKind, но при
  // создании получали snapshot пустой/без собственного id. Это отличает их
  // от обычного хода в комнате и сохраняет изоляцию после возвращения.
  if (message.sender === "assistant" && message.characterId) {
    const authorIsParticipant = participants.some(
      (item) => item.id === message.characterId
    );
    if (authorIsParticipant && message.presentCharacterIds) {
      return !message.presentCharacterIds.includes(message.characterId);
    }
    return false;
  }

  if (message.sender !== "user") return false;

  const targetId = message.targetCharacterId ?? message.addressedTo;
  if (!targetId) return false;

  const targetIsParticipant = participants.some((item) => item.id === targetId);
  if (!targetIsParticipant) return false;

  // Старый remote user-turn мог не иметь `remoteKind`, но его snapshot
  // присутствия всё равно показывает, что адресат был за кадром в момент
  // отправки. Это не должно «влиться» обратно в общую сцену после его возврата.
  if (message.presentCharacterIds) {
    return !message.presentCharacterIds.includes(targetId);
  }

  const targetIsPresent = present.some((item) => item.id === targetId);
  return !targetIsPresent;
}

/**
 * Фрагмент именно личного контекста персонажа. В отличие от общей хроники
 * он не показывает сообщения, созданные в момент физического отсутствия
 * героя; это не полноценный граф знаний, но надёжная MVP-граница видимости.
 */
export function buildPersonalTranscriptSince(
  messages: Message[],
  characterId: string,
  sinceMessageId: string | null | undefined,
  nameFor: (message: Message) => string,
  maxMessages = 32
): string {
  const from = messageIndexById(messages, sinceMessageId);
  const start = from === -1 ? 0 : from + 1;

  return messages
    .slice(start)
    .filter((message) => messageVisibleToCharacter(message, characterId))
    .slice(-maxMessages)
    .map(
      (message) =>
        `${nameFor(message)}: ${message.swipes[message.currentSwipeIndex] ?? ""}`
    )
    .join("\n");
}

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
      // Инлайн-реакции «живой сцены» и дистанционные контакты не являются
      // полноценным ходом героя основной сцены.
      .filter((message) => {
        if (message.isLiveSceneEcho || message.remoteKind) return false;
        if (
          message.characterId &&
          message.presentCharacterIds &&
          participants.some((item) => item.id === message.characterId) &&
          !message.presentCharacterIds.includes(message.characterId)
        ) {
          return false;
        }
        return true;
      })
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
export const MAX_SCENE_RELATIONS = 12;

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
