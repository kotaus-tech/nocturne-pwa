// =============================================================
// TEXT DNA — ИМПОРТ ГОТОВОГО МАТЕРИАЛА В NOCTURNE
//
// Text DNA не генерирует персонажа по пресету. Он извлекает уже написанный
// пользователем материал, раскладывает его по полям NOCTURNE и сохраняет
// авторские остатки в текстовых полях сцены/карточек.
//
// Важное правило протокола: id и диапазоны исходника принадлежат клиенту.
// Модель возвращает только смысловые данные. Благодаря этому финальный ответ
// не должен повторять технические метаданные и не может сломать покрытие одной
// пустой строкой sectionId.
// =============================================================

import type {
  ApiConfig,
  Character,
  RelationshipStats,
  SceneRelation,
} from "../types";
import { DEFAULT_STATS } from "../types";
import {
  requestV2JsonDetailed,
  V2JsonError,
  V2OutputLimitError,
  V2ProviderError,
  type V2ResponseMetadata,
} from "./v2/provider";
import { newId } from "../utils/id";

export type TextDnaMode = "single" | "group";

/** Максимальный размер исходной секции. Разбиение не удаляет символы. */
export const TEXT_DNA_CHUNK_CHARS = 10_000;
/** Одна генерация + один ограниченный correction только для исправимого ответа. */
export const TEXT_DNA_MAX_ATTEMPTS = 2;
/** Маленький прямой импорт; длинный импорт использует отдельные бюджеты этапов. */
export const TEXT_DNA_OUTPUT_TOKENS = 6_000;
/** Бюджет карты свидетельств одной секции. */
export const TEXT_DNA_CHUNK_OUTPUT_TOKENS = 4_200;
/** Бюджет компактного определения состава/сцены. */
export const TEXT_DNA_INDEX_OUTPUT_TOKENS = 2_400;
/** Бюджет одной карточки; карточки не сводятся в один огромный JSON. */
export const TEXT_DNA_CARD_OUTPUT_TOKENS = 4_200;
/** Порог, после которого индекс строится ограниченными пачками свидетельств. */
export const TEXT_DNA_INDEX_INPUT_MAX_CHARS = 45_000;
export const TEXT_DNA_INDEX_BATCH_CHARS = 32_000;
/** Correction не должен переносить в новый запрос бесконечный ответ модели. */
export const TEXT_DNA_CORRECTION_MAX_CHARS = 18_000;

export interface TextDnaSourceSection {
  /** Устойчивый клиентский идентификатор, не генерируется моделью. */
  id: string;
  /** Фиксированные offsets в исходной строке, не генерируются моделью. */
  start: number;
  end: number;
  text: string;
}

/**
 * Клиентское покрытие. В ответе модели этой структуры нет: она строится из
 * успешно обработанных секций и получает id/offsets здесь, на клиенте.
 */
export interface TextDnaCoverage {
  sectionId: string;
  sourceStart: number;
  sourceEnd: number;
  retainedFacts: string[];
}

export interface TextDnaLoreDraft {
  keys: string[];
  content: string;
}

/** Структура персонажа, которую модель возвращает именно для импорта. */
export interface TextDnaCharacter {
  /** В группе назначается клиентом из индекса состава. */
  key?: string;
  name: string;
  tagline: string;
  age: string;
  genre: string;
  tags: string[];
  firstImpression: string;
  startingPoint: string;
  summaryQuote: string;
  description: string;
  personality: string;
  scenario: string;
  systemPrompt: string;
  firstMessage: string;
  alternateGreetings: string[];
  initialStats: RelationshipStats;
  lorebook: TextDnaLoreDraft[];
  /** Дословные важные остатки, для которых нет отдельного поля. */
  preservedMaterial: string[];
}

export interface TextDnaSessionData {
  title: string;
  summary: string;
  directorNotes: string;
  preservedMaterial: string[];
}

export interface TextDnaSinglePayload {
  mode: "single";
  character: TextDnaCharacter;
  session: TextDnaSessionData;
  preservedMaterial: string[];
  /** Всегда клиентское покрытие, даже если старый ответ модели его содержал. */
  coverage: TextDnaCoverage[];
}

export interface TextDnaSceneData {
  title: string;
  setting: string;
  premise: string;
  currentMoment: string;
  tone: string;
  opening: string;
  summary: string;
  directorNotes: string;
  preservedMaterial: string[];
}

export interface TextDnaRelation {
  fromKey: string;
  toKey: string;
  text: string;
}

export interface TextDnaGroupPayload {
  mode: "group";
  scene: TextDnaSceneData;
  characters: TextDnaCharacter[];
  relations: TextDnaRelation[];
  preservedMaterial: string[];
  coverage: TextDnaCoverage[];
}

export type TextDnaPayload = TextDnaSinglePayload | TextDnaGroupPayload;

export interface TextDnaPreparedSingle {
  mode: "single";
  character: Character;
  title?: string;
  summary: string;
  directorNotes: string;
}

export interface TextDnaPreparedGroup {
  mode: "group";
  characters: Character[];
  title?: string;
  opening: string;
  summary: string;
  directorNotes: string;
  relations: SceneRelation[];
}

export type TextDnaPrepared = TextDnaPreparedSingle | TextDnaPreparedGroup;

export interface TextDnaResult {
  mode: TextDnaMode;
  sourceLength: number;
  sourceSections: Array<Pick<TextDnaSourceSection, "id" | "start" | "end">>;
  payload: TextDnaPayload;
  prepared: TextDnaPrepared;
  corrected: boolean;
}

export type TextDnaFailureKind =
  | "context"
  | "output_limit"
  | "empty_response"
  | "no_json"
  | "invalid_json"
  | "incomplete_json"
  | "schema"
  | "provider"
  | "api"
  | "unknown";

export interface TextDnaDiagnostics {
  stage: string;
  attempt: number;
  kind: TextDnaFailureKind;
  finishReason?: string;
  usage?: V2ResponseMetadata["usage"];
  outputChars?: number;
  issueCount?: number;
}

/** Ошибка Text DNA без исходного текста и без полного ответа модели. */
export class TextDnaError extends Error {
  readonly kind: TextDnaFailureKind;
  readonly diagnostics?: TextDnaDiagnostics;

  constructor(
    message: string,
    kind: TextDnaFailureKind = "unknown",
    diagnostics?: TextDnaDiagnostics
  ) {
    super(message);
    this.name = "TextDnaError";
    this.kind = kind;
    this.diagnostics = diagnostics;
  }
}

export class TextDnaContextError extends TextDnaError {
  constructor(message: string, diagnostics?: TextDnaDiagnostics) {
    super(message, "context", diagnostics);
    this.name = "TextDnaContextError";
  }
}

export class TextDnaOutputLimitError extends TextDnaError {
  constructor(message: string, diagnostics?: TextDnaDiagnostics) {
    super(message, "output_limit", diagnostics);
    this.name = "TextDnaOutputLimitError";
  }
}

/** Карта свидетельств одной секции. sectionId добавляется клиентом. */
export interface TextDnaChunkEvidence {
  sectionId: string;
  entities: Array<{ name: string; aliases: string[] }>;
  evidence: Array<{
    subject: string;
    category: string;
    text: string;
    sourceQuote: string;
  }>;
  sharedContext: string[];
  relations: string[];
  unmappedMaterial: string[];
}

export interface TextDnaParticipantIndex {
  key: string;
  name: string;
  aliases: string[];
}

export interface TextDnaSingleIndex {
  mode: "single";
  character: TextDnaParticipantIndex;
  session: TextDnaSessionData;
  preservedMaterial: string[];
}

export interface TextDnaGroupIndex {
  mode: "group";
  scene: TextDnaSceneData;
  characters: TextDnaParticipantIndex[];
  relations: TextDnaRelation[];
  preservedMaterial: string[];
}

export type TextDnaSynthesisIndex = TextDnaSingleIndex | TextDnaGroupIndex;

/**
 * Оперативный кэш одной задачи. Он живёт только в памяти модального окна.
 * В нём нет API-ключа и нет записи в localStorage/IndexedDB.
 */
export interface TextDnaTask {
  fingerprint: string;
  mode: TextDnaMode;
  sourceLength: number;
  sections: TextDnaSourceSection[];
  evidence: TextDnaChunkEvidence[];
  /** Частичные индексы остаются до merge и позволяют не начинать заново. */
  indexFragments?: TextDnaSynthesisIndex[];
  index?: TextDnaSynthesisIndex;
  cards: Record<string, TextDnaCharacter>;
  payload?: TextDnaPayload;
  corrected: boolean;
}

