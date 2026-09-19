import Dexie, { type Table } from "dexie";
import type {
  Character,
  ChatSession,
  SceneRelation,
  Message,
  Persona,
  UserProfile,
  ApiConfig,
  ApiPreset,
  RelationshipStats,
  LorebookEntry,
  DiaryEntry,
  StoryLogEntry,
  ExtractedFact,
  ThoughtMode,
} from "./types";
import { DEFAULT_API_CONFIG, DEFAULT_STATS } from "./types";
import { newId } from "./utils/id";

export interface KVRecord {
  key: string;
  value: unknown;
}

class RoleplayDB extends Dexie {
  characters!: Table<Character, string>;
  sessions!: Table<ChatSession, string>;
  messages!: Table<Message, string>;
  kv!: Table<KVRecord, string>;

  constructor() {
    super("ai-roleplay-db");
    this.version(1).stores({
      characters: "id, name, createdAt",
      sessions: "id, characterId, createdAt, updatedAt",
      messages: "id, sessionId, timestamp",
      kv: "key",
    });
  }
}

export const db = new RoleplayDB();

// -------------------- Настройки (KV helpers) --------------------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rec = await db.kv.get(key);
  return rec ? (rec.value as T) : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value });
}

// -------------------- Свои личности (персоны) --------------------
//
// ВАЖНО про liveQuery: Dexie отслеживает только те чтения, которые идут из
// самой функции запроса «напрямую». Чтение ключа после `await` вложенного
// хелпера теряет подписку, и интерфейс перестаёт обновляться (именно так
// ломалось переключение персоны). Поэтому getPersonaState() читает оба ключа
// сам, без вложенных вызовов, а остальные функции построены поверх него.

const PERSONAS_KEY = "personas";
const ACTIVE_PERSONA_KEY = "activePersonaId";
const LEGACY_PROFILE_KEY = "userProfile";

export const DEFAULT_PROFILE: UserProfile = {
  name: "Странник",
  avatarUrl: "",
  personaDescription: "Загадочный гость этого мира.",
};

function isPersona(value: unknown): value is Persona {
  const record = value as Persona | null;
  return Boolean(record && typeof record === "object" && typeof record.id === "string");
}

function parsePersonas(value: unknown): Persona[] {
  return Array.isArray(value) ? value.filter(isPersona) : [];
}

function toProfile(persona: Persona): UserProfile {
  return {
    name: persona.name,
    avatarUrl: persona.avatarUrl,
    personaDescription: persona.personaDescription,
  };
}

function resolveActive(personas: Persona[], activeId: string | null): Persona | null {
  return personas.find((persona) => persona.id === activeId) ?? personas[0] ?? null;
}

/**
 * Состояние персон для интерфейса: список и активная. Читает ключи напрямую,
 * поэтому подходит для useLiveQuery — обновляется сразу после переключения.
 */
export async function getPersonaState(): Promise<{
  personas: Persona[];
  activePersona: Persona | null;
}> {
  const personasRecord = await db.kv.get(PERSONAS_KEY);
  const activeRecord = await db.kv.get(ACTIVE_PERSONA_KEY);

  const personas = parsePersonas(personasRecord?.value);
  const activeId =
    typeof activeRecord?.value === "string" ? activeRecord.value : null;

  return { personas, activePersona: resolveActive(personas, activeId) };
}

/** Императивное чтение списка (кнопки, обработчики). */
export async function listPersonas(): Promise<Persona[]> {
  return (await getPersonaState()).personas;
}

export async function getActivePersonaId(): Promise<string | null> {
  return (await getPersonaState()).activePersona?.id ?? null;
}

export async function getActivePersona(): Promise<Persona> {
  const { activePersona } = await getPersonaState();
  if (activePersona) return activePersona;

  // Персон ещё нет (первый запуск): подсказываем старый одиночный профиль.
  const legacyRecord = await db.kv.get(LEGACY_PROFILE_KEY);
  const legacy = legacyRecord?.value as Partial<UserProfile> | undefined;

  return {
    id: "legacy",
    createdAt: 0,
    ...DEFAULT_PROFILE,
    ...(legacy && typeof legacy === "object" ? legacy : {}),
  };
}

