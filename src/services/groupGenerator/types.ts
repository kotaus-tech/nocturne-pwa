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

export interface GroupSceneBlueprint {
  title: string;
  setting: string;
  premise: string;
  currentMoment: string;
  tone: string;
  hook: string;
  boundaries: string[];
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
  version: 1;
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
}

export type GroupValidationResult =
  | { ok: true; blueprint: GroupBlueprint }
  | { ok: false; issues: string[] };

export type GroupRegenerationSection =
  | "scene"
  | "opening"
  | "relations"
  | "cast";

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
  scene?: Pick<GroupSceneBlueprint, "setting" | "premise" | "currentMoment" | "tone" | "hook">;
  blueprint?: GroupBlueprint;
}

export interface GroupGenerationResult {
  blueprint: GroupBlueprint;
  group: GeneratedGroup;
  corrected: boolean;
}