export interface ExtractTextDnaOptions {
  /** Передайте текущую задачу для возобновления после ошибки финального этапа. */
  task?: TextDnaTask;
}

interface StructuredRequestResult<T> {
  value: T;
  corrected: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(
  value: unknown,
  path: string,
  issues: string[],
  options: { required?: boolean } = {}
): string[] {
  if (value === undefined && !options.required) return [];
  if (!Array.isArray(value)) {
    issues.push(`${path}: ожидается массив строк`);
    return [];
  }

  const result: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      issues.push(`${path}[${index}]: ожидается строка`);
      return;
    }
    const text = item.trim();
    if (text) result.push(text);
  });
  return result;
}

function normalizeStats(
  value: unknown,
  path: string,
  issues: string[]
): RelationshipStats {
  if (value === undefined) return { ...DEFAULT_STATS };
  if (!isRecord(value)) {
    issues.push(`${path}: ожидается объект стартовых шкал`);
    return { ...DEFAULT_STATS };
  }

  const result: RelationshipStats = { ...DEFAULT_STATS };
  for (const key of ["trust", "affection", "closeness", "tension", "conflict"] as const) {
    if (!hasOwn(value, key)) continue;
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      issues.push(`${path}.${key}: ожидается число`);
      continue;
    }
    result[key] = Math.min(100, Math.max(0, Math.round(raw)));
  }

  if (hasOwn(value, "attraction")) {
    const raw = value.attraction;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      issues.push(`${path}.attraction: ожидается число`);
    } else {
      result.attraction = Math.min(100, Math.max(0, Math.round(raw)));
    }
  }

  if (hasOwn(value, "statusTitle")) {
    if (typeof value.statusTitle !== "string") {
      issues.push(`${path}.statusTitle: ожидается строка`);
    } else if (value.statusTitle.trim()) {
      result.statusTitle = value.statusTitle.trim();
    }
  }

  return result;
}

