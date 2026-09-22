import { DEFAULT_STATS } from "../../types";
import type {
  GroupBlueprint,
  GroupCharacterBlueprint,
  GroupRelationBlueprint,
  GroupSpeechBlueprint,
  GroupStatsBlueprint,
  GroupValidationResult,
} from "./types";

const MAX_TEXT = 900;
const MAX_NAME = 70;
const MAX_ITEMS = 8;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function asStringArray(value: unknown, maxItems = MAX_ITEMS, maxLen = 320): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, maxItems)
    .map((item) => item.trim().slice(0, maxLen));
}

function clampStat(value: unknown, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function normalizeStats(raw: unknown): GroupStatsBlueprint {
  const source = isObject(raw) ? raw : {};
  return {
    trust: clampStat(source.trust, DEFAULT_STATS.trust),
    affection: clampStat(source.affection, DEFAULT_STATS.affection),
    closeness: clampStat(source.closeness, DEFAULT_STATS.closeness),
    tension: clampStat(source.tension, DEFAULT_STATS.tension),
    conflict: clampStat(source.conflict, DEFAULT_STATS.conflict),
    statusTitle: asString(source.statusTitle, 100) || "Первая встреча",
  };
}

function normalizeSpeech(raw: unknown): GroupSpeechBlueprint {
  const source = isObject(raw) ? raw : {};
  return {
    register: asString(source.register, 180) || "естественная разговорная речь",
    rhythm: asString(source.rhythm, 220) || "переменный ритм по ситуации",
    markers: asStringArray(source.markers, 6, 100),
    examples: asStringArray(source.examples, 4, 240),
  };
}

function normalizeCharacter(raw: unknown, index: number): GroupCharacterBlueprint {
  const source = isObject(raw) ? raw : {};
  const gender = source.gender === "male" ? "male" : "female";
  const ageValue = typeof source.age === "number" && Number.isFinite(source.age)
    ? Math.round(source.age)
    : 24 + index * 3;

  return {
    key: asString(source.key, 50) || `character_${index + 1}`,
    name: asString(source.name, MAX_NAME) || `Персонаж ${index + 1}`,
    gender,
    age: ageValue,
    role: asString(source.role, 160) || "участник сцены",
    tagline: asString(source.tagline, 140) || "свой человек в этой сцене",
    appearance: asString(source.appearance) || asString(source.description) || "Внешность оставлена открытой для игры.",
    personality: asString(source.personality) || "Характер раскрывается через поступки и разговор.",
    publicPersona: asString(source.publicPersona, 500) || asString(source.personality, 500),
    privateLayer: asString(source.privateLayer, 500) || "Не всё, что он показывает группе, совпадает с тем, что думает наедине.",
    strengths: asStringArray(source.strengths, 5),
    flaws: asStringArray(source.flaws, 5),
    wants: asStringArray(source.wants, 5),
    boundaries: asStringArray(source.boundaries, 6),
    speech: normalizeSpeech(source.speech),
    scenarioRole: asString(source.scenarioRole, 500) || asString(source.scenario, 500) || "Оказался в общей сцене по своей причине.",
    behaviorRules: asStringArray(source.behaviorRules, 8),
    facts: asStringArray(source.facts ?? source.lorebook, 6),
    secret: asString(source.secret, 360) || undefined,
    firstMessage: asString(source.firstMessage, 900) || "*Осматривается, оценивая обстановку.* — Ну, рассказывайте.",
    initialStats: normalizeStats(source.initialStats),
  };
}

function normalizeScene(raw: unknown): GroupBlueprint["scene"] {
  const source = isObject(raw) ? raw : {};
  return {
    title: asString(source.title, 120) || "Общая сцена",
    setting: asString(source.setting, 280) || "место, где герои регулярно пересекаются",
    premise: asString(source.premise, 700) || "Несколько людей оказались в одном месте со своими причинами и ожиданиями.",
    currentMoment: asString(source.currentMoment, 500) || "Обычный момент нарушается конкретным поводом для разговора.",
    tone: asString(source.tone, 240) || "живой и наблюдательный",
    hook: asString(source.hook, 500) || "У игрока остаётся понятный повод вмешаться.",
    boundaries: asStringArray(source.boundaries, 6, 300),
  };
}

function normalizeRelations(
  raw: unknown,
  cast: GroupCharacterBlueprint[]
): GroupRelationBlueprint[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set(cast.map((item) => item.key));
  const byName = new Map(cast.map((item) => [item.name.toLocaleLowerCase("ru-RU"), item.key]));
  const resolveKey = (value: unknown): string => {
    const candidate = asString(value, 80);
    if (keys.has(candidate)) return candidate;
    return byName.get(candidate.toLocaleLowerCase("ru-RU")) ?? "";
  };

  const seen = new Set<string>();
  const result: GroupRelationBlueprint[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const fromKey = resolveKey(item.fromKey ?? item.from);
    const toKey = resolveKey(item.toKey ?? item.to);
    const label = asString(item.label, 140);
    const history = asString(item.history, 360);
    const currentDynamic = asString(item.currentDynamic ?? item.text, 420);
    if (!fromKey || !toKey || fromKey === toKey || !currentDynamic) continue;
    const signature = `${fromKey}->${toKey}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push({
      fromKey,
      toKey,
      label: label || "связь",
      history: history || "Связь сформировалась до начала сцены.",
      currentDynamic,
      leverage: asString(item.leverage, 260) || undefined,
    });
  }
  return result;
}

/**
 * Старый V1-ответ группы превращается в минимальный blueprint. Это не основной
 * путь качества, а обратная совместимость с сохранёнными моками/провайдерами,
 * которые ещё не умеют новую схему.
 */
export function upgradeLegacyGroup(raw: unknown, expectedSize: number): unknown {
  if (!isObject(raw) || raw.cast || !raw.characters) return raw;

  const list = Array.isArray(raw.characters)
    ? raw.characters
    : isObject(raw.characters)
      ? Object.values(raw.characters)
      : [];
  const opening = asString(raw.opening, 1400) || "*Сцена начинается с общего разговора.*";
  const cast = list.slice(0, expectedSize).map((item, index) => {
    const source = isObject(item) ? item : {};
    const key = `character_${index + 1}`;
    const name = asString(source.name, MAX_NAME) || `Персонаж ${index + 1}`;
    const personality = asString(source.personality, 500) || "Характер проявляется постепенно.";
    return {
      key,
      name,
      gender: index % 2 === 0 ? "female" : "male",
      age: 24 + index * 3,
      role: asString(source.tagline, 150) || "участник сцены",
      tagline: asString(source.tagline, 140) || "участник сцены",
      appearance: asString(source.description, 500) || "Внешность уточняется в игре.",
      personality,
      publicPersona: personality,
      privateLayer: "Внутренние мотивы ещё не раскрыты группе.",
      strengths: ["наблюдательность"],
      flaws: ["не всегда говорит о своих настоящих мотивах"],
      wants: ["понять, куда приведёт эта встреча"],
      boundaries: ["не любит, когда за него решают"],
      speech: {
        register: "естественная разговорная речь",
        rhythm: "по ситуации",
        markers: [],
        examples: [asString(source.firstMessage, 240) || "— Говорит коротко и по делу."],
      },
      scenarioRole: asString(source.scenario, 500) || "оказался в общей сцене",
      behaviorRules: [asString(source.systemPrompt, 300) || "реагирует соразмерно наблюдаемым событиям"],
      facts: (Array.isArray(source.lorebook)
        ? source.lorebook.map((entry) => (isObject(entry) ? asString(entry.content, 240) : "")).filter(Boolean)
        : []).concat("Участник этой сцены имеет историю до начала разговора."),
      firstMessage: asString(source.firstMessage, 900) || "*Оглядывается на остальных.* — Ну, что дальше?",
      initialStats: normalizeStats(source.initialStats),
    };
  });

  const relations: GroupRelationBlueprint[] = [];
  for (let index = 1; index < cast.length; index += 1) {
    relations.push({
      fromKey: cast[index - 1].key,
      toKey: cast[index].key,
      label: "знакомство",
      history: "Их связь начинается до или в момент общей сцены.",
      currentDynamic: "Они присматриваются друг к другу и пока не знают всех мотивов.",
    });
  }

  return {
    version: 1,
    scene: {
      title: "Общая сцена",
      setting: "место общей встречи",
      premise: "Герои оказались вместе по разным причинам.",
      currentMoment: opening,
      tone: "живой разговор",
      hook: "Игрок может вмешаться в развивающийся разговор.",
      boundaries: [],
    },
    cast,
    relations,
    opening,
  };
}

export function validateGroupBlueprint(
  raw: unknown,
  expectedSize: number
): GroupValidationResult {
  const upgraded = upgradeLegacyGroup(raw, expectedSize);
  const issues: string[] = [];
  if (!isObject(upgraded)) return { ok: false, issues: ["Ответ не является JSON-объектом."] };

  if (upgraded.version !== 1) {
    issues.push("version: должна быть 1");
  }

  const castRaw = upgraded.cast;
  if (!Array.isArray(castRaw)) {
    issues.push("cast: обязательный массив персонажей");
  }
  const rawCastItems = Array.isArray(castRaw) ? castRaw : [];
  const cast = rawCastItems.slice(0, expectedSize).map(normalizeCharacter);
  if (rawCastItems.length !== expectedSize) {
    issues.push(`cast: нужно ровно ${expectedSize} персонажа(ей), получено ${rawCastItems.length}`);
  }

  const names = new Set<string>();
  const keys = new Set<string>();
  const roleSignatures = new Set<string>();
  const personalitySignatures = new Set<string>();
  const voiceSignatures = new Set<string>();
  cast.forEach((character, index) => {
    const prefix = `cast[${index}]`;
    const rawCharacter = isObject(rawCastItems[index]) ? rawCastItems[index] : {};
    const rawName = asString(rawCharacter.name, MAX_NAME);
    const rawKey = asString(rawCharacter.key, 50);
    const rawAge = rawCharacter.age;

    if (!rawName || rawName.length > MAX_NAME) issues.push(`${prefix}.name: нужно непустое уникальное имя`);
    const nameKey = character.name.toLocaleLowerCase("ru-RU");
    if (names.has(nameKey)) issues.push(`${prefix}.name: имена персонажей должны различаться`);
    names.add(nameKey);

    if (!rawKey || keys.has(character.key)) issues.push(`${prefix}.key: стабильные уникальные ключи`);
    keys.add(character.key);

    const roleSignature = character.role.toLocaleLowerCase("ru-RU");
    if (roleSignatures.has(roleSignature)) issues.push(`${prefix}.role: роли в ансамбле должны различаться`);
    roleSignatures.add(roleSignature);

    const personalitySignature = character.personality.toLocaleLowerCase("ru-RU");
    if (personalitySignatures.has(personalitySignature)) issues.push(`${prefix}.personality: характеры не должны быть копиями`);
    personalitySignatures.add(personalitySignature);

    const voiceSignature = [
      character.speech.register,
      character.speech.rhythm,
      character.speech.examples.join("/")
    ].join("|").toLocaleLowerCase("ru-RU");
    if (voiceSignatures.has(voiceSignature)) issues.push(`${prefix}.speech: голоса в ансамбле должны различаться`);
    voiceSignatures.add(voiceSignature);

    if (typeof rawAge !== "number" || !Number.isFinite(rawAge) || character.age < 18 || character.age > 90) {
      issues.push(`${prefix}.age: только реалистичный взрослый возраст 18–90`);
    }
    if (!asString(rawCharacter.appearance ?? rawCharacter.description) || !asString(rawCharacter.personality)) {
      issues.push(`${prefix}: нужны appearance и personality`);
    }
    if (!asString(rawCharacter.publicPersona) || !asString(rawCharacter.privateLayer)) {
      issues.push(`${prefix}: нужны publicPersona и privateLayer`);
    }
    if (!Array.isArray(rawCharacter.strengths) || character.strengths.length === 0) {
      issues.push(`${prefix}.strengths: нужна хотя бы одна сильная сторона`);
    }
    if (!Array.isArray(rawCharacter.flaws) || character.flaws.length === 0) {
      issues.push(`${prefix}.flaws: нужен хотя бы один наблюдаемый недостаток`);
    }
    if (!Array.isArray(rawCharacter.wants) || character.wants.length === 0) {
      issues.push(`${prefix}.wants: нужна собственная цель вне игрока`);
    }
    if (!isObject(rawCharacter.speech) || character.speech.examples.length === 0) {
      issues.push(`${prefix}.speech.examples: нужен хотя бы один пример голоса`);
    }
    if (!Array.isArray(rawCharacter.behaviorRules) || character.behaviorRules.length === 0) {
      issues.push(`${prefix}.behaviorRules: нужны наблюдаемые правила поведения`);
    }
    if (!Array.isArray(rawCharacter.facts) || character.facts.length === 0) {
      issues.push(`${prefix}.facts: нужен хотя бы один устойчивый факт`);
    }
    const rawStats = rawCharacter.initialStats;
    const hasStats = isObject(rawStats)
      && ["trust", "affection", "closeness", "tension", "conflict"].every(
        (key) => typeof rawStats[key] === "number" && Number.isFinite(rawStats[key])
      )
      && typeof rawStats.statusTitle === "string" && rawStats.statusTitle.trim().length > 0;
    if (!hasStats) issues.push(`${prefix}.initialStats: нужны все стартовые шкалы и statusTitle`);
    if (!character.firstMessage) issues.push(`${prefix}.firstMessage: нужна стартовая реплика`);
  });

  const rawScene = isObject(upgraded.scene) ? upgraded.scene : {};
  const scene = normalizeScene(upgraded.scene);
  for (const field of ["setting", "premise", "currentMoment", "tone", "hook"] as const) {
    if (!asString(rawScene[field])) issues.push(`scene.${field}: обязательное непустое поле`);
  }

  const opening = asString(upgraded.opening, 1800);
  if (opening.length < 20) issues.push("opening: общий опенинг должен быть содержательным");

  if (!Array.isArray(upgraded.relations)) issues.push("relations: обязательный массив связей");
  const relations = normalizeRelations(upgraded.relations, cast);
  if (relations.length < Math.max(1, expectedSize - 1)) {
    issues.push(`relations: нужно минимум ${Math.max(1, expectedSize - 1)} направленных связей между героями`);
  }

  if (issues.length > 0) return { ok: false, issues };

  const blueprint: GroupBlueprint = {
    version: 1,
    scene,
    cast,
    relations,
    opening,
  };

  return { ok: true, blueprint };
}
