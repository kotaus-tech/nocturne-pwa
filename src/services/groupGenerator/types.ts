import type { Character } from "../../types";

/** Состав пола для группы: это ограничение генерации, а не характеристика связи. */
export type GroupGender = "female" | "male" | "mixed" | "any";
export type GroupUniqueness = 0 | 1 | 2 | 3;
export type GroupRelationIntensity = "light" | "balanced" | "tense";

export interface GroupOptionSelection {
  /** Категория → выбранные стабильные id опций. */
  selections: Record<string, string[]>;
}

export interface GroupPreferences extends GroupOptionSelection {
  /** Новая UI-ветка явно просит blueprint V2; отсутствие поля = legacy caller. */
  generationVersion?: 2;
  size: number;
  gender: GroupGender;
  ageBandId: string;
  customIdea: string;
  uniqueness: GroupUniqueness;
  relationIntensity: GroupRelationIntensity;
  /** Включает только контекстный взрослый профиль; не форсирует интимность. */
  adultEnabled: boolean;
  presetId?: string;
}

export interface GroupPlayerAnchorBlueprint {
  /** Социальная позиция игрока относительно ансамбля. */
  mode: string;
  /** Что видят персонажи и почему игрок находится в сцене. */
  visibleRole: string;
  /** Что игрок вправе знать на старте, без навязанных мыслей и решений. */
  playerKnowledge: string[];
  /** Как группа может давить на ситуацию, но не на волю игрока. */
  pressurePoints: string[];
}

export interface GroupInformationLayer {
  /** Человеческое название паттерна: сговор, прошлое, зависимость и т. п. */
  type: string;
  /** Ключи тех, кто знает содержание слоя; «player» допустим для игрока. */
  holders: string[];
  /** Ключи тех, кому содержание нельзя раскрывать без условия. */
  hiddenFrom: string[];
  content: string;
  visibleClue: string;
  revealCondition: string;
}

export interface GroupChemistryBlueprint {
  /** Взрослый подтекст группы; пусто, если профиль не включён. */
  pattern: string;
  /** Ключи участников или «player». */
  participants: string[];
  intensity: string;
  /** Нейтральная маска, которую видят остальные. */
  publicMask: string;
  trigger: string;
  boundaries: string[];
}

export interface GroupSceneBlueprint {
  title: string;
  setting: string;
  premise: string;
  currentMoment: string;
  tone: string;
  hook: string;
  boundaries: string[];
  /** Group DNA V2: физические условия, а не только название места. */
  locationConditions?: string[];
  /** Group DNA V2: осязаемый спусковой крючок текущего момента. */
  microCatalyst?: string;
  /** Group DNA V2: социальная позиция игрока в компании. */
  playerAnchor?: GroupPlayerAnchorBlueprint;
  /** Group DNA V2: одна-две доминирующие роли ансамбля. */
  ensembleRoles?: string[];
}

export interface GroupSpeechBlueprint {
  register: string;
  rhythm: string;
  markers: string[];
  examples: string[];
}

export interface GroupStatsBlueprint {
  trust: number;
  affection: number;
  closeness: number;
  tension: number;
  conflict: number;
  statusTitle: string;
}

export interface GroupCharacterBlueprint {
  /** Стабильный ключ для отношений; имя может быть переименовано при нормализации. */
  key: string;
  name: string;
  gender: "female" | "male";
  age: number;
  role: string;
  tagline: string;
  appearance: string;
  personality: string;
  publicPersona: string;
  privateLayer: string;
  strengths: string[];
  flaws: string[];
  wants: string[];
  boundaries: string[];
  speech: GroupSpeechBlueprint;
  scenarioRole: string;
  behaviorRules: string[];
  facts: string[];
  secret?: string;
  firstMessage: string;
  initialStats: GroupStatsBlueprint;
}

export interface GroupRelationBlueprint {
  fromKey: string;
  toKey: string;
  label: string;
  history: string;
  currentDynamic: string;
  leverage?: string;
}

export interface GroupBlueprint {
  /** Version 1 остаётся валидной для старых ответов и сохранённых данных. */
  version: 1 | 2;
  createdAt?: number;
  preferencesSnapshot?: {
    size: number;
    gender: GroupGender;
    ageBandId: string;
    customIdea: string;
  };
  scene: GroupSceneBlueprint;
  cast: GroupCharacterBlueprint[];
  relations: GroupRelationBlueprint[];
  opening: string;
  /** Group DNA V2: асимметричные знания и условия раскрытия. */
  informationLayers?: GroupInformationLayer[];
  /** Group DNA V2: взрослый подтекст только при включённом профиле. */
  chemistry?: GroupChemistryBlueprint[];
}

export type GroupValidationResult =
  | { ok: true; blueprint: GroupBlueprint }
  | { ok: false; issues: string[] };

export type GroupRegenerationSection =
  | "scene"
  | "opening"
  | "relations"
  | "cast"
  | "anchoring"
  | "information"
  | "chemistry";

export interface GeneratedCharacterDraft extends Partial<Character> {
  /** Скрытый ключ, нужен только для переноса связей в ChatSession. */
  groupKey?: string;
}

export interface GeneratedGroupRelation {
  fromKey: string;
  toKey: string;
  text: string;
}

/** Совместимый с V1 результат: карточки + общий опенинг. */
export interface GeneratedGroup {
  characters: GeneratedCharacterDraft[];
  opening: string;
  title?: string;
  summary?: string;
  relations?: GeneratedGroupRelation[];
  scene?: Pick<
    GroupSceneBlueprint,
    "setting" | "premise" | "currentMoment" | "tone" | "hook" | "locationConditions" | "microCatalyst" | "playerAnchor" | "ensembleRoles"
  >;
  blueprint?: GroupBlueprint;
}

export interface GroupGenerationResult {
  blueprint: GroupBlueprint;
  group: GeneratedGroup;
  corrected: boolean;
}
