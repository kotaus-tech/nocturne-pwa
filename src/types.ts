// =============================================================
// ТИПЫ ДАННЫХ ДЛЯ ANIMA RP / NOCTURNE
// =============================================================

import type { CharacterBlueprintV2 } from "./services/v2/v2types";

export interface UserProfile {
  name: string;
  avatarUrl: string;
  personaDescription: string;
}

/** Своя личность (альтер-эго), от лица которой игрок ведёт диалоги. */
export interface Persona extends UserProfile {
  id: string;
  createdAt: number;
}

export interface RelationshipStats {
  trust: number;        // 0–100 (Доверие)
  affection: number;    // 0–100 (Привязанность)
  closeness: number;    // 0–100 (Близость / Раскрепощенность)
  tension: number;      // 0–100 (Напряжение / Саспенс)
  conflict: number;     // 0–100 (Конфликт / Злость)
  /**
   * Опциональная шкала влечения (генератор V2). Независима от остальных:
   * высокое влечение ≠ доверие, высокая привязанность ≠ близость.
   * У персонажей без V2 отсутствует, и вся статистика ведёт себя как раньше.
   */
  attraction?: number;
  statusTitle: string;  // "Нерушимая связь", "Незнакомцы" и т.д.
  customStats?: Record<string, number>;
}

export const DEFAULT_STATS: RelationshipStats = {
  trust: 50,
  affection: 30,
  closeness: 20,
  tension: 10,
  conflict: 0,
  statusTitle: "Знакомство",
};

/**
 * Изменение шкал отношений за один ответ: новое значение минус прежнее.
 * Нулевые изменения не записываются — поле хранит только реальные сдвиги.
 */
export type RelationshipDelta = Partial<Omit<RelationshipStats, "statusTitle">>;

export interface LorebookEntry {
  id: string;
  keys: string[];
  content: string;
  isActive: boolean;
}

export interface Character {
  id: string;
  name: string;
  /** Персона игрока по умолчанию для диалогов с этим персонажем. */
  defaultPersonaId?: string;
  avatarUrl: string;
  wallpaperUrl?: string;
  tagline: string;
  
  genre?: string;
  tags?: string[];
  isFavorite?: boolean;
  isPinned?: boolean;
  originTag?: string;
  firstImpression?: string;
  startingPoint?: string;
  age?: string;
  summaryQuote?: string;

  description?: string;
  personality?: string;
  scenario?: string;
  systemPrompt: string;
  
  firstMessage: string;
  /**
   * Альтернативные первые реплики (из карточек Character Card).
   * В новой ветке они становятся свайпами стартового сообщения.
   */
  alternateGreetings?: string[];
  initialStats: RelationshipStats;
  lorebook: LorebookEntry[];
  createdAt: number;

  /**
   * Character DNA: полный расширенный blueprint генератора V2.
   * Отсутствует у персонажей V1 и старых карточек — они работают как раньше.
   */
  blueprintV2?: CharacterBlueprintV2;
  /** Маркер версии генератора: 2 = Character DNA. */
  generatorVersion?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  sender: "user" | "assistant" | "system";
  /** Групповая сцена: какой персонаж написал реплику. Не задано — основной персонаж ветки. */
  characterId?: string;
  /** Снимок имени автора на момент ответа (переживает удаление/переименование персонажа). */
  characterName?: string;
  /** Реплика адресована конкретному персонажу (выбор адресата в поле ввода). */
  addressedTo?: string;
  /** Каноническое имя поля адресата для dirty-flag и дистанционной переписки. */
  targetCharacterId?: string;
  /** Снимок физически присутствующих в момент создания сообщения. */
  presentCharacterIds?: string[];
  /** Дистанционный контакт отсутствующего персонажа: влияет только на отображение. */
  remoteKind?: RemoteKind;
  /**
   * Инлайн-реакция «живой сцены»: сформулирована моделью другого персонажа,
   * поэтому не влияет на шкалы/связи/память «сказавшего» и не считается его ходом.
   */
  isLiveSceneEcho?: boolean;
  /** Ответ отсутствующего персонажа в уже открытой дистанционной ветке. */
  isRemoteReply?: boolean;
  swipes: string[];
  currentSwipeIndex: number;
  innerThought?: string;
  statsSnapshot?: RelationshipStats;
  /**
   * Насколько шкалы сдвинулись этим ответом (после минус до). Считается в
   * момент применения ответа и переживает свайпы и перегенерации.
   */
  statsDelta?: RelationshipDelta;
  imageUrl?: string;
  timestamp: number;
}

export interface DiaryEntry {
  id: string;
  timestamp: number;
  entryNumber: number;
  thought: string;
  mood?: string;
}

export interface StoryLogEntry {
  id: string;
  timestamp: number;
  text: string;
}

export interface ExtractedFact {
  id: string;
  keys: string[];
  content: string;
  createdAt: number;
  isPinned?: boolean;
}

