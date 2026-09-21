// =============================================================
// CHARACTER DNA (GENERATOR V2) — МОДЕЛЬ ДАННЫХ
//
// Полностью отдельная модель данных генератора V2. V1 (теги →
// персонаж) продолжает жить в `characterGenerator.ts` и никак не
// зависит от этих типов. Единственная точка пересечения с общим
// кодом — итоговый `Character`, в который blueprint преобразуется
// через `toCharacter.ts`.
// =============================================================

/** Пол персонажа V2. «any» существует только в настройках пользователя. */
export type V2Gender = "female" | "male";

/** Наблюдаемые уровни независимых осей темперамента (-2..2). */
export interface V2TemperamentAxes {
  /** introverted ↔ extroverted */
  introversion: number;
  /** controlled ↔ spontaneous */
  spontaneity: number;
  /** restrained ↔ emotional */
  emotionality: number;
  /** pessimistic ↔ optimistic */
  optimism: number;
  /** suspicious ↔ trusting */
  trust: number;
  /** conventional ↔ adventurous */
  adventurousness: number;
}

export interface V2Contradiction {
  /** Одна сторона противоречия. */
  a: string;
  /** Противоположная сторона. */
  b: string;
  /** Психологическая связка: почему эти стороны уживаются. */
  link: string;
}

export interface V2Identity {
  gender: V2Gender;
  /** Всегда конкретный взрослый возраст (18+). */
  age: number;
  name: string;
  /** Культурный/географический контекст («крупный город средней полосы»…). */
  culturalContext: string;
  education: string;
  occupationTitle: string;
  livingSituation: string;
  financialContext: string;
  /** Если уместно для динамики. */
  relationshipStatus?: string;
  /** Только если это нужно выбранному сценарию. */
  orientation?: string;
}

export interface V2Appearance {
  /** 2–4 плотных предложения, включая поведенческие детали. */
  summary: string;
  /** Особые приметы, тату, пирсинг, аксессуары. */
  distinctiveMarks: string[];
  /** Язык тела и поведенческие физические привычки. */
  bodyLanguage: string[];
}

export interface V2Psychology {
  temperament: V2TemperamentAxes;
  /** 2–5 основных наблюдаемых черт. */
  traits: string[];
  /** Каким персонаж выглядит для окружающих. */
  socialPersona: string;
  publicSelf: string;
  privateSelf: string;
  vulnerableSelf: string;
  /** 2–4 действительно значимые сильные стороны. */
  strengths: string[];
  /** 1–3 настоящих недостатка, проявляющихся в поведении. */
  flaws: string[];
  /** 1–3 внутренних противоречия со связкой. */
  contradictions: V2Contradiction[];
  values: string[];
  /** Собственные цели — жизнь вне {{user}}. */
  wants: string[];
  fears: string[];
  /** Личные границы, имеющие последствия в RP. */
  boundaries: string[];
}

export interface V2SocialLink {
  role: string;
  name: string;
  /** Короткий смысл связи. */
  meaning: string;
}

export interface V2FormativeEvent {
  event: string;
  impact: string;
}

/** Драматичность биографии: травма не обязательна для глубины. */
export type V2DramaLevel = "ordinary" | "complicated" | "hard";

export interface V2Life {
  occupationField: string;
  /** Как профессия влияет на ритм жизни и поведение. */
  occupationImpact: string;
  home: string;
  /** Конкретные хобби-поведения, не «любит музыку». */
  hobbies: string[];
  /** 4–7 характерных бытовых деталей. */
  lifestyleDetails: string[];
  /** 2–4 фоновые социальные связи. */
  socialCircle: V2SocialLink[];
  formativeEvents: V2FormativeEvent[];
  dramaLevel: V2DramaLevel;
}

export type V2JealousyIntensity = "none" | "low" | "moderate" | "strong";

export interface V2Jealousy {
  intensity: V2JealousyIntensity;
  /** Как проявляется (может быть пустой при none). */
  expression?: string;
}