function normalizeLorebook(
  value: unknown,
  path: string,
  issues: string[]
): TextDnaLoreDraft[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${path}: ожидается массив записей`);
    return [];
  }

  const result: TextDnaLoreDraft[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push(`${path}[${index}]: ожидается объект записи`);
      return;
    }
    const content = nonEmptyString(item.content);
    if (!content) {
      issues.push(`${path}[${index}].content: запись не может быть пустой`);
      return;
    }
    result.push({
      keys: normalizeStringArray(item.keys, `${path}[${index}].keys`, issues),
      content,
    });
  });
  return result;
}

function normalizeCharacter(
  value: unknown,
  path: string,
  issues: string[],
  requireKey: boolean
): TextDnaCharacter {
  if (!isRecord(value)) {
    issues.push(`${path}: ожидается объект персонажа`);
    return emptyTextDnaCharacter();
  }

  const name = nonEmptyString(value.name);
  if (!name) issues.push(`${path}.name: имя обязательно`);

  let key: string | undefined;
  if (requireKey || hasOwn(value, "key")) {
    key = nonEmptyString(value.key);
    if (requireKey && !key) issues.push(`${path}.key: ключ обязателен для групповых отношений`);
  }

  const stringFields = [
    "tagline",
    "age",
    "genre",
    "firstImpression",
    "startingPoint",
    "summaryQuote",
    "description",
    "personality",
    "scenario",
    "systemPrompt",
    "firstMessage",
  ] as const;
  for (const field of stringFields) {
    if (
      hasOwn(value, field) &&
      typeof value[field] !== "string" &&
      typeof value[field] !== "number"
    ) {
      issues.push(`${path}.${field}: ожидается строка`);
    }
  }

  return {
    ...(key ? { key } : {}),
    name,
    tagline: asString(value.tagline).trim(),
    age: asString(value.age).trim(),
    genre: asString(value.genre).trim(),
    tags: normalizeStringArray(value.tags, `${path}.tags`, issues),
    firstImpression: asString(value.firstImpression).trim(),
    startingPoint: asString(value.startingPoint).trim(),
    summaryQuote: asString(value.summaryQuote).trim(),
    description: asString(value.description).trim(),
    personality: asString(value.personality).trim(),
    scenario: asString(value.scenario).trim(),
    systemPrompt: asString(value.systemPrompt).trim(),
    firstMessage: asString(value.firstMessage).trim(),
    alternateGreetings: normalizeStringArray(
      value.alternateGreetings,
      `${path}.alternateGreetings`,
      issues
    ),
    initialStats: normalizeStats(value.initialStats, `${path}.initialStats`, issues),
    lorebook: normalizeLorebook(value.lorebook, `${path}.lorebook`, issues),
    preservedMaterial: normalizeStringArray(
      value.preservedMaterial,
      `${path}.preservedMaterial`,
      issues
    ),
  };
}

function emptyTextDnaCharacter(): TextDnaCharacter {
  return {
    name: "",
    tagline: "",
    age: "",
    genre: "",
    tags: [],
    firstImpression: "",
    startingPoint: "",
    summaryQuote: "",
    description: "",
    personality: "",
    scenario: "",
    systemPrompt: "",
    firstMessage: "",
    alternateGreetings: [],
    initialStats: { ...DEFAULT_STATS },
    lorebook: [],
    preservedMaterial: [],
  };
}

function normalizeSession(
  value: unknown,
  path: string,
  issues: string[]
): TextDnaSessionData {
  const source = value === undefined ? {} : value;
  if (!isRecord(source)) issues.push(`${path}: ожидается объект данных сессии`);
  const record = isRecord(source) ? source : {};
  for (const field of ["title", "summary", "directorNotes"] as const) {
    if (hasOwn(record, field) && typeof record[field] !== "string") {
      issues.push(`${path}.${field}: ожидается строка`);
    }
  }
  return {
    title: asString(record.title).trim(),
    summary: asString(record.summary).trim(),
    directorNotes: asString(record.directorNotes).trim(),
    preservedMaterial: normalizeStringArray(
      record.preservedMaterial,
      `${path}.preservedMaterial`,
      issues
    ),
  };
}

function normalizeScene(
  value: unknown,
  path: string,
  issues: string[]
): TextDnaSceneData {
  if (!isRecord(value)) {
    issues.push(`${path}: общая сцена обязательна`);
    return {
      title: "",
      setting: "",
      premise: "",
      currentMoment: "",
      tone: "",
      opening: "",
      summary: "",
      directorNotes: "",
      preservedMaterial: [],
    };
  }

  const fields = [
    "title",
    "setting",
    "premise",
    "currentMoment",
    "tone",
    "opening",
    "summary",
    "directorNotes",
  ] as const;
  for (const field of fields) {
    if (hasOwn(value, field) && typeof value[field] !== "string") {
      issues.push(`${path}.${field}: ожидается строка`);
    }
  }

  return {
    title: asString(value.title).trim(),
    setting: asString(value.setting).trim(),
    premise: asString(value.premise).trim(),
    currentMoment: asString(value.currentMoment).trim(),
    tone: asString(value.tone).trim(),
    opening: asString(value.opening).trim(),
    summary: asString(value.summary).trim(),
    directorNotes: asString(value.directorNotes).trim(),
    preservedMaterial: normalizeStringArray(
      value.preservedMaterial,
      `${path}.preservedMaterial`,
      issues
    ),
  };
}

/**
 * Преобразует coverage старого формата и нового semantic-формата в единый
 * клиентский результат. Полный массив обязателен; неполный не маскируется
 * позиционным восстановлением.
 */
function normalizeCoverage(
  value: unknown,
  sections: TextDnaSourceSection[],
  path: string,
  issues: string[]
): TextDnaCoverage[] {
  if (!Array.isArray(value)) {
    issues.push(`${path}: нужно покрытие каждой секции исходника`);
    return [];
  }

  if (value.length !== sections.length) {
    issues.push(
      `${path}: получено ${value.length} записей вместо ${sections.length}; неполное покрытие не принимается`
    );
  }

  const known = new Map(sections.map((section) => [section.id, section]));
  const seen = new Set<string>();
  const result: TextDnaCoverage[] = [];

  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push(`${path}[${index}]: ожидается объект покрытия`);
      return;
    }

    const declaredIdValue = item.sectionId;
    const sourceStart = item.sourceStart;
    const sourceEnd = item.sourceEnd;
    if (declaredIdValue !== undefined && typeof declaredIdValue !== "string") {
      issues.push(`${path}[${index}].sectionId: ожидается строка или отсутствие поля`);
    }
    const declaredId = nonEmptyString(declaredIdValue);
    const hasStart = sourceStart !== undefined;
    const hasEnd = sourceEnd !== undefined;
    const validStart = typeof sourceStart === "number" && Number.isFinite(sourceStart);
    const validEnd = typeof sourceEnd === "number" && Number.isFinite(sourceEnd);

    // Старый/совместимый ответ: непустой технический id обязан быть известен.
    // Нельзя тихо заменить чужой id только совпавшим диапазоном.
    if (declaredId && !known.has(declaredId)) {
      issues.push(`${path}[${index}].sectionId: неизвестная секция «${declaredId}»`);
      return;
    }

    const declaredSection = declaredId ? known.get(declaredId) : undefined;
    const rangeSection =
      !declaredId && validStart && validEnd
        ? sections.find(
            (section) =>
              section.start === sourceStart &&
              section.end === sourceEnd &&
              !seen.has(section.id)
          )
        : undefined;

    // Новый semantic-формат не содержит ни id, ни offsets. Позиция допустима
    // только как связь полного массива с полным клиентским списком секций.
    const positionalSection =
      !declaredId && !rangeSection && value.length === sections.length
        ? sections[index]
        : undefined;
    const section = declaredSection ?? rangeSection ?? positionalSection;

    if (!section) {
      issues.push(
        `${path}[${index}]: невозможно безопасно связать запись с исходной секцией`
      );
      return;
    }

    if (seen.has(section.id)) {
      issues.push(`${path}[${index}].sectionId: секция повторена`);
      return;
    }

    if (
      (hasStart && !validStart) ||
      (hasEnd && !validEnd) ||
      (validStart && sourceStart !== section.start) ||
      (validEnd && sourceEnd !== section.end) ||
      (validStart && validEnd && sourceStart > sourceEnd)
    ) {
      issues.push(`${path}[${index}]: диапазон не соответствует секции ${section.id}`);
    }

    const retainedFacts = normalizeStringArray(
      item.retainedFacts,
      `${path}[${index}].retainedFacts`,
      issues,
      { required: true }
    );
    if (retainedFacts.length === 0) {
      issues.push(
        `${path}[${index}].retainedFacts: секция не может считаться покрытой без сохранённых сведений`
      );
    }

    seen.add(section.id);
    result.push({
      sectionId: section.id,
      sourceStart: section.start,
      sourceEnd: section.end,
      retainedFacts,
    });
  });

  for (const section of sections) {
    if (!seen.has(section.id)) {
      issues.push(`${path}: отсутствует секция ${section.id}; это означает неполный импорт`);
    }
  }

  return result;
}

function normalizeParticipantIndex(
  value: unknown,
  path: string,
  issues: string[],
  required = true
): TextDnaParticipantIndex {
  if (!isRecord(value)) {
    if (required) issues.push(`${path}: ожидается участник`);
    return { key: "", name: "", aliases: [] };
  }
  const key = nonEmptyString(value.key);
  const name = nonEmptyString(value.name);
  if (required && !key) issues.push(`${path}.key: ключ обязателен`);
  if (required && !name) issues.push(`${path}.name: имя обязательно`);
  return {
    key,
    name,
    aliases: normalizeStringArray(value.aliases, `${path}.aliases`, issues),
  };
}

function normalizeRelations(
  value: unknown,
  keys: Set<string>,
  path: string,
  issues: string[],
  allowUnknownKeys = false
): TextDnaRelation[] {
  if (!Array.isArray(value)) {
    issues.push(`${path}: ожидается массив связей`);
    return [];
  }
  const result: TextDnaRelation[] = [];
  const signatures = new Set<string>();
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push(`${path}[${index}]: ожидается объект связи`);
      return;
    }
    const fromKey = nonEmptyString(item.fromKey);
    const toKey = nonEmptyString(item.toKey);
    const text = nonEmptyString(item.text);
    if (
      (!allowUnknownKeys && (!keys.has(fromKey) || !keys.has(toKey))) ||
      fromKey === toKey
    ) {
      issues.push(`${path}[${index}]: ссылки должны вести на разных участников сцены`);
    }
    if (!text) issues.push(`${path}[${index}].text: связь не может быть пустой`);
    const signature = `${fromKey}->${toKey}`;
    if (signatures.has(signature)) issues.push(`${path}[${index}]: связь повторена`);
    signatures.add(signature);
    result.push({ fromKey, toKey, text });
  });
  return result;
}

function normalizeSynthesisIndex(
  raw: unknown,
  mode: TextDnaMode,
  allowPartial = false
): { value?: TextDnaSynthesisIndex; issues: string[] } {
  const issues: string[] = [];
  if (!isRecord(raw)) return { issues: ["Индекс сведения не является JSON-объектом"] };
  if (raw.mode !== mode) issues.push(`mode: ожидался режим ${mode}`);

  const rootPreserved = normalizeStringArray(raw.preservedMaterial, "preservedMaterial", issues);

  if (mode === "single") {
    const character = normalizeParticipantIndex(
      raw.character,
      "character",
      issues,
      !allowPartial
    );
    const session = normalizeSession(raw.session, "session", issues);
    if (issues.length > 0) return { issues };
    return {
      value: {
        mode: "single",
        character,
        session,
        preservedMaterial: rootPreserved,
      },
      issues,
    };
  }

  const scene = normalizeScene(raw.scene, "scene", issues);
  if (!Array.isArray(raw.characters)) {
    issues.push("characters: нужен массив основных участников");
  }
  const rawCharacters = Array.isArray(raw.characters) ? raw.characters : [];
  if ((!allowPartial && rawCharacters.length < 2) || rawCharacters.length > 4) {
    issues.push(
      `characters: поддерживается ${allowPartial ? "не более 4" : "2–4"} участников, получено ${rawCharacters.length}`
    );
  }
  const characters = rawCharacters.map((item, index) =>
    normalizeParticipantIndex(item, `characters[${index}]`, issues, !allowPartial)
  );
  const keys = new Set<string>();
  const names = new Set<string>();
  characters.forEach((character, index) => {
    if (character.key && keys.has(character.key)) {
      issues.push(`characters[${index}].key: ключи должны быть уникальны`);
    }
    if (character.name && names.has(character.name.toLocaleLowerCase("ru-RU"))) {
      issues.push(`characters[${index}].name: имена должны быть уникальны`);
    }
    if (character.key) keys.add(character.key);
    if (character.name) names.add(character.name.toLocaleLowerCase("ru-RU"));
  });
  const relations = normalizeRelations(
    raw.relations,
    keys,
    "relations",
    issues,
    allowPartial
  );

  if (issues.length > 0) return { issues };
  return {
    value: {
      mode: "group",
      scene,
      characters,
      relations,
      preservedMaterial: rootPreserved,
    },
    issues,
  };
}

function validatePayload(
  raw: unknown,
  mode: TextDnaMode,
  sections: TextDnaSourceSection[]
): { payload?: TextDnaPayload; issues: string[] } {
  const issues: string[] = [];
  if (!isRecord(raw)) return { issues: ["Ответ не является JSON-объектом"] };
  if (raw.mode !== mode) issues.push(`mode: ожидался режим ${mode}`);

  const coverage = normalizeCoverage(raw.coverage, sections, "coverage", issues);
  const rootPreserved = normalizeStringArray(raw.preservedMaterial, "preservedMaterial", issues);

  if (mode === "single") {
    const character = normalizeCharacter(raw.character, "character", issues, false);
    const session = normalizeSession(raw.session, "session", issues);
    if (!character.name) issues.push("character.name: безымянный результат нельзя применить");
    if (issues.length > 0) return { issues };
    return {
      payload: {
        mode: "single",
        character,
        session,
        preservedMaterial: rootPreserved,
        coverage,
      },
      issues,
    };
  }

  const scene = normalizeScene(raw.scene, "scene", issues);
  if (!Array.isArray(raw.characters)) issues.push("characters: нужен массив участников");
  const rawCharacters = Array.isArray(raw.characters) ? raw.characters : [];
  if (rawCharacters.length < 2 || rawCharacters.length > 4) {
    issues.push(`characters: поддерживается 2–4 участника, получено ${rawCharacters.length}`);
  }
  const characters = rawCharacters.map((item, index) =>
    normalizeCharacter(item, `characters[${index}]`, issues, true)
  );
  const keys = new Set<string>();
  const names = new Set<string>();
  characters.forEach((character, index) => {
    const key = character.key ?? "";
    const name = character.name.toLocaleLowerCase("ru-RU");
    if (key && keys.has(key)) issues.push(`characters[${index}].key: ключи должны быть уникальны`);
    if (name && names.has(name)) issues.push(`characters[${index}].name: имена должны быть уникальны`);
    if (key) keys.add(key);
    if (name) names.add(name);
  });
  const relations = normalizeRelations(raw.relations, keys, "relations", issues);

  if (issues.length > 0) return { issues };
  return {
    payload: {
      mode: "group",
      scene,
      characters,
      relations,
      preservedMaterial: rootPreserved,
      coverage,
    },
    issues,
  };
}

function fingerprintSource(source: string): string {
  // Быстрый FNV-подобный отпечаток: он нужен только для инвалидирования
  // оперативного кэша, а не для хранения или передачи исходника.
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${source.length}:${hash >>> 0}`;
}