export type ThoughtMode =
  | "censor"
  | "counterpoint"
  | "stream"
  | "tactical"
  | "instinct";

// ─────────────────────────────────────────────────────────────
// Симметричная память и внекадровая жизнь (групповые сцены)
// ─────────────────────────────────────────────────────────────

/** Скоуп намерения: при каком сдвиге сцены план автоматически устаревает. */
export type IntentionScope = "location" | "time" | "scene" | "persistent";

/**
 * Текущее активное намерение персонажа. Ровно одно на персонажа: новое
 * замещает старое, чтобы не плодить забытые несбывшиеся планы.
 */
export interface Intention {
  /** Краткая формулировка плана (≤200 символов). */
  text: string;
  scope: IntentionScope;
  /** Сообщение, на котором намерение возникло (пустая строка = ручное/неизвестное). */
  createdAtMessageId: string;
  /** Служебная метка: намерение сформировано offscreen-тиком за кадром. */
  origin?: "offscreen" | "scene";
}

/**
 * Личная память участника сцены. Симметрична для всех, включая лидера ветки:
 * хранится единым реестром `session.participantMemory` по `characterId`.
 * Отсутствие записи трактуется как «пустое» состояние.
 */
export interface ParticipantMemory {
  /** Ключ записи — id персонажа, дублируется для безопасной сериализации. */
  characterId: string;
  /**
   * Личные заметки: субъективные мысли, выводы, подозрения, секреты,
   * прожитый за кадром опыт. Каждая строка — самостоятельная мысль
   * от собственного лица персонажа. Не более MAX_PRIVATE_NOTES штук.
   */
  privateNotes: string[];
  intention: Intention | null;
  /**
   * Последнее сообщение (по id, не по индексу — безопасность перемотки),
   * после которого для персонажа проводилась плановая экстракция памяти.
   */
  lastExtractedMessageId: string | null;
  /**
   * Сообщение, на котором персонаж ушёл за кадр. Нужно для расчёта числа
   * ходов отсутствия и решения о запуске offscreen-тика. Обнуляется при возврате.
   */
  absentSinceMessageId: string | null;
  /** Счётчик тиков подряд без значимого события — жёсткий кулдаун. */
  ticksSinceLastSignificant: number;
  /** Сколько значимых offscreen-событий прошло с последнего дистанционного контакта. */
  significantSinceLastContact: number;
  /**
   * Служебный указатель: сообщение, на котором был выполнен последний
   * offscreen-тик. Нужно, чтобы отсчитывать следующий интервал тиков
   * не от момента ухода за кадр, а от прошлой проверки.
   */
  lastTickAtMessageId?: string | null;
}

/** Канал дистанционного контакта отсутствующего персонажа. */
export type RemoteKind = "sms" | "call_missed" | "social_post" | "message";

/** Скачок времени и/или локации внутри сцены (мета-поле `sceneShift`). */
export interface SceneShift {
  /** Насколько прыгнуло время; null = время не прыгнуло. */
  time: "hours" | "day" | "days" | null;
  /** Сменилось ли место действия. */
  locationChanged: boolean;
}

/** Источник формирования патча состояния сессии. */
export type ScenePatchSourceKind =
  | "user_turn"
  | "regenerate"
  | "offscreen_tick"
  | "memory_extraction";

/**
 * Единая декларативная шина изменений состояния ветки за один логический шаг.
 * Ни один код-путь не пишет описанные здесь механики в базу напрямую —
 * только через формирование патча и единый редьюсер (см. sessionPatch.ts).
 */
export interface SceneSessionPatch {
  presencePatch?: {
    activeCharacterIds?: string[];
    absentReasons?: Record<string, string>;
  };
  /** Изменение состава через панель режиссёра. */
  compositionPatch?: {
    characterIds: string[];
    isGroup?: boolean;
  };
  /** Полная замена связей — используется только ручным редактором. */
  relationsReplace?: SceneRelation[];
  /** Входящие связи по именам — применяются через mergeSceneRelations. */
  relationsPatch?: { from: string; to?: string; text: string }[];
  statsPatch?: {
    leader?: RelationshipStats;
    participants?: Record<string, RelationshipStats>;
  };
  /** Обновлённая нейтральная хроника (заменяет текущую целиком). */
  summaryPatch?: string;
  /** Настройки режиссёра, связанные с этой шиной состояния. */
  settingsPatch?: {
    liveScene?: boolean;
    offscreenLifeEnabled?: boolean;
    offscreenTickInterval?: number;
  };
  participantMemoryPatch?: Record<string, Partial<ParticipantMemory>>;
  /** Сигнал скачка времени/локации — инвалидирует намерения по скоупу. */
  sceneShiftPatch?: SceneShift | null;
  remoteMessagePatch?: {
    characterId: string;
    text: string;
    kind: RemoteKind;
  };
  /**
   * Подпись заметок, на которых строился патч: если к моменту применения
   * заметки персонажа уже изменились другим источником — патч по заметкам
   * отбрасывается, а не применяется вслепую поверх.
   */
  baseNotesSignature?: string;
  /** Аналогичная защита для устойчивого намерения персонажа. */
  baseIntentionSignature?: string;
  /** Для offscreen-патча: субъект и его статус на момент запуска тика. */
  offscreenSubjectId?: string;
  offscreenWasAbsent?: boolean;
  sourceKind: ScenePatchSourceKind;
  sourceSnapshotAt: number;
}

