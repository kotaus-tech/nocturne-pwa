// =============================================================
// ТИПЫ ДАННЫХ ДЛЯ ANIMA RP / NOCTURNE
// =============================================================

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
}

export interface Message {
  id: string;
  sessionId: string;
  sender: "user" | "assistant" | "system";
  /** Групповая сцена: какой персонаж написал реплику. Не задано — основной персонаж ветки. */
  characterId?: string;
  /** Снимок имени автора на момент ответа (переживает удаление/переименование персонажа). */
  characterName?: string;
  swipes: string[];
  currentSwipeIndex: number;
  innerThought?: string;
  statsSnapshot?: RelationshipStats;
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