export function createTextDnaTask(source: string, mode: TextDnaMode): TextDnaTask {
  const sections = splitTextForTextDna(source);
  return {
    fingerprint: fingerprintSource(source),
    mode,
    sourceLength: source.length,
    sections,
    evidence: [],
    cards: {},
    corrected: false,
  };
}

export function isTextDnaTaskCompatible(
  task: TextDnaTask | null | undefined,
  source: string,
  mode: TextDnaMode
): task is TextDnaTask {
  return Boolean(
    task &&
      task.mode === mode &&
      task.sourceLength === source.length &&
      task.fingerprint === fingerprintSource(source)
  );
}

function isContextFailure(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /context|контекст|too many tokens|token limit|maximum context|context_length|лимит токенов|слишком длин/i.test(
    message
  );
}

function diagnosticsFromMetadata(
  stage: string,
  attempt: number,
  kind: TextDnaFailureKind,
  metadata?: V2ResponseMetadata,
  issueCount?: number
): TextDnaDiagnostics {
  return {
    stage,
    attempt,
    kind,
    ...(metadata?.finishReason ? { finishReason: metadata.finishReason } : {}),
    ...(metadata?.usage ? { usage: metadata.usage } : {}),
    ...(metadata?.rawTextLength !== undefined ? { outputChars: metadata.rawTextLength } : {}),
    ...(issueCount !== undefined ? { issueCount } : {}),
  };
}

function logDiagnostics(diagnostics: TextDnaDiagnostics): void {
  // Только технические метаданные. Исходник, prompt и ответ модели намеренно
  // не попадают в лог браузера.
  console.warn("[Text DNA] этап завершился ошибкой", diagnostics);
}

function compactPreviousResponse(raw: string): string {
  if (raw.length <= TEXT_DNA_CORRECTION_MAX_CHARS) return raw;
  const half = Math.floor(TEXT_DNA_CORRECTION_MAX_CHARS / 2);
  return `${raw.slice(0, half)}\n…[середина ответа опущена]…\n${raw.slice(-half)}`;
}

export function buildTextDnaCorrectionPrompt(
  schemaHint: string,
  previous: string,
  issues: string[]
): string {
  return [
    "Text DNA: исправь только предыдущий ответ.",
    "Верни один полный JSON по краткой схеме ниже, без Markdown и пояснений.",
    `Ошибки проверки: ${issues.slice(0, 12).join("; ") || "ответ не разобран как JSON"}`,
    `Краткая ожидаемая схема:\n${schemaHint}`,
    `Предыдущий ответ модели:\n${compactPreviousResponse(previous)}`,
    "Не добавляй технические id или offsets исходника: их назначает клиент.",
  ].join("\n\n");
}

function formatFailureMessage(
  stage: string,
  kind: TextDnaFailureKind,
  issues: string[] = []
): string {
  if (kind === "output_limit" || kind === "incomplete_json") {
    return `Этап «${stage}» оборвался на ограничении длины ответа. Уже завершённые этапы сохранены в памяти задачи; повтор не отправит секции заново. Уменьшите объём одной карточки или выберите модель с большим выходным лимитом.`;
  }
  if (kind === "empty_response") {
    return `Этап «${stage}» получил пустой ответ модели. Исходный текст остался в окне, частичные данные не применены.`;
  }
  if (kind === "no_json") {
    return `Этап «${stage}» получил текст вместо JSON. Исходный текст остался в окне, частичные данные не применены.`;
  }
  if (kind === "invalid_json") {
    return `Этап «${stage}» получил повреждённый JSON. Автоматическая попытка исправления не помогла; исходный текст остался в окне.`;
  }
  if (kind === "schema") {
    return `Этап «${stage}» вернул JSON, который не соответствует схеме: ${issues
      .slice(0, 4)
      .join("; ")}. Исходный текст остался в окне.`;
  }
  if (kind === "context") {
    return `Исходный материал не помещается в контекст выбранной модели на этапе «${stage}». Текст не был обрезан и ничего не сохранено.`;
  }
  return `Этап «${stage}» не завершился. Исходный текст остался в окне, частичные данные не применены.`;
}

async function requestStructured<T>(
  apiConfig: ApiConfig,
  prompt: string,
  validate: (value: unknown) => { value?: T; issues: string[] },
  label: string,
  schemaHint: string,
  maxTokens: number
): Promise<StructuredRequestResult<T>> {
  let turns: Array<{ role: "user"; content: string }> = [{ role: "user", content: prompt }];
  let previous = "";
  let issues: string[] = [];

  for (let attempt = 1; attempt <= TEXT_DNA_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await requestV2JsonDetailed(apiConfig, turns, maxTokens);
      previous = response.rawText;
      const checked = validate(response.value);

      if (checked.value !== undefined && checked.issues.length === 0) {
        return { value: checked.value, corrected: attempt > 1 };
      }

      issues = checked.issues;
      const diagnostics = diagnosticsFromMetadata(
        label,
        attempt,
        "schema",
        response.metadata,
        issues.length
      );
      logDiagnostics(diagnostics);

      const nonRecoverableComposition = issues.some((issue) =>
        /поддерживается (2–4|не более 4).*получено/i.test(issue)
      );
      if (attempt < TEXT_DNA_MAX_ATTEMPTS && !nonRecoverableComposition) {
        turns = [
          {
            role: "user",
            content: buildTextDnaCorrectionPrompt(schemaHint, previous, issues),
          },
        ];
        continue;
      }

      throw new TextDnaError(
        formatFailureMessage(label, "schema", issues),
        "schema",
        diagnostics
      );
    } catch (cause) {
      if (cause instanceof TextDnaError) throw cause;

      if (isContextFailure(cause)) {
        const diagnostics = diagnosticsFromMetadata(label, attempt, "context");
        logDiagnostics(diagnostics);
        throw new TextDnaContextError(formatFailureMessage(label, "context"), diagnostics);
      }

      if (cause instanceof V2OutputLimitError) {
        const diagnostics = diagnosticsFromMetadata(
          label,
          attempt,
          "output_limit",
          cause.metadata
        );
        logDiagnostics(diagnostics);
        throw new TextDnaOutputLimitError(
          formatFailureMessage(label, "output_limit"),
          diagnostics
        );
      }

      if (cause instanceof V2JsonError) {
        const kind: TextDnaFailureKind =
          cause.kind === "empty"
            ? "empty_response"
            : cause.kind === "no_json"
            ? "no_json"
            : cause.kind === "incomplete_json"
            ? "incomplete_json"
            : cause.kind;
        const diagnostics = diagnosticsFromMetadata(label, attempt, kind, cause.metadata);
        logDiagnostics(diagnostics);

        // Пустой и явно оборванный ответ не исправляем повторным большим
        // запросом. Некорректный, но завершённый JSON получает ровно один
        // компактный correction без исходного prompt.
        if (kind === "empty_response" || kind === "incomplete_json" || kind === "output_limit") {
          throw new TextDnaError(formatFailureMessage(label, kind), kind, diagnostics);
        }

        previous = cause.rawText ?? previous;
        issues = [
          kind === "no_json"
            ? "ответ не содержит JSON-объекта"
            : "ответ содержит повреждённый JSON",
        ];
        if (attempt < TEXT_DNA_MAX_ATTEMPTS) {
          turns = [
            {
              role: "user",
              content: buildTextDnaCorrectionPrompt(schemaHint, previous, issues),
            },
          ];
          continue;
        }
        throw new TextDnaError(formatFailureMessage(label, kind), kind, diagnostics);
      }

      if (cause instanceof V2ProviderError) {
        const diagnostics = diagnosticsFromMetadata(label, attempt, "provider", cause.metadata);
        logDiagnostics(diagnostics);
        throw new TextDnaError(
          `Провайдер не вернул результат на этапе «${label}»: ${cause.message.slice(0, 240)}`,
          "provider",
          diagnostics
        );
      }

      const diagnostics = diagnosticsFromMetadata(label, attempt, "api");
      logDiagnostics(diagnostics);
      throw new TextDnaError(
        cause instanceof Error
          ? cause.message.slice(0, 400)
          : `Ошибка API на этапе «${label}»`,
        "api",
        diagnostics
      );
    }
  }

  throw new TextDnaError(formatFailureMessage(label, "unknown"), "unknown");
}