/**
 * Первый запуск после обновления: одиночный профиль становится первой персоной.
 * Вызывается при инициализации приложения — в live-запросах побочных эффектов нет.
 */
export async function ensurePersonas(): Promise<void> {
  const { personas } = await getPersonaState();
  if (personas.length > 0) return;

  const legacyRecord = await db.kv.get(LEGACY_PROFILE_KEY);
  const legacy = legacyRecord?.value as Partial<UserProfile> | undefined;

  const seed: Persona = {
    id: newId(),
    createdAt: Date.now(),
    ...DEFAULT_PROFILE,
    ...(legacy && typeof legacy === "object" ? legacy : {}),
  };

  await db.kv.put({ key: PERSONAS_KEY, value: [seed] });
  await db.kv.put({ key: ACTIVE_PERSONA_KEY, value: seed.id });
  await db.kv.put({ key: LEGACY_PROFILE_KEY, value: toProfile(seed) });
}

/** Всегда перезаписывает список целиком — просто и предсказуемо. */
async function writePersonas(personas: Persona[]): Promise<void> {
  await db.kv.put({ key: PERSONAS_KEY, value: personas });
}

export async function setActivePersona(id: string): Promise<void> {
  const { personas } = await getPersonaState();
  const next = personas.find((persona) => persona.id === id);
  if (!next) throw new Error("Персона не найдена.");

  await db.kv.put({ key: ACTIVE_PERSONA_KEY, value: id });
  // Старый ключ держим синхронным: на него смотрят прежние сборки и импорт.
  await db.kv.put({ key: LEGACY_PROFILE_KEY, value: toProfile(next) });
}

export type PersonaDraft = Partial<Omit<Persona, "id" | "createdAt">>;

export async function createPersona(draft: PersonaDraft = {}): Promise<Persona> {
  const { personas } = await getPersonaState();
  const persona: Persona = {
    id: newId(),
    createdAt: Date.now(),
    name: draft.name?.trim() || `Персона ${personas.length + 1}`,
    avatarUrl: draft.avatarUrl ?? "",
    personaDescription: draft.personaDescription ?? "",
  };

  await writePersonas([...personas, persona]);
  return persona;
}

export async function updatePersona(id: string, patch: PersonaDraft): Promise<void> {
  const { personas, activePersona } = await getPersonaState();
  const index = personas.findIndex((persona) => persona.id === id);
  if (index === -1) throw new Error("Персона не найдена.");

  const current = personas[index];
  const updated: Persona = {
    ...current,
    ...patch,
    name: (patch.name ?? current.name).trim() || current.name,
  };

  const next = [...personas];
  next[index] = updated;
  await writePersonas(next);

  if (activePersona?.id === id) {
    await db.kv.put({ key: LEGACY_PROFILE_KEY, value: toProfile(updated) });
  }
}

export async function deletePersona(id: string): Promise<void> {
  const { personas } = await getPersonaState();
  if (personas.length <= 1) {
    throw new Error("Нужна хотя бы одна персона — удалить последнюю нельзя.");
  }

  const next = personas.filter((persona) => persona.id !== id);
  await writePersonas(next);

  const { activePersona } = await getPersonaState();
  if (!activePersona || activePersona.id === id) {
    await setActivePersona(next[0].id);
  }
}

/**
 * Кто из персон ведёт диалог: сначала выбор ветки, затем персонаж, затем
 * активная. Неизвестные id (персону удалили) просто пропускаются.
 */
export function resolvePersonaForChat(
  state: { personas: Persona[]; activePersona: Persona | null },
  preferredIds: Array<string | undefined | null>
): Persona | null {
  for (const id of preferredIds) {
    if (!id) continue;
    const found = state.personas.find((persona) => persona.id === id);
    if (found) return found;
  }
  return state.activePersona;
}

/** Профиль игрока — это всегда активная персона. */
export async function getUserProfile(): Promise<UserProfile> {
  return toProfile(await getActivePersona());
}

export async function setUserProfile(profile: UserProfile): Promise<void> {
  const persona = await getActivePersona();
  if (persona.id === "legacy") {
    // Персон ещё нет — создаём первую из того, что ввели в форме.
    const created = await createPersona(profile);
    await setActivePersona(created.id);
    return;
  }
  await updatePersona(persona.id, profile);
}