/** Микро-связь внутри группы: кто как относится к кому. */
export interface SceneRelation {
  id: string;
  /** Кто так думает. */
  from: string;
  /** О ком — не задано, значит о группе в целом. */
  to?: string;
  text: string;
  /** Когда связь обновили по ходу игры (моделью) — для пометки в панели. */
  updatedAt?: number;
}

export interface ChatSession {
  id: string;
  /** Лидер сцены: в групповых ветках — первый из состава. */
  characterId: string;
  /** Групповая ветка: несколько персонажей в одном сюжете. */
  isGroup?: boolean;
  /** Состав сюжета (2–4 героя). */
  characterIds?: string[];
  /** Кто физически в сцене. Не задано — присутствуют все из состава. */
  activeCharacterIds?: string[];
  /** Почему персонаж за кадром: «ушёл в гараж», «спит». */
  absentReasons?: Record<string, string>;
  /** Взаимоотношения между персонажами группы. */
  relations?: SceneRelation[];
  /** Шкалы отношений дополнительных участников, по их id. */
  participantStats?: Record<string, RelationshipStats>;
  /**
   * Личная память каждого участника сцены (включая лидера), по его id.
   * Симметричный внутренний слой: заметки, намерения, указатели экстракции.
   */
  participantMemory?: Record<string, ParticipantMemory>;
  /**
   * «Жизнь за кадром»: отсутствующие персонажи развиваются фоновыми тиками.
   * По умолчанию включено, выключается тумблером в панели режиссёра.
   */
  offscreenLifeEnabled?: boolean;
  /** Интервал в ходах сцены между offscreen-тиками (настраивается режиссёром). */
  offscreenTickInterval?: number;
  /**
   * «Живая сцена»: другие герои могут коротко отреагировать в той же реплике.
   * По умолчанию включено, выключается тумблером в панели режиссёра.
   */
  liveScene?: boolean;
  /** Своя личность для этой ветки; не задана — берётся персона персонажа или активная. */
  personaId?: string;
  /** Сколько реплик ветки уже обработал фоновый экстрактор памяти. */
  memoryExtractedCount?: number;
  title: string;
  summary?: string;
  storyLog?: StoryLogEntry[];
  directorNotes: string;
  wallpaperUrl?: string;
  wallpaperDim?: number;
  wallpaperBlur?: number;
  dynamicEvents?: boolean;
  suspenseMode?: boolean;
  naturalSpeech?: boolean;
  showRelationshipToasts?: boolean;
  realisticPacing?: boolean;
  novelMode?: boolean;
  thoughtMode?: ThoughtMode;
  diary?: DiaryEntry[];
  extractedFacts?: ExtractedFact[];
  currentStats: RelationshipStats;
  isPinned?: boolean;
  pinOrder?: number;
  createdAt: number;
  updatedAt: number;
}

export type ApiMode = "openai" | "gemini";

export type ThinkingMode = "AUTO" | "OFF" | "LOW" | "MEDIUM" | "HIGH";

export interface ApiConfig {
  mode: ApiMode;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  contextWindow: number;
  thinkingMode?: ThinkingMode;

  // Универсальный стриминг для всех провайдеров
  streamEnabled?: boolean;

  // Ступенчатое окно контекста для оптимизации KV-кэширования токенов
  steppedContextEnabled?: boolean;

  // Универсальные параметры сэмплинга (OpenAI / OpenRouter / Ru-OpenRouter / DeepSeek / Ollama / Gemini)
  maxTokens?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;

  // Параметры сэмплинга локальных моделей (Ollama / LM Studio)
  localNumCtx?: number;
  localTopK?: number;
  localTopP?: number;
  localRepeatPenalty?: number;
  localPresencePenalty?: number;
  localStreamEnabled?: boolean; // обратная совместимость
}

export interface ApiPreset {
  id: string;
  name: string;
  config: ApiConfig;
  createdAt: number;
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  mode: "openai",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "openai/gpt-4o-mini",
  temperature: 0.9,
  contextWindow: 24,
  thinkingMode: "AUTO",
  streamEnabled: true,
  steppedContextEnabled: true,
  maxTokens: 4096,
  topP: 0.9,
  topK: 40,
  presencePenalty: 0.0,
  frequencyPenalty: 0.0,
  localNumCtx: 16384,
  localTopK: 40,
  localTopP: 0.9,
  localRepeatPenalty: 1.1,
  localPresencePenalty: 0.0,
  localStreamEnabled: true,
};