/**
 * Делит строку на секции, не удаляя ни одного символа. Проверка join() в
 * тестах гарантирует, что слой не повторяет ошибку «обрезать по лимиту и
 * потерять хвост».
 */
export function splitTextForTextDna(
  source: string,
  limit = TEXT_DNA_CHUNK_CHARS
): TextDnaSourceSection[] {
  if (!source) return [];
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("Лимит секции Text DNA должен быть положительным числом.");
  }

  const sections: TextDnaSourceSection[] = [];
  let start = 0;
  let index = 1;
  const minBoundary = Math.floor(limit * 0.55);

  while (start < source.length) {
    let end = Math.min(source.length, start + Math.floor(limit));

    if (end < source.length) {
      const candidates = [
        { at: source.lastIndexOf("\n\n", end), size: 2 },
        { at: source.lastIndexOf("\n", end), size: 1 },
        { at: source.lastIndexOf(". ", end), size: 1 },
        { at: source.lastIndexOf("! ", end), size: 1 },
        { at: source.lastIndexOf("? ", end), size: 1 },
      ];
      const boundary = candidates
        .filter((candidate) => candidate.at >= start + minBoundary)
        .sort((a, b) => b.at - a.at)[0];
      if (boundary) end = boundary.at + boundary.size;
    }

    if (end <= start) end = Math.min(source.length, start + Math.floor(limit));

    sections.push({
      id: `source-${index}`,
      start,
      end,
      text: source.slice(start, end),
    });
    start = end;
    index += 1;
  }

  return sections;
}

const EXTRACTION_RULES = `
Ты работаешь в режиме Text DNA для NOCTURNE. Пользователь уже написал или получил этот материал в другой LLM. Твоя роль — аналитик и структурировщик, а не автор нового персонажа.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
1. Извлекай факты из SOURCE MATERIAL. Не запускай Character DNA, не выбирай пресеты, архетипы, каталоги и не «улучшай» героя по своему вкусу.
2. Не меняй имена, возраст, внешность, характер, биографию, мотивацию, отношения, тайны, ограничения, авторские правила, диалоги и приветствия. Сохраняй важные формулировки максимально близко к оригиналу.
3. Не придумывай отсутствующие сведения. Не заполняй пробелы правдоподобными деталями. Для отсутствующего поля возвращай пустую строку, пустой массив или DEFAULT_STATS только для технических шкал отношений.
4. Не сглаживай противоречия. Если в тексте есть две версии факта, сохрани обе с оговоркой о противоречии в подходящем текстовом поле или preservedMaterial.
5. Различай объективный факт, слух, догадку и субъективное мнение персонажа. Не превращай слух в факт мира.
6. Общие правила сцены оставляй общими, индивидуальные секреты и знания — только у соответствующего персонажа. Не смешивай персонажей.
7. Не выбрасывай сведения, для которых нет отдельного поля: положи их дословно в preservedMaterial, systemPrompt, scenario, directorNotes или lorebook по назначению. Не клади огромный один и тот же текст во все поля.
8. Если текст содержит несколько людей, в group выбери только фактических основных действующих участников. Не включай автоматически людей, упомянутых в биографии, воспоминаниях, слухах или примерах.
9. Не переводи и не локализуй исходник без прямой просьбы: сохраняй язык, имена, авторские термины, форматирование и голос.
10. Ответ должен быть только JSON ожидаемой схемы. Никаких Markdown, вступлений, комментариев или генерации нового содержания.
`;

function semanticCoverageInstruction(sectionCount: number): string {
  return `В semantic coverage верни ровно ${sectionCount} записей по порядку секций. Каждая запись содержит только retainedFacts — список реально сохранённых фактов, правил, диалогов или остатков. НЕ возвращай sectionId, id, sourceStart, sourceEnd и никакие offsets: эти технические поля назначает клиент. Полный массив обязателен; пропущенная запись означает неполный импорт.`;
}

const SHORT_SINGLE_SCHEMA =
  '{"mode":"single","character":{"name":"","tagline":"","age":"","genre":"","tags":[],"firstImpression":"","startingPoint":"","summaryQuote":"","description":"","personality":"","scenario":"","systemPrompt":"","firstMessage":"","alternateGreetings":[],"initialStats":{"trust":50,"affection":30,"closeness":20,"tension":10,"conflict":0,"statusTitle":"Знакомство"},"lorebook":[{"keys":[],"content":""}],"preservedMaterial":[]},"session":{"title":"","summary":"","directorNotes":"","preservedMaterial":[]},"preservedMaterial":[],"coverage":[{"retainedFacts":[]}]}';

const SHORT_GROUP_SCHEMA =
  '{"mode":"group","scene":{"title":"","setting":"","premise":"","currentMoment":"","tone":"","opening":"","summary":"","directorNotes":"","preservedMaterial":[]},"characters":[{"key":"","name":"","aliases":[],"tagline":"","age":"","genre":"","tags":[],"firstImpression":"","startingPoint":"","summaryQuote":"","description":"","personality":"","scenario":"","systemPrompt":"","firstMessage":"","alternateGreetings":[],"initialStats":{"trust":50,"affection":30,"closeness":20,"tension":10,"conflict":0,"statusTitle":"Знакомство"},"lorebook":[],"preservedMaterial":[]}],"relations":[{"fromKey":"","toKey":"","text":""}],"preservedMaterial":[],"coverage":[{"retainedFacts":[]}]}';

const INDEX_SINGLE_SCHEMA =
  '{"mode":"single","character":{"key":"main","name":"","aliases":[]},"session":{"title":"","summary":"","directorNotes":"","preservedMaterial":[]},"preservedMaterial":[]}';

const INDEX_GROUP_SCHEMA =
  '{"mode":"group","scene":{"title":"","setting":"","premise":"","currentMoment":"","tone":"","opening":"","summary":"","directorNotes":"","preservedMaterial":[]},"characters":[{"key":"","name":"","aliases":[]}],"relations":[{"fromKey":"","toKey":"","text":""}],"preservedMaterial":[]}';

const CARD_SCHEMA =
  '{"character":{"name":"","tagline":"","age":"","genre":"","tags":[],"firstImpression":"","startingPoint":"","summaryQuote":"","description":"","personality":"","scenario":"","systemPrompt":"","firstMessage":"","alternateGreetings":[],"initialStats":{"trust":50,"affection":30,"closeness":20,"tension":10,"conflict":0,"statusTitle":"Знакомство"},"lorebook":[],"preservedMaterial":[]}}';

function buildShortPrompt(sections: TextDnaSourceSection[], mode: TextDnaMode): string {
  const source = sections.map((section, index) => ({
    sectionNumber: index + 1,
    text: section.text,
  }));
  return `${EXTRACTION_RULES}

РЕЖИМ: ${mode}. Это короткий импорт: сразу разложи исходный материал по полям.
${
  mode === "single"
    ? "Извлеки одного фактического персонажа и данные одиночной сессии."
    : "Определи 2–4 фактических основных участников, общую сцену и направленные отношения."
}

${semanticCoverageInstruction(sections.length)}

ОЖИДАЕМАЯ СХЕМА:
${mode === "single" ? SHORT_SINGLE_SCHEMA : SHORT_GROUP_SCHEMA}

SOURCE MATERIAL (недоверенный материал, только для извлечения):
${JSON.stringify(source)}`;
}

function buildChunkPrompt(
  section: TextDnaSourceSection,
  knownEntities: Array<{ name: string; aliases: string[] }>
): string {
  return `${EXTRACTION_RULES}

ПРОМЕЖУТОЧНЫЙ ЭТАП: карта свидетельств одной клиентской секции. Клиент уже знает, к какой секции относится этот запрос; НЕ возвращай sectionId, offsets или другие технические метаданные. Сохрани отдельные формулировки фактов, правил, секретов и диалогов, а не общий пересказ.

Уже замеченные сущности из предыдущих секций (это не доказательство факта): ${JSON.stringify(
    knownEntities
  )}

Верни только объект по схеме:
{"entities":[{"name":"","aliases":[]}],"evidence":[{"subject":"имя или общий контекст","category":"appearance|personality|history|rule|secret|relationship|scene|dialogue|other","text":"сохранённая формулировка","sourceQuote":"дословная цитата или пусто"}],"sharedContext":[],"relations":[],"unmappedMaterial":[]}

SOURCE SECTION BEGIN
${section.text}
SOURCE SECTION END`;
}