export async function getApiConfig(): Promise<ApiConfig> {
  return getSetting<ApiConfig>("apiConfig", DEFAULT_API_CONFIG);
}

export async function setApiConfig(cfg: ApiConfig): Promise<void> {
  await setSetting("apiConfig", cfg);
}

// -------------------- Пресеты подключений API --------------------

export async function getApiPresets(): Promise<ApiPreset[]> {
  return getSetting<ApiPreset[]>("apiPresets", []);
}

export async function saveApiPreset(name: string, config: ApiConfig): Promise<ApiPreset> {
  const presets = await getApiPresets();
  const newPreset: ApiPreset = {
    id: newId(),
    name: name.trim() || "Пресет без названия",
    config: { ...config },
    createdAt: Date.now(),
  };
  await setSetting("apiPresets", [newPreset, ...presets]);
  return newPreset;
}

export async function deleteApiPreset(id: string): Promise<void> {
  const presets = await getApiPresets();
  await setSetting(
    "apiPresets",
    presets.filter((p) => p.id !== id)
  );
}

// -------------------- Быстрые действия с персонажами --------------------

export async function toggleCharacterFavorite(characterId: string): Promise<boolean> {
  const char = await db.characters.get(characterId);
  if (!char) return false;
  const next = !char.isFavorite;
  await db.characters.update(characterId, { isFavorite: next });
  return next;
}

export async function toggleCharacterPin(characterId: string): Promise<boolean> {
  const char = await db.characters.get(characterId);
  if (!char) return false;
  const next = !char.isPinned;
  await db.characters.update(characterId, { isPinned: next });
  return next;
}

// -------------------- Быстрые действия с сессиями --------------------

export async function toggleSessionPin(sessionId: string): Promise<boolean> {
  const session = await db.sessions.get(sessionId);
  if (!session) return false;

  const nextPinned = !session.isPinned;
  let nextOrder = 0;

  if (nextPinned) {
    const pinned = await db.sessions.filter((s) => !!s.isPinned).toArray();
    const maxOrder = pinned.reduce((max, s) => Math.max(max, s.pinOrder ?? 0), 0);
    nextOrder = maxOrder + 1;
  }

  await db.sessions.update(sessionId, {
    isPinned: nextPinned,
    pinOrder: nextOrder,
  });

  return nextPinned;
}

export async function updatePinnedSessionsOrder(orderedIds: string[]): Promise<void> {
  await db.transaction("rw", db.sessions, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.sessions.update(orderedIds[i], { pinOrder: i });
    }
  });
}

// -------------------- Нормализаторы данных --------------------

/**
 * Число с защитой от NaN/Infinity. Через `typeof x === "number"` проходил NaN,
 * а запись с NaN в индексе Dexie не показывается в orderBy — так «исчезали»
 * созданные персонажи. Всегда возвращаем конечное число.
 */
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteStat(value: unknown, fallback: number): number {
  return Math.min(100, Math.max(0, finiteNumber(value, fallback)));
}

export function sanitizeStats(rawStats?: Partial<RelationshipStats>): RelationshipStats {
  return {
    trust: finiteStat(rawStats?.trust, DEFAULT_STATS.trust),
    affection: finiteStat(rawStats?.affection, DEFAULT_STATS.affection),
    closeness: finiteStat(rawStats?.closeness, DEFAULT_STATS.closeness),
    tension: finiteStat(rawStats?.tension, DEFAULT_STATS.tension),
    conflict: finiteStat(rawStats?.conflict, DEFAULT_STATS.conflict),
    statusTitle: typeof rawStats?.statusTitle === "string" && rawStats.statusTitle.trim() ? rawStats.statusTitle : DEFAULT_STATS.statusTitle,
    customStats: rawStats?.customStats && typeof rawStats.customStats === "object" ? rawStats.customStats : {},
  };
}

export function sanitizeLorebook(rawLore?: unknown): LorebookEntry[] {
  if (!Array.isArray(rawLore)) return [];
  return rawLore.map((item) => ({
    id: typeof item?.id === "string" ? item.id : newId(),
    keys: Array.isArray(item?.keys) ? item.keys.filter((k: unknown) => typeof k === "string") : [],
    content: typeof item?.content === "string" ? item.content : "",
    isActive: item?.isActive !== false,
  }));
}