export interface V2Romance {
  /** Скорость возникновения чувств. */
  feelingsPace: string;
  flirtStyle: string;
  /** Публичность отношений, тактильность, совместное время. */
  openness: string;
  /** Отношение к серьёзным обязательствам. */
  commitment: string;
}

export interface V2Relationship {
  /** Исходная связь с {{user}} (коллеги, соседи, незнакомцы…). */
  dynamic: string;
  /** Стартовое отношение — отдельно от контекста связи. */
  attitude: string;
  /** Наблюдаемое поведение привязанности, без диагнозов. */
  attachment: string[];
  conflictStyle: string;
  postConflict: string;
  affectionStyle: string[];
  jealousy: V2Jealousy;
  romance: V2Romance;
  /** Темп сближения (например, slow burn). */
  pacing: string;
  /** Текущая стадия: Strangers / Familiar / … */
  stage: string;
}

export type V2SpeechEnum =
  | "terse"
  | "normal"
  | "talkative"
  | "rough"
  | "casual"
  | "neutral"
  | "polished"
  | "none"
  | "rare"
  | "emotional"
  | "frequent"
  | "dry"
  | "sarcastic"
  | "playful"
  | "dark"
  | "light"
  | "heavy";

export interface V2SpeechContext {
  when: string;
  change: string;
}

export interface V2SpeechExample {
  mood: string;
  line: string;
}

export interface V2Speech {
  verbosity: "terse" | "normal" | "talkative";
  formality: "rough" | "casual" | "neutral" | "polished";
  profanity: "none" | "rare" | "emotional" | "frequent";
  humor: "none" | "dry" | "sarcastic" | "playful" | "dark";
  slang: "none" | "light" | "heavy";
  /** Манера переписки. */
  texting: string;
  verbalTics: string[];
  /** Изменения речи по состоянию. */
  contextual: V2SpeechContext[];
  examples: V2SpeechExample[];
}

export type V2Libido = "low" | "moderate" | "high";
export type V2SexualOpenness = "reserved" | "private" | "comfortable" | "uninhibited";
export type V2Initiative = "rarely_initiates" | "responsive" | "balanced" | "initiator";
export type V2IntimacyPace = "slow" | "adaptive" | "fast";
export type V2PowerPreference =
  | "none"
  | "submissive"
  | "switch_sub"
  | "switch"
  | "switch_dom"
  | "dominant";
export type V2FlirtStyle = "shy" | "teasing" | "direct" | "provocative" | "deadpan" | "awkward";
export type V2Aftercare = "affectionate" | "quiet_closeness" | "humorous" | "needs_space";
export type V2FeelingsVsSex =
  | "only_with_closeness"
  | "prefers_connection"
  | "can_separate"
  | "strongly_separates";

/**
 * Взрослый профиль (18+). Контекстная система: проявляется, только когда
 * отношения естественно дошли до взрослой близости, а не в каждом диалоге.
 */
export interface V2Intimacy {
  enabled: boolean;
  libido?: V2Libido;
  openness?: V2SexualOpenness;
  initiative?: V2Initiative;
  pace?: V2IntimacyPace;
  /** tender / playful / passionate / rough / experimental — строками. */
  styles?: string[];
  power?: V2PowerPreference;
  flirtStyle?: V2FlirtStyle;
  intimacySpeech?: string;
  tactile?: string;
  experimentation?: string;
  feelingsVsSex?: V2FeelingsVsSex;
  communication?: string;
  aftercare?: V2Aftercare | string;
  boundaries?: string[];
  /** BDSM-аспект: только для взрослых персонажей в согласованном контексте. */
  bdsm?: {
    role?: string;
    intensity?: string;
    experience?: string;
    communication?: string;
    boundaries?: string;
    aftercare?: string;
  };
}

export interface V2Scenario {
  context: string;
  location: string;
  reason: string;
  /** Непосредственный момент старта. */
  moment: string;
  /** Куда сцена может пойти дальше. */
  hook: string;
  /** Скомпонованный текст сценария для карточки. */
  text: string;
}