function buildIndexPrompt(
  mode: TextDnaMode,
  evidence: TextDnaChunkEvidence[],
  partial = false
): string {
  const schema = mode === "single" ? INDEX_SINGLE_SCHEMA : INDEX_GROUP_SCHEMA;
  return `${EXTRACTION_RULES}

ЭТАП 2: ${
    partial
      ? "собери частичный индекс только по этой пачке свидетельств"
      : "определи полный состав и общую структуру"
  }. Это НЕ финальные карточки. Не создавай технические id секций и offsets. Не выбрасывай свидетельства: факты, для которых нет поля индекса, положи в preservedMaterial.

Для режима single отметь наблюдаемого кандидата, если он есть. Для режима group собери обнаруженных основных участников и связи; в частичном индексе может быть меньше двух участников, а окончательное решение будет принято отдельным merge-этапом. Упомянутых людей не включай автоматически.

ОЖИДАЕМАЯ СХЕМА:
${schema}

РЕЕСТР СВИДЕТЕЛЬСТВ ЭТОЙ ПАЧКИ:
${JSON.stringify(evidence)}`;
}

function buildIndexMergePrompt(
  mode: TextDnaMode,
  fragments: TextDnaSynthesisIndex[]
): string {
  const schema = mode === "single" ? INDEX_SINGLE_SCHEMA : INDEX_GROUP_SCHEMA;
  return `${EXTRACTION_RULES}

ЭТАП 2B: объедини несколько уже проверенных частичных индексов в один полный индекс. Это компактные результаты предыдущих этапов, а не исходный текст. Не выдумывай факты и не теряй preservedMaterial, общие правила и отношения.

Для режима single выбери одного фактического персонажа. Для режима group выбери ровно 2–4 основных участников; исторических и просто упомянутых людей не добавляй. Проверь, что все relations ссылаются на реальные ключи.

ОЖИДАЕМАЯ СХЕМА:
${schema}

ЧАСТИЧНЫЕ ИНДЕКСЫ:
${JSON.stringify(fragments)}`;
}

function buildCardPrompt(
  mode: TextDnaMode,
  participant: TextDnaParticipantIndex,
  index: TextDnaSynthesisIndex,
  evidence: TextDnaChunkEvidence[]
): string {
  const shared = evidence.map((item) => ({
    sectionId: item.sectionId,
    sharedContext: item.sharedContext,
    relations: item.relations,
    unmappedMaterial: item.unmappedMaterial,
  }));
  const selected = evidence.map((item) => ({
    sectionId: item.sectionId,
    evidence: item.evidence,
  }));
  return `${EXTRACTION_RULES}

ЭТАП 3: собери одну индивидуальную карточку из уже проверенного индекса и относящихся к ней свидетельств. Не выдумывай, не меняй авторские формулировки и не добавляй key/id/offsets в ответ — key назначен клиентом. Всё, что нельзя безопасно разложить по полям, положи в character.preservedMaterial.

Режим: ${mode}
Текущий участник: ${JSON.stringify(participant)}
Общий индекс сцены/сессии: ${JSON.stringify(index)}
Отобранные свидетельства участника:
${JSON.stringify(selected)}
Общий контекст, связи и неразложенный материал:
${JSON.stringify(shared)}

Верни только объект по схеме:
${CARD_SCHEMA}`;
}

function validateChunkEvidence(
  value: unknown,
  section: TextDnaSourceSection
): { value?: TextDnaChunkEvidence; issues: string[] } {
  const issues: string[] = [];
  if (!isRecord(value)) return { issues: ["ответ секции не является объектом"] };

  // Для совместимости принимаем старый sectionId только как проверку, но
  // никогда не используем его для назначения секции.
  if (
    value.sectionId !== undefined &&
    nonEmptyString(value.sectionId) &&
    value.sectionId !== section.id
  ) {
    issues.push("sectionId: модель вернула чужой технический id");
  }

  const entitiesRaw = value.entities;
  if (entitiesRaw !== undefined && !Array.isArray(entitiesRaw)) {
    issues.push("entities: ожидается массив");
  }
  const entities: Array<{ name: string; aliases: string[] }> = [];
  (Array.isArray(entitiesRaw) ? entitiesRaw : []).forEach((item, index) => {
    if (!isRecord(item) || !nonEmptyString(item.name)) {
      issues.push(`entities[${index}]: нужно имя сущности`);
      return;
    }
    entities.push({
      name: nonEmptyString(item.name),
      aliases: normalizeStringArray(item.aliases, `entities[${index}].aliases`, issues),
    });
  });

  const evidenceRaw = value.evidence;
  if (evidenceRaw !== undefined && !Array.isArray(evidenceRaw)) {
    issues.push("evidence: ожидается массив");
  }
  const evidence: TextDnaChunkEvidence["evidence"] = [];
  (Array.isArray(evidenceRaw) ? evidenceRaw : []).forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push(`evidence[${index}]: ожидается объект`);
      return;
    }
    const text = nonEmptyString(item.text);
    if (!text) issues.push(`evidence[${index}].text: нельзя терять пустой факт`);
    evidence.push({
      subject: nonEmptyString(item.subject),
      category: nonEmptyString(item.category),
      text,
      sourceQuote: asString(item.sourceQuote).trim(),
    });
  });

  const sharedContext = normalizeStringArray(value.sharedContext, "sharedContext", issues);
  const relations = normalizeStringArray(value.relations, "relations", issues);
  const unmappedMaterial = normalizeStringArray(
    value.unmappedMaterial,
    "unmappedMaterial",
    issues
  );

  if (evidence.length === 0 && sharedContext.length === 0 && unmappedMaterial.length === 0) {
    issues.push("секция не содержит ни одного свидетельства; ответ неполный");
  }

  if (issues.length > 0) return { issues };
  return {
    value: {
      sectionId: section.id,
      entities,
      evidence,
      sharedContext,
      relations,
      unmappedMaterial,
    },
    issues,
  };
}

function combineKnownEntities(
  previous: Array<{ name: string; aliases: string[] }>,
  next: TextDnaChunkEvidence
): Array<{ name: string; aliases: string[] }> {
  const result = previous.map((entity) => ({ ...entity, aliases: [...entity.aliases] }));
  for (const incoming of next.entities) {
    const normalized = incoming.name.toLocaleLowerCase("ru-RU");
    const current = result.find(
      (entity) =>
        entity.name.toLocaleLowerCase("ru-RU") === normalized ||
        entity.aliases.some((alias) => alias.toLocaleLowerCase("ru-RU") === normalized)
    );
    if (!current) {
      result.push({ ...incoming, aliases: [...incoming.aliases] });
    } else {
      for (const alias of [incoming.name, ...incoming.aliases]) {
        if (!current.aliases.includes(alias) && current.name !== alias) current.aliases.push(alias);
      }
    }
  }
  return result;
}

async function collectEvidence(
  apiConfig: ApiConfig,
  task: TextDnaTask
): Promise<{ evidence: TextDnaChunkEvidence[]; corrected: boolean }> {
  const byId = new Map(task.evidence.map((item) => [item.sectionId, item]));
  let corrected = false;

  for (const section of task.sections) {
    const cached = byId.get(section.id);
    if (cached) continue;

    const knownEntities = task.sections
      .slice(0, task.sections.findIndex((item) => item.id === section.id))
      .map((item) => byId.get(item.id))
      .filter((item): item is TextDnaChunkEvidence => Boolean(item))
      .reduce(combineKnownEntities, []);

    const result = await requestStructured(
      apiConfig,
      buildChunkPrompt(section, knownEntities),
      (value) => validateChunkEvidence(value, section),
      `карта ${section.id}`,
      '{"entities":[],"evidence":[{"subject":"","category":"","text":"","sourceQuote":""}],"sharedContext":[],"relations":[],"unmappedMaterial":[]}',
      TEXT_DNA_CHUNK_OUTPUT_TOKENS
    );

    byId.set(section.id, result.value);
    task.evidence = task.sections
      .map((item) => byId.get(item.id))
      .filter((item): item is TextDnaChunkEvidence => Boolean(item));
    corrected ||= result.corrected;
    task.corrected ||= result.corrected;
  }

  task.evidence = task.sections
    .map((item) => byId.get(item.id))
    .filter((item): item is TextDnaChunkEvidence => Boolean(item));
  return { evidence: task.evidence, corrected };
}