export function sanitizeDiary(rawDiary?: unknown): DiaryEntry[] {
  if (!Array.isArray(rawDiary)) return [];
  return rawDiary.map((item, idx) => ({
    id: typeof item?.id === "string" ? item.id : newId(),
    timestamp: finiteNumber(item?.timestamp, Date.now()),
    entryNumber: finiteNumber(item?.entryNumber, idx + 1),
    thought: typeof item?.thought === "string" ? item.thought : "",
    mood: typeof item?.mood === "string" ? item.mood : undefined,
  }));
}

export function sanitizeStoryLog(rawLog?: unknown): StoryLogEntry[] {
  if (!Array.isArray(rawLog)) return [];
  return rawLog.map((item) => ({
    id: typeof item?.id === "string" ? item.id : newId(),
    timestamp: finiteNumber(item?.timestamp, Date.now()),
    text: typeof item?.text === "string" ? item.text : "",
  }));
}

export function sanitizeExtractedFacts(rawFacts?: unknown): ExtractedFact[] {
  if (!Array.isArray(rawFacts)) return [];
  return rawFacts.map((item) => ({
    id: typeof item?.id === "string" ? item.id : newId(),
    keys: Array.isArray(item?.keys) ? item.keys.filter((k: unknown) => typeof k === "string") : ["Заметка"],
    content: typeof item?.content === "string" ? item.content : "",
    createdAt: finiteNumber(item?.createdAt, Date.now()),
    isPinned: Boolean(item?.isPinned),
  }));
}

export function sanitizeCharacter(raw: Partial<Character>): Character {
  return {
    id: typeof raw?.id === "string" && raw.id.trim() ? raw.id : newId(),
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : "Безымянный",
    defaultPersonaId:
      typeof raw?.defaultPersonaId === "string" ? raw.defaultPersonaId : undefined,
    avatarUrl: typeof raw?.avatarUrl === "string" ? raw.avatarUrl : "",
    wallpaperUrl: typeof raw?.wallpaperUrl === "string" ? raw.wallpaperUrl : undefined,
    tagline: typeof raw?.tagline === "string" ? raw.tagline : "",
    genre: typeof raw?.genre === "string" ? raw.genre : undefined,
    tags: Array.isArray(raw?.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    isFavorite: Boolean(raw?.isFavorite),
    isPinned: Boolean(raw?.isPinned),
    originTag: typeof raw?.originTag === "string" ? raw.originTag : undefined,
    firstImpression: typeof raw?.firstImpression === "string" ? raw.firstImpression : undefined,
    startingPoint: typeof raw?.startingPoint === "string" ? raw.startingPoint : undefined,
    age: typeof raw?.age === "string" ? raw.age : undefined,
    summaryQuote: typeof raw?.summaryQuote === "string" ? raw.summaryQuote : undefined,
    description: typeof raw?.description === "string" ? raw.description : "",
    personality: typeof raw?.personality === "string" ? raw.personality : "",
    scenario: typeof raw?.scenario === "string" ? raw.scenario : "",
    systemPrompt: typeof raw?.systemPrompt === "string" ? raw.systemPrompt : "",
    firstMessage: typeof raw?.firstMessage === "string" ? raw.firstMessage : "*Смотрит на тебя в тишине...*",
    initialStats: sanitizeStats(raw?.initialStats),
    lorebook: sanitizeLorebook(raw?.lorebook),
    createdAt: finiteNumber(raw?.createdAt, Date.now()),
  };
}

/** Участники групповой сцены: строки, без пустых, без дублей и без основного персонажа. */
export function sanitizeCharacterIds(rawIds: unknown, mainId?: string): string[] {
  if (!Array.isArray(rawIds)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const value of rawIds) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!id || id === mainId || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

/** Шкалы отношений участников групповой сцены (по id персонажа). */
export function sanitizeParticipantStats(
  rawStats?: unknown
): Record<string, RelationshipStats> {
  if (!rawStats || typeof rawStats !== "object" || Array.isArray(rawStats)) {
    return {};
  }

  const result: Record<string, RelationshipStats> = {};

  for (const [id, value] of Object.entries(rawStats as Record<string, unknown>)) {
    const key = id.trim();
    if (!key) continue;
    result[key] = sanitizeStats(value as Partial<RelationshipStats>);
  }

  return result;
}

/**
 * Кто сейчас в сцене. `undefined` означает «присутствуют все из состава» —
 * так работают одиночные ветки и старые записи.
 */
export function sanitizeActiveCharacterIds(
  rawIds: unknown,
  castIds: string[],
  mainId?: string
): string[] | undefined {
  if (!Array.isArray(rawIds)) return undefined;

  const allowed = new Set(castIds);
  if (mainId) allowed.add(mainId);

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const value of rawIds) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  // Пустой список означал бы сцену без единого героя — считаем, что все на месте.
  return ids.length > 0 ? ids : undefined;
}

/** Причины отсутствия: id персонажа → короткая фраза («ушёл в гараж»). */
export function sanitizeAbsentReasons(raw?: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const result: Record<string, string> = {};

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = id.trim();
    if (!key || typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    result[key] = text.slice(0, 120);
  }

  return result;
}

/** Взаимоотношения внутри группы: «кто» → «о ком» → «что думает». */
export function sanitizeSceneRelations(raw?: unknown): SceneRelation[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item) => item && typeof item === "object")
    .map((item: any) => ({
      id: typeof item?.id === "string" && item.id.trim() ? item.id : newId(),
      from: typeof item?.from === "string" ? item.from.trim() : "",
      to: typeof item?.to === "string" && item.to.trim() ? item.to.trim() : undefined,
      text: typeof item?.text === "string" ? item.text.trim().slice(0, 400) : "",
    }))
    .filter((item) => item.from && item.text);
}