export type V2SecretLevel =
  | "funny"
  | "awkward"
  | "personal"
  | "relationship"
  | "professional"
  | "serious";

export interface V2Secret {
  level: V2SecretLevel;
  content: string;
  /** Когда секрет вообще может быть раскрыт. */
  revealCondition: string;
}

export interface V2Arc {
  /** Условие (например, «при высоком доверии»). */
  trigger: string;
  /** Потенциальное изменение привычного поведения. */
  change: string;
}

/** Стартовые шкалы: базовые шкалы V1 + независимое опциональное влечение. */
export interface V2InitialStats {
  trust: number;
  affection: number;
  closeness: number;
  tension: number;
  conflict: number;
  /** Опционально: физическое/романтическое влечение, независимо от привязанности. */
  attraction?: number;
  statusTitle: string;
}

/**
 * Полный Character DNA. Версия встроена в сам объект — по ней хранение и
 * импорт понимают, с чем имеют дело.
 */
export interface CharacterBlueprintV2 {
  version: 2;
  /** Когда создан (заполняется приложением, не моделью). */
  createdAt?: number;

  identity: V2Identity;
  /** 1–3 слова сути персонажа. */
  tagline: string;
  appearance: V2Appearance;
  psychology: V2Psychology;
  life: V2Life;
  relationship: V2Relationship;
  speech: V2Speech;
  /** Отдельная опциональная система; отсутствует = без взрослого профиля. */
  intimacy?: V2Intimacy;

  /** Конкретные правила поведения — ядро отыгрыша. */
  behaviorRules: string[];
  /** Что персонаж объективно не может знать. */
  knowledgeBoundaries: string[];

  scenario: V2Scenario;
  /** Стабильные факты памяти (2–4). */
  memories: string[];
  secrets: V2Secret[];
  characterArcs: V2Arc[];
  initialStats: V2InitialStats;

  firstMessage: string;
}

// -------------------------------------------------------------
// ПОЛЬЗОВАТЕЛЬСКИЕ НАСТРОЙКИ
// -------------------------------------------------------------

/** Уровень необычности сочетаний (не мира и не сверхспособностей). */
export type V2Uniqueness = 0 | 1 | 2 | 3;

/** Поведенческий пресет: разворачивается в инструкции, не в шаблон. */
export interface V2Preset {
  id: string;
  name: string;
  instruction: string;
}

/**
 * Предпочтения пользователя для V2.
 *
 * Пустой массив в категории = «любое / AI решит». Это осознанная семантика:
 * пользователь может явно снять выбор кнопкой «Любое» или кинуть 🎲.
 */
export interface V2Preferences {
  gender: V2Gender | "any";
  /** Выбранный диапазон возраста; «любой» — пустая строка. */
  ageBandId: string;
  /** Категория → список id выбранных опций. */
  selections: Record<string, string[]>;
  /** Natural-language seed с высоким приоритетом. */
  customIdea: string;
  uniqueness: V2Uniqueness;
  /** Включён ли взрослый профиль (18+). */
  adultEnabled: boolean;
  /** Поведенческий пресет (необязательно). */
  presetId?: string;
}

/** Результат валидации ответа модели. */
export type V2ValidationResult =
  | { ok: true; blueprint: CharacterBlueprintV2 }
  | { ok: false; issues: string[] };

/** Секции, которые можно перегенерировать отдельно (частичная регенерация). */
export type V2Section =
  | "appearance"
  | "occupation"
  | "psychology"
  | "lifestyle"
  | "relationship"
  | "speech"
  | "scenario"
  | "firstMessage";

/** Краткая подпись персонажа для «памяти разнообразия». */
export interface V2Signature {
  g: V2Gender;
  /** Диапазон возраста. */
  a: string;
  /** Сфера занятости. */
  o: string;
  /** Стартовая динамика. */
  d: string;
  /** Ключевая черта темперамента. */
  t: string;
  /** Речевой стиль. */
  s: string;
  ts: number;
}