function evidenceBatches(evidence: TextDnaChunkEvidence[]): TextDnaChunkEvidence[][] {
  const batches: TextDnaChunkEvidence[][] = [];
  let current: TextDnaChunkEvidence[] = [];
  let currentSize = 2;

  for (const item of evidence) {
    const itemSize = JSON.stringify(item).length + 1;
    if (current.length > 0 && currentSize + itemSize > TEXT_DNA_INDEX_BATCH_CHARS) {
      batches.push(current);
      current = [];
      currentSize = 2;
    }
    current.push(item);
    currentSize += itemSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function synthesizeIndex(
  apiConfig: ApiConfig,
  task: TextDnaTask
): Promise<{ index: TextDnaSynthesisIndex; corrected: boolean }> {
  if (task.index) return { index: task.index, corrected: false };

  const evidenceSize = JSON.stringify(task.evidence).length;
  if (evidenceSize <= TEXT_DNA_INDEX_INPUT_MAX_CHARS) {
    const result = await requestStructured(
      apiConfig,
      buildIndexPrompt(task.mode, task.evidence),
      (value) => normalizeSynthesisIndex(value, task.mode),
      "определение состава и сцены",
      task.mode === "single" ? INDEX_SINGLE_SCHEMA : INDEX_GROUP_SCHEMA,
      TEXT_DNA_INDEX_OUTPUT_TOKENS
    );
    task.index = result.value;
    task.indexFragments = [result.value];
    task.corrected ||= result.corrected;
    return { index: result.value, corrected: result.corrected };
  }

  const batches = evidenceBatches(task.evidence);
  const fragments = task.indexFragments ? [...task.indexFragments] : [];
  let corrected = false;

  for (let index = fragments.length; index < batches.length; index += 1) {
    const result = await requestStructured(
      apiConfig,
      buildIndexPrompt(task.mode, batches[index], true),
      (value) => normalizeSynthesisIndex(value, task.mode, true),
      `частичный индекс ${index + 1}/${batches.length}`,
      task.mode === "single" ? INDEX_SINGLE_SCHEMA : INDEX_GROUP_SCHEMA,
      TEXT_DNA_INDEX_OUTPUT_TOKENS
    );
    fragments[index] = result.value;
    task.indexFragments = [...fragments];
    corrected ||= result.corrected;
    task.corrected ||= result.corrected;
  }

  const merged = await requestStructured(
    apiConfig,
    buildIndexMergePrompt(task.mode, fragments),
    (value) => normalizeSynthesisIndex(value, task.mode),
    "сведение индекса состава и сцены",
    task.mode === "single" ? INDEX_SINGLE_SCHEMA : INDEX_GROUP_SCHEMA,
    TEXT_DNA_INDEX_OUTPUT_TOKENS
  );
  task.index = merged.value;
  task.indexFragments = fragments;
  corrected ||= merged.corrected;
  task.corrected ||= merged.corrected;
  return { index: merged.value, corrected };
}

function subjectMatches(
  subject: string,
  participant: TextDnaParticipantIndex
): boolean {
  const haystack = subject.toLocaleLowerCase("ru-RU");
  return [participant.name, participant.key, ...participant.aliases].some((needle) => {
    const normalized = needle.toLocaleLowerCase("ru-RU");
    return normalized.length > 0 && haystack.includes(normalized);
  });
}

function evidenceForParticipant(
  evidence: TextDnaChunkEvidence[],
  participant: TextDnaParticipantIndex,
  mode: TextDnaMode
): TextDnaChunkEvidence[] {
  if (mode === "single") return evidence;
  return evidence
    .map((section) => ({
      ...section,
      evidence: section.evidence.filter((item) => subjectMatches(item.subject, participant)),
    }))
    .filter((section) => section.evidence.length > 0);
}

async function synthesizeCards(
  apiConfig: ApiConfig,
  task: TextDnaTask,
  index: TextDnaSynthesisIndex
): Promise<{ cards: Record<string, TextDnaCharacter>; corrected: boolean }> {
  let corrected = false;
  const participants =
    index.mode === "single" ? [index.character] : index.characters;

  for (const participant of participants) {
    if (task.cards[participant.key]) continue;
    const selected = evidenceForParticipant(task.evidence, participant, index.mode);
    const result = await requestStructured(
      apiConfig,
      buildCardPrompt(task.mode, participant, index, selected),
      (value) => {
        const issues: string[] = [];
        if (!isRecord(value)) return { issues: ["ответ карточки не является объектом"] };
        const draft = normalizeCharacter(
          value.character ?? value,
          "character",
          issues,
          false
        );
        if (!draft.name) issues.push("character.name: имя обязательно");
        if (issues.length > 0) return { issues };
        return { value: draft, issues };
      },
      `карточка «${participant.name}»`,
      CARD_SCHEMA,
      TEXT_DNA_CARD_OUTPUT_TOKENS
    );
    task.cards[participant.key] = {
      ...result.value,
      ...(index.mode === "group" ? { key: participant.key } : {}),
    };
    corrected ||= result.corrected;
    task.corrected ||= result.corrected;
  }

  return { cards: task.cards, corrected };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function appendPreserved(base: string, fragments: string[], heading: string): string {
  const values = fragments.map((fragment) => fragment.trim()).filter(Boolean);
  if (values.length === 0) return base.trim();
  const addition = `${heading}\n${values.join("\n\n")}`;
  return base.trim() ? `${base.trim()}\n\n${addition}` : addition;
}

function buildEvidenceLedger(evidence: TextDnaChunkEvidence[]): string {
  const lines: string[] = [];
  for (const section of evidence) {
    lines.push(`[${section.sectionId}]`);
    for (const item of section.evidence) {
      const category = item.category ? ` · ${item.category}` : "";
      const quote = item.sourceQuote ? `\nЦитата: ${item.sourceQuote}` : "";
      lines.push(`${item.subject || "Общий контекст"}${category}: ${item.text}${quote}`);
    }
    for (const item of section.sharedContext) lines.push(`Общий контекст: ${item}`);
    for (const item of section.relations) lines.push(`Связь: ${item}`);
    for (const item of section.unmappedMaterial) lines.push(`Неразложенный материал: ${item}`);
  }
  return lines.join("\n");
}

function coverageFromEvidence(
  sections: TextDnaSourceSection[],
  evidence: TextDnaChunkEvidence[]
): TextDnaCoverage[] {
  const byId = new Map(evidence.map((item) => [item.sectionId, item]));
  return sections.map((section) => {
    const item = byId.get(section.id);
    const retainedFacts = item
      ? uniqueStrings([
          ...item.evidence.map((fact) => fact.text),
          ...item.sharedContext,
          ...item.relations,
          ...item.unmappedMaterial,
        ])
      : [];
    return {
      sectionId: section.id,
      sourceStart: section.start,
      sourceEnd: section.end,
      retainedFacts,
    };
  });
}

function addEvidenceLedgerToSingle(
  index: TextDnaSingleIndex,
  evidence: TextDnaChunkEvidence[]
): TextDnaSingleIndex {
  const ledger = buildEvidenceLedger(evidence);
  return {
    ...index,
    session: {
      ...index.session,
      directorNotes: appendPreserved(
        index.session.directorNotes,
        [ledger],
        "### РЕЕСТР СОХРАНЁННЫХ СВИДЕТЕЛЬСТВ TEXT DNA"
      ),
    },
  };
}

function addEvidenceLedgerToGroup(
  index: TextDnaGroupIndex,
  evidence: TextDnaChunkEvidence[]
): TextDnaGroupIndex {
  const ledger = buildEvidenceLedger(evidence);
  return {
    ...index,
    scene: {
      ...index.scene,
      directorNotes: appendPreserved(
        index.scene.directorNotes,
        [ledger],
        "### РЕЕСТР СОХРАНЁННЫХ СВИДЕТЕЛЬСТВ TEXT DNA"
      ),
    },
  };
}

function assembleLongPayload(
  task: TextDnaTask,
  index: TextDnaSynthesisIndex,
  cards: Record<string, TextDnaCharacter>
): TextDnaPayload {
  const coverage = coverageFromEvidence(task.sections, task.evidence);
  if (index.mode === "single") {
    const safeIndex = addEvidenceLedgerToSingle(index, task.evidence);
    const card = cards[index.character.key];
    return {
      mode: "single",
      character: card,
      session: safeIndex.session,
      preservedMaterial: safeIndex.preservedMaterial,
      coverage,
    };
  }

  const safeIndex = addEvidenceLedgerToGroup(index, task.evidence);
  const characters = safeIndex.characters.map((participant) => cards[participant.key]);
  return {
    mode: "group",
    scene: safeIndex.scene,
    characters,
    relations: safeIndex.relations,
    preservedMaterial: safeIndex.preservedMaterial,
    coverage,
  };
}

function toCharacter(draft: TextDnaCharacter, index: number, group: boolean): Character {
  const lorebook = draft.lorebook.map((entry) => ({
    id: newId(),
    keys: entry.keys.length > 0 ? [...entry.keys] : [draft.name],
    content: entry.content,
    isActive: true,
  }));
  const mainGreeting = draft.firstMessage.trim();
  const seenGreetings = new Set(mainGreeting ? [mainGreeting] : []);
  const alternateGreetings = draft.alternateGreetings.filter((greeting) => {
    const text = greeting.trim();
    if (!text || seenGreetings.has(text)) return false;
    seenGreetings.add(text);
    return true;
  });

  const systemPrompt = appendPreserved(
    draft.systemPrompt,
    draft.preservedMaterial,
    "### ДОПОЛНИТЕЛЬНЫЕ АВТОРСКИЕ СВЕДЕНИЯ ИМПОРТА"
  );

  return {
    id: newId(),
    name: draft.name,
    avatarUrl: "",
    tagline: draft.tagline,
    genre: draft.genre || undefined,
    tags: [...draft.tags],
    originTag: group ? "TEXT DNA · GROUP" : "TEXT DNA",
    firstImpression: draft.firstImpression || undefined,
    startingPoint: draft.startingPoint || undefined,
    summaryQuote: draft.summaryQuote || undefined,
    age: draft.age || undefined,
    description: draft.description,
    personality: draft.personality,
    scenario: draft.scenario,
    systemPrompt,
    firstMessage: draft.firstMessage,
    alternateGreetings: alternateGreetings.length > 0 ? alternateGreetings : undefined,
    initialStats: { ...draft.initialStats },
    lorebook,
    createdAt: Date.now() + index,
  };
}

function buildSinglePrepared(payload: TextDnaSinglePayload): TextDnaPreparedSingle {
  const sessionNotes = [
    payload.session.directorNotes,
    ...payload.session.preservedMaterial,
    ...payload.preservedMaterial,
  ];
  return {
    mode: "single",
    character: toCharacter(payload.character, 0, false),
    title: payload.session.title || undefined,
    summary: payload.session.summary,
    directorNotes: appendPreserved("", sessionNotes, "### ПОЛНЫЕ АВТОРСКИЕ СВЕДЕНИЯ СЦЕНЫ"),
  };
}

function buildGroupPrepared(payload: TextDnaGroupPayload): TextDnaPreparedGroup {
  const characters = payload.characters.map((character, index) =>
    toCharacter(character, index, true)
  );
  const keyToCharacter = new Map(
    payload.characters.map((character, index) => [
      character.key ?? `character_${index + 1}`,
      characters[index],
    ])
  );
  const relations: SceneRelation[] = payload.relations.map((relation) => ({
    id: newId(),
    from: keyToCharacter.get(relation.fromKey)?.id ?? "",
    to: keyToCharacter.get(relation.toKey)?.id,
    text: relation.text,
    updatedAt: Date.now(),
  }));
  const relationLedger = payload.relations
    .map((relation) => `${relation.fromKey} → ${relation.toKey}: ${relation.text}`)
    .join("\n");
  const sceneNotes = appendPreserved(
    payload.scene.directorNotes,
    [
      ...payload.scene.preservedMaterial,
      ...payload.preservedMaterial,
      relationLedger ? `ПОЛНЫЕ ОТНОШЕНИЯ И СВЯЗИ:\n${relationLedger}` : "",
    ],
    "### ПОЛНЫЕ АВТОРСКИЕ ПРАВИЛА И СВЯЗИ ИМПОРТА"
  );
  const summaryParts = [
    payload.scene.summary,
    payload.scene.setting ? `Место: ${payload.scene.setting}` : "",
    payload.scene.premise ? `Предпосылка: ${payload.scene.premise}` : "",
    payload.scene.currentMoment ? `Текущий момент: ${payload.scene.currentMoment}` : "",
    payload.scene.tone ? `Тон: ${payload.scene.tone}` : "",
  ].filter(Boolean);
  return {
    mode: "group",
    characters,
    title: payload.scene.title || undefined,
    opening: payload.scene.opening,
    summary: summaryParts.join("\n\n"),
    directorNotes: sceneNotes,
    relations,
  };
}

function preparePayload(payload: TextDnaPayload): TextDnaPrepared {
  return payload.mode === "single"
    ? buildSinglePrepared(payload)
    : buildGroupPrepared(payload);
}

function sourceMetadata(sections: TextDnaSourceSection[]) {
  return sections.map(({ id, start, end }) => ({ id, start, end }));
}

function resultFromPayload(
  source: string,
  task: TextDnaTask,
  payload: TextDnaPayload
): TextDnaResult {
  return {
    mode: task.mode,
    sourceLength: source.length,
    sourceSections: sourceMetadata(task.sections),
    payload,
    prepared: preparePayload(payload),
    corrected: task.corrected,
  };
}

async function extractLongTextDna(
  apiConfig: ApiConfig,
  source: string,
  task: TextDnaTask
): Promise<TextDnaResult> {
  if (task.payload) return resultFromPayload(source, task, task.payload);

  await collectEvidence(apiConfig, task);
  const { index } = await synthesizeIndex(apiConfig, task);
  await synthesizeCards(apiConfig, task, index);

  const payload = assembleLongPayload(task, index, task.cards);
  const checked = validatePayload(payload, task.mode, task.sections);
  if (!checked.payload || checked.issues.length > 0) {
    const diagnostics = diagnosticsFromMetadata(
      "локальная проверка сведения",
      1,
      "schema",
      undefined,
      checked.issues.length
    );
    logDiagnostics(diagnostics);
    throw new TextDnaError(
      formatFailureMessage("локальная проверка сведения", "schema", checked.issues),
      "schema",
      diagnostics
    );
  }

  task.payload = checked.payload;
  return resultFromPayload(source, task, checked.payload);
}

/**
 * Основной вход Text DNA. Для короткого текста используется один компактный
 * запрос. Для длинного: секции → evidence → индекс состава → отдельные карты
 * персонажей → клиентское объединение. `task` позволяет возобновить работу с
 * этапа, на котором произошёл сбой.
 */
export async function extractTextDna(
  apiConfig: ApiConfig,
  source: string,
  mode: TextDnaMode,
  options: ExtractTextDnaOptions = {}
): Promise<TextDnaResult> {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new TextDnaError("Вставьте исходный текст: пустой материал невозможно извлечь.");
  }

  const task = isTextDnaTaskCompatible(options.task, source, mode)
    ? options.task
    : createTextDnaTask(source, mode);

  if (task.sections.length === 1) {
    if (task.payload) return resultFromPayload(source, task, task.payload);
    const result = await requestStructured<TextDnaPayload>(
      apiConfig,
      buildShortPrompt(task.sections, mode),
      (value) => {
        const checked = validatePayload(value, mode, task.sections);
        return { value: checked.payload, issues: checked.issues };
      },
      "финальное извлечение",
      mode === "single" ? SHORT_SINGLE_SCHEMA : SHORT_GROUP_SCHEMA,
      TEXT_DNA_OUTPUT_TOKENS
    );
    task.corrected ||= result.corrected;
    task.payload = result.value;
    return resultFromPayload(source, task, result.value);
  }

  return extractLongTextDna(apiConfig, source, task);
}

/**
 * Публичная клиентская проверка. Она принимает и новый semantic coverage без
 * технических полей, и старый ответ с полями — но результат всегда получает
 * id/ranges из клиентского списка sections.
 */
export function validateTextDnaPayload(
  raw: unknown,
  mode: TextDnaMode,
  sections: TextDnaSourceSection[]
):
  | { ok: true; payload: TextDnaPayload }
  | { ok: false; issues: string[] } {
  const checked = validatePayload(raw, mode, sections);
  if (checked.payload && checked.issues.length === 0) {
    return { ok: true, payload: checked.payload };
  }
  return { ok: false, issues: checked.issues };
}

/** Небольшой адаптер для UI/тестов, не меняющий исходный результат. */
export function prepareTextDnaPayload(payload: TextDnaPayload): TextDnaPrepared {
  return preparePayload(payload);
}