export function sanitizeSession(raw: Partial<ChatSession>): ChatSession {
  const validModes: ThoughtMode[] = ["censor", "counterpoint", "stream", "tactical", "instinct"];
  const rawMode = (raw as any)?.thoughtMode;
  const thoughtMode: ThoughtMode = validModes.includes(rawMode) ? rawMode : "censor";
  const castIds = sanitizeCharacterIds(raw?.characterIds, raw?.characterId);

  return {
    id: typeof raw?.id === "string" && raw.id.trim() ? raw.id : newId(),
    characterId: typeof raw?.characterId === "string" ? raw.characterId : "",
    personaId: typeof raw?.personaId === "string" ? raw.personaId : undefined,
    characterIds: castIds,
    isGroup: Boolean(raw?.isGroup) || castIds.length > 0,
    activeCharacterIds: sanitizeActiveCharacterIds(
      raw?.activeCharacterIds,
      castIds,
      raw?.characterId
    ),
    absentReasons: sanitizeAbsentReasons(raw?.absentReasons),
    relations: sanitizeSceneRelations(raw?.relations),
    participantStats: sanitizeParticipantStats(raw?.participantStats),
    memoryExtractedCount: Math.max(
      0,
      Math.round(finiteNumber(raw?.memoryExtractedCount, 0))
    ),
    title: typeof raw?.title === "string" && raw.title.trim() ? raw.title : "Новая ветка",
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    storyLog: sanitizeStoryLog(raw?.storyLog),
    directorNotes: typeof raw?.directorNotes === "string" ? raw.directorNotes : "",
    wallpaperUrl: typeof raw?.wallpaperUrl === "string" ? raw.wallpaperUrl : undefined,
    wallpaperDim: finiteNumber(raw?.wallpaperDim, 0.55),
    wallpaperBlur: finiteNumber(raw?.wallpaperBlur, 0),
    dynamicEvents: Boolean(raw?.dynamicEvents),
    suspenseMode: Boolean(raw?.suspenseMode),
    naturalSpeech: Boolean(raw?.naturalSpeech),
    showRelationshipToasts: raw?.showRelationshipToasts !== false,
    realisticPacing: raw?.realisticPacing !== false,
    novelMode: Boolean(raw?.novelMode),
    thoughtMode,
    diary: sanitizeDiary(raw?.diary),
    extractedFacts: sanitizeExtractedFacts(raw?.extractedFacts),
    currentStats: sanitizeStats(raw?.currentStats),
    isPinned: Boolean(raw?.isPinned),
    pinOrder: finiteNumber(raw?.pinOrder, 0),
    createdAt: finiteNumber(raw?.createdAt, Date.now()),
    updatedAt: finiteNumber(raw?.updatedAt, Date.now()),
  };
}

export function sanitizeMessage(raw: any): Message {
  let swipes: string[] = ["..."];
  if (Array.isArray(raw?.swipes) && raw.swipes.length > 0) {
    swipes = raw.swipes.map((s: unknown) => String(s ?? ""));
  } else if (typeof raw?.content === "string") {
    swipes = [raw.content];
  } else if (typeof raw?.text === "string") {
    swipes = [raw.text];
  }

  const sender: Message["sender"] =
    raw?.sender === "user" || raw?.sender === "assistant" || raw?.sender === "system"
      ? raw.sender
      : "assistant";

  return {
    id: typeof raw?.id === "string" && raw.id.trim() ? raw.id : newId(),
    sessionId: typeof raw?.sessionId === "string" ? raw.sessionId : "",
    characterId: typeof raw?.characterId === "string" && raw.characterId.trim()
      ? raw.characterId
      : undefined,
    characterName: typeof raw?.characterName === "string" && raw.characterName.trim()
      ? raw.characterName
      : undefined,
    sender,
    swipes,
    currentSwipeIndex: typeof raw?.currentSwipeIndex === "number"
      ? Math.max(0, Math.min(raw.currentSwipeIndex, swipes.length - 1))
      : 0,
    innerThought: typeof raw?.innerThought === "string" ? raw.innerThought : undefined,
    statsSnapshot: raw?.statsSnapshot ? sanitizeStats(raw.statsSnapshot) : undefined,
    imageUrl: typeof raw?.imageUrl === "string" ? raw.imageUrl : undefined,
    timestamp: finiteNumber(raw?.timestamp, Date.now()),
  };
}

export interface BackupBundle {
  version: 2;
  appName: "NOCTURNE";
  exportedAt: number;
  characters: Character[];
  sessions: ChatSession[];
  messages: Message[];
  kv: KVRecord[];
}

export async function exportBackup(): Promise<BackupBundle> {
  const [characters, sessions, messages, kv] = await Promise.all([
    db.characters.toArray(),
    db.sessions.toArray(),
    db.messages.toArray(),
    db.kv.toArray(),
  ]);

  return {
    version: 2,
    appName: "NOCTURNE",
    exportedAt: Date.now(),
    characters,
    sessions,
    messages,
    kv,
  };
}

export async function importBackup(rawBundle: any): Promise<void> {
  if (!rawBundle || typeof rawBundle !== "object") {
    throw new Error("Некорректный формат файла бэкапа: файл не является объектом.");
  }

  if (!Array.isArray(rawBundle.characters) || !Array.isArray(rawBundle.sessions) || !Array.isArray(rawBundle.messages)) {
    throw new Error("Файл бэкапа повреждён: отсутствуют списки персонажей, сессий или сообщений.");
  }

  const sanitizedCharacters = rawBundle.characters.map(sanitizeCharacter);
  const sanitizedSessions = rawBundle.sessions.map(sanitizeSession);
  const sanitizedMessages = rawBundle.messages.map(sanitizeMessage);
  const sanitizedKv = Array.isArray(rawBundle.kv) ? rawBundle.kv : [];

  await db.transaction("rw", db.characters, db.sessions, db.messages, db.kv, async () => {
    await Promise.all([
      db.characters.clear(),
      db.sessions.clear(),
      db.messages.clear(),
      db.kv.clear(),
    ]);

    if (sanitizedCharacters.length > 0) await db.characters.bulkAdd(sanitizedCharacters);
    if (sanitizedSessions.length > 0) await db.sessions.bulkAdd(sanitizedSessions);
    if (sanitizedMessages.length > 0) await db.messages.bulkAdd(sanitizedMessages);
    if (sanitizedKv.length > 0) await db.kv.bulkAdd(sanitizedKv);
  });
}

export async function wipeAllData(): Promise<void> {
  await db.transaction("rw", db.characters, db.sessions, db.messages, db.kv, async () => {
    await Promise.all([
      db.characters.clear(),
      db.sessions.clear(),
      db.messages.clear(),
      db.kv.clear(),
    ]);
  });
}