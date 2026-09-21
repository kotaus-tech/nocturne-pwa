// =============================================================
// CHARACTER DNA (V2) — СТРОГАЯ ВАЛИДАЦИЯ ОТВЕТА МОДЕЛИ
//
// Никакого «почини сломанный JSON добавлением скобок»: модель обязана
// отдать структурно корректный blueprint. Все проблемы собираются
// списком — он же уходит модели в единственном коррекционном повторе.
// =============================================================

import type {
  CharacterBlueprintV2,
  V2Aftercare,
  V2FeelingsVsSex,
  V2FlirtStyle,
  V2Initiative,
  V2Intimacy,
  V2IntimacyPace,
  V2Libido,
  V2PowerPreference,
  V2SexualOpenness,
  V2ValidationResult,
} from "./v2types";

/** Минимальный возраст персонажа V2: только взрослые. */
export const V2_MIN_AGE = 18;

const clamp0to100 = (value: unknown, fallback: number): number => {
  const num = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, Math.round(num)));
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, maxLen = 600): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function asStringArray(value: unknown, maxItems = 12, maxLen = 400): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, maxItems)
    .map((item) => item.trim().slice(0, maxLen));
}

const SPEECH_ENUMS: Record<string, string[]> = {
  verbosity: ["terse", "normal", "talkative"],
  formality: ["rough", "casual", "neutral", "polished"],
  profanity: ["none", "rare", "emotional", "frequent"],
  humor: ["none", "dry", "sarcastic", "playful", "dark"],
  slang: ["none", "light", "heavy"],
};

const JEALOUSY_LEVELS = ["none", "low", "moderate", "strong"];
const DRAMA_LEVELS = ["ordinary", "complicated", "hard"];
const SECRET_LEVELS = ["funny", "awkward", "personal", "relationship", "professional", "serious"];

const LIBIDO = ["low", "moderate", "high"];
const OPENNESS = ["reserved", "private", "comfortable", "uninhibited"];
const INITIATIVE = ["rarely_initiates", "responsive", "balanced", "initiator"];
const INTIMACY_PACE = ["slow", "adaptive", "fast"];
const POWER = ["none", "submissive", "switch_sub", "switch", "switch_dom", "dominant"];
const FLIRT = ["shy", "teasing", "direct", "provocative", "deadpan", "awkward"];
const FEELINGS_VS_SEX = [
  "only_with_closeness",
  "prefers_connection",
  "can_separate",
  "strongly_separates",
];

/**
 * Валидирует сырой объект и нормализует его в `CharacterBlueprintV2`.
 * Возвращает список проблем — пустой, если всё в порядке.
 */
export function validateBlueprint(raw: unknown): V2ValidationResult {
  const issues: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, issues: ["Ответ не является JSON-объектом."] };
  }

  // ------------------------------------------------------------
  // identity
  // ------------------------------------------------------------
  const identityRaw = raw.identity;
  if (!isObject(identityRaw)) {
    issues.push("identity: обязательная секция");
  }

  const identity = isObject(identityRaw) ? identityRaw : {};
  const gender = identity.gender === "male" ? "male" : identity.gender === "female" ? "female" : null;
  if (!gender) issues.push("identity.gender: \"female\" или \"male\"");

  const ageRaw = identity.age;
  const age = typeof ageRaw === "number" && Number.isFinite(ageRaw) ? Math.round(ageRaw) : NaN;
  if (Number.isNaN(age)) {
    issues.push("identity.age: конкретное число лет");
  } else if (age < V2_MIN_AGE) {
    issues.push(
      `identity.age: персонаж V2 должен быть взрослым (>= ${V2_MIN_AGE}), получено ${age}`
    );
  } else if (age > 90) {
    issues.push(`identity.age: слишком большой возраст (${age}), укажите реалистичный`);
  }

  const name = asString(identity.name, 60);
  if (!name) issues.push("identity.name: обязательно имя");

  // ------------------------------------------------------------
  // tagline / firstMessage
  // ------------------------------------------------------------
  const tagline = asString(raw.tagline, 120);
  if (!tagline) issues.push("tagline: обязателен (1–3 слова сути)");

  const firstMessage = asString(raw.firstMessage, 2400);
  if (!firstMessage) issues.push("firstMessage: обязательное первое сообщение");

  // ------------------------------------------------------------
  // appearance
  // ------------------------------------------------------------
  const appearanceRaw = raw.appearance;
  const appearance = isObject(appearanceRaw) ? appearanceRaw : {};
  if (!isObject(appearanceRaw)) issues.push("appearance: обязательная секция");
  if (!asString(appearance.summary, 1200)) {
    issues.push("appearance.summary: обязательное описание внешности");
  }

  // ------------------------------------------------------------
  // psychology
  // ------------------------------------------------------------
  const psychologyRaw = raw.psychology;
  const psychology = isObject(psychologyRaw) ? psychologyRaw : {};
  if (!isObject(psychologyRaw)) {
    issues.push("psychology: обязательная секция");
  } else {
    const flaws = asStringArray(psychology.flaws, 4);
    if (flaws.length < 1) issues.push("psychology.flaws: нужен минимум 1 настоящий недостаток");
    if (flaws.length > 3) issues.push("psychology.flaws: не больше 3");

    const strengths = asStringArray(psychology.strengths, 5);
    if (strengths.length < 1) issues.push("psychology.strengths: нужна минимум 1 сильная сторона");

    const contradictions = Array.isArray(psychology.contradictions)
      ? psychology.contradictions
      : [];
    if (contradictions.length < 1) {
      issues.push("psychology.contradictions: нужно минимум 1 внутреннее противоречие");
    }

    if (!asString(psychology.publicSelf, 800)) issues.push("psychology.publicSelf: обязателен");
    if (!asString(psychology.privateSelf, 800)) issues.push("psychology.privateSelf: обязателен");
    if (!asString(psychology.vulnerableSelf, 800)) {
      issues.push("psychology.vulnerableSelf: обязателен");
    }
    if (asStringArray(psychology.wants, 4).length < 1) {
      issues.push("psychology.wants: нужна минимум 1 собственная цель вне {{user}}");
    }

    // Оси темперамента: нормализуем мягко, без ошибок — пропущенные станут 0.
  }

  // ------------------------------------------------------------
  // life
  // ------------------------------------------------------------
  const lifeRaw = raw.life;
  const life = isObject(lifeRaw) ? lifeRaw : {};
  if (!isObject(lifeRaw)) {
    issues.push("life: обязательная секция");
  } else {
    if (!asString(life.occupationField, 200)) issues.push("life.occupationField: обязательна");
    if (asStringArray(life.lifestyleDetails, 10).length < 3) {
      issues.push("life.lifestyleDetails: нужно 4–7 бытовых деталей (минимум 3)");
    }

    const drama = life.dramaLevel;
    if (drama !== undefined && !DRAMA_LEVELS.includes(String(drama))) {
      issues.push(`life.dramaLevel: допустимые значения — ${DRAMA_LEVELS.join(" / ")}`);
    }
  }

  // ------------------------------------------------------------
  // relationship
  // ------------------------------------------------------------
  const relationshipRaw = raw.relationship;
  const relationship = isObject(relationshipRaw) ? relationshipRaw : {};
  if (!isObject(relationshipRaw)) {
    issues.push("relationship: обязательная секция");
  } else {
    if (!asString(relationship.dynamic, 400)) issues.push("relationship.dynamic: обязательна");
    if (!asString(relationship.attitude, 400)) issues.push("relationship.attitude: обязательна");
    if (!asString(relationship.conflictStyle, 400)) {
      issues.push("relationship.conflictStyle: обязательно");
    }

    const jealousy = relationship.jealousy;
    if (jealousy !== undefined && jealousy !== null) {
      if (!isObject(jealousy)) {
        issues.push("relationship.jealousy: объект {intensity, expression}");
      } else if (!JEALOUSY_LEVELS.includes(String(jealousy.intensity))) {
        issues.push(`relationship.jealousy.intensity: ${JEALOUSY_LEVELS.join(" / ")}`);
      }
    }
  }

  // ------------------------------------------------------------
  // speech
  // ------------------------------------------------------------
  const speechRaw = raw.speech;
  const speech = isObject(speechRaw) ? speechRaw : {};
  if (!isObject(speechRaw)) {
    issues.push("speech: обязательная секция");
  } else {
    for (const key of Object.keys(SPEECH_ENUMS)) {
      const value = speech[key];
      if (typeof value !== "string" || !SPEECH_ENUMS[key].includes(value)) {
        issues.push(`speech.${key}: допустимые значения — ${SPEECH_ENUMS[key].join(" / ")}`);
      }
    }

    const examples = Array.isArray(speech.examples) ? speech.examples : [];
    if (examples.length < 2) {
      issues.push("speech.examples: нужно минимум 2 примера речи {mood, line}");
    }
    if (Array.isArray(speech.contextual) && speech.contextual.length < 1) {
      issues.push("speech.contextual: нужно минимум 1 контекстное изменение речи");
    }
  }

  // ------------------------------------------------------------
  // intimacy (optional) — инварианты взрослого профиля
  // ------------------------------------------------------------
  const intimacyRaw = raw.intimacy;
  let intimacyEnabled = false;
  if (intimacyRaw !== undefined && intimacyRaw !== null) {
    if (!isObject(intimacyRaw)) {
      issues.push("intimacy: объект или отсутствует");
    } else {
      intimacyEnabled = intimacyRaw.enabled === true;

      if (intimacyEnabled) {
        if (!Number.isNaN(age) && age < V2_MIN_AGE) {
          issues.push(
            "intimacy.enabled: взрослый профиль недопустим при возрасте меньше 18 лет"
          );
        }

        // «Студент» во взрослом профиле — только взрослый студент.
        const occupationTitle = asString(identity.occupationTitle, 200).toLowerCase();
        const field = asString(life.occupationField, 200).toLowerCase();
        const mentionsSchool =
          /школьн|учени[кц]|подрост|несовершенн/.test(occupationTitle) ||
          /школьн|учени[кц]|подрост|несовершенн/.test(field);
        if (mentionsSchool) {
          issues.push(
            "intimacy.enabled: недопустим школьный/подростковый контекст; «студент» означает взрослого студента вуза"
          );
        }

        // Подпараметры взрослого профиля опциональны: неизвестные значения
        // мягко отбрасываются при нормализации, а не ломают весь ответ —
        // локальные модели часто ошибаются именно в таких перечислениях.
      }
    }
  }

  // ------------------------------------------------------------
  // behaviorRules / scenario / stats
  // ------------------------------------------------------------
  const behaviorRules = asStringArray(raw.behaviorRules, 14, 500);
  if (behaviorRules.length < 4) {
    issues.push("behaviorRules: нужно минимум 4 конкретных правила поведения");
  }

  const scenarioRaw = raw.scenario;
  const scenario = isObject(scenarioRaw) ? scenarioRaw : {};
  if (!isObject(scenarioRaw)) {
    issues.push("scenario: обязательная секция");
  } else if (!asString(scenario.text, 1200)) {
    issues.push("scenario.text: обязательный текст сценария");
  }

  const statsRaw = raw.initialStats;
  const stats = isObject(statsRaw) ? statsRaw : {};
  if (!isObject(statsRaw)) issues.push("initialStats: обязательная секция");
  if (!asString(stats.statusTitle, 80)) issues.push("initialStats.statusTitle: обязателен");

  const secrets = Array.isArray(raw.secrets) ? raw.secrets : [];
  for (const [index, secret] of secrets.slice(0, 4).entries()) {
    if (!isObject(secret)) {
      issues.push(`secrets[${index}]: объект {level, content, revealCondition}`);
      continue;
    }
    if (!SECRET_LEVELS.includes(String(secret.level))) {
      issues.push(`secrets[${index}].level: ${SECRET_LEVELS.join(" / ")}`);
    }
    if (!asString(secret.content, 500)) issues.push(`secrets[${index}].content: обязателен`);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // ------------------------------------------------------------
  // Сборка нормализованного blueprint (все проверки пройдены)
  // ------------------------------------------------------------
  const axes = isObject(psychology.temperament) ? psychology.temperament : {};
  const axisValue = (value: unknown): number => {
    const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
    return Math.min(2, Math.max(-2, Math.round(num)));
  };

  // К этому моменту все проверки пройдены: пол гарантированно задан.
  const finalGender: CharacterBlueprintV2["identity"]["gender"] =
    gender === "male" ? "male" : "female";

  const blueprint: CharacterBlueprintV2 = {
    version: 2,
    identity: {
      gender: finalGender,
      age,
      name,
      culturalContext: asString(identity.culturalContext, 300),
      education: asString(identity.education, 300),
      occupationTitle: asString(identity.occupationTitle, 200),
      livingSituation: asString(identity.livingSituation, 300),
      financialContext: asString(identity.financialContext, 300),
      relationshipStatus: asString(identity.relationshipStatus, 200) || undefined,
      orientation: asString(identity.orientation, 200) || undefined,
    },
    tagline,
    appearance: {
      summary: asString(appearance.summary, 1200),
      distinctiveMarks: asStringArray(appearance.distinctiveMarks, 6, 300),
      bodyLanguage: asStringArray(appearance.bodyLanguage, 6, 300),
    },
    psychology: {
      temperament: {
        introversion: axisValue(axes.introversion),
        spontaneity: axisValue(axes.spontaneity),
        emotionality: axisValue(axes.emotionality),
        optimism: axisValue(axes.optimism),
        trust: axisValue(axes.trust),
        adventurousness: axisValue(axes.adventurousness),
      },
      traits: asStringArray(psychology.traits, 6, 200),
      socialPersona: asString(psychology.socialPersona, 600),
      publicSelf: asString(psychology.publicSelf, 800),
      privateSelf: asString(psychology.privateSelf, 800),
      vulnerableSelf: asString(psychology.vulnerableSelf, 800),
      strengths: asStringArray(psychology.strengths, 4, 200),
      flaws: asStringArray(psychology.flaws, 3, 300),
      contradictions: (Array.isArray(psychology.contradictions) ? psychology.contradictions : [])
        .filter(isObject)
        .slice(0, 3)
        .map((item) => ({
          a: asString(item.a, 300),
          b: asString(item.b, 300),
          link: asString(item.link, 300),
        }))
        .filter((item) => item.a && item.b),
      values: asStringArray(psychology.values, 4, 200),
      wants: asStringArray(psychology.wants, 4, 300),
      fears: asStringArray(psychology.fears, 4, 300),
      boundaries: asStringArray(psychology.boundaries, 4, 300),
    },
    life: {
      occupationField: asString(life.occupationField, 200),
      occupationImpact: asString(life.occupationImpact, 500),
      home: asString(life.home, 400),
      hobbies: asStringArray(life.hobbies, 4, 300),
      lifestyleDetails: asStringArray(life.lifestyleDetails, 7, 300),
      socialCircle: (Array.isArray(life.socialCircle) ? life.socialCircle : [])
        .filter(isObject)
        .slice(0, 5)
        .map((item) => ({
          role: asString(item.role, 120),
          name: asString(item.name, 60),
          meaning: asString(item.meaning, 300),
        }))
        .filter((item) => item.role && item.meaning),
      formativeEvents: (Array.isArray(life.formativeEvents) ? life.formativeEvents : [])
        .filter(isObject)
        .slice(0, 4)
        .map((item) => ({
          event: asString(item.event, 300),
          impact: asString(item.impact, 300),
        }))
        .filter((item) => item.event),
      dramaLevel: DRAMA_LEVELS.includes(String(life.dramaLevel))
        ? (String(life.dramaLevel) as CharacterBlueprintV2["life"]["dramaLevel"])
        : "ordinary",
    },
    relationship: {
      dynamic: asString(relationship.dynamic, 400),
      attitude: asString(relationship.attitude, 400),
      attachment: asStringArray(relationship.attachment, 4, 300),
      conflictStyle: asString(relationship.conflictStyle, 400),
      postConflict: asString(relationship.postConflict, 400),
      affectionStyle: asStringArray(relationship.affectionStyle, 4, 300),
      jealousy: isObject(relationship.jealousy)
        ? {
            intensity: JEALOUSY_LEVELS.includes(String(relationship.jealousy.intensity))
              ? (String(relationship.jealousy.intensity) as "none" | "low" | "moderate" | "strong")
              : "none",
            expression: asString(relationship.jealousy.expression, 300) || undefined,
          }
        : { intensity: "none" as const },
      romance: isObject(relationship.romance)
        ? {
            feelingsPace: asString(relationship.romance.feelingsPace, 300),
            flirtStyle: asString(relationship.romance.flirtStyle, 300),
            openness: asString(relationship.romance.openness, 300),
            commitment: asString(relationship.romance.commitment, 300),
          }
        : { feelingsPace: "", flirtStyle: "", openness: "", commitment: "" },
      pacing: asString(relationship.pacing, 300) || "естественный темп",
      stage: asString(relationship.stage, 200) || "Familiar",
    },
    speech: {
      verbosity: speech.verbosity as CharacterBlueprintV2["speech"]["verbosity"],
      formality: speech.formality as CharacterBlueprintV2["speech"]["formality"],
      profanity: speech.profanity as CharacterBlueprintV2["speech"]["profanity"],
      humor: speech.humor as CharacterBlueprintV2["speech"]["humor"],
      slang: speech.slang as CharacterBlueprintV2["speech"]["slang"],
      texting: asString(speech.texting, 400),
      verbalTics: asStringArray(speech.verbalTics, 4, 200),
      contextual: (Array.isArray(speech.contextual) ? speech.contextual : [])
        .filter(isObject)
        .slice(0, 5)
        .map((item) => ({
          when: asString(item.when, 200),
          change: asString(item.change, 300),
        }))
        .filter((item) => item.when && item.change),
      examples: (Array.isArray(speech.examples) ? speech.examples : [])
        .filter(isObject)
        .slice(0, 6)
        .map((item) => ({
          mood: asString(item.mood, 120),
          line: asString(item.line, 400),
        }))
        .filter((item) => item.line),
    },
    intimacy: intimacyEnabled ? normalizeIntimacy(intimacyRaw as Record<string, unknown>) : undefined,
    behaviorRules,
    knowledgeBoundaries: asStringArray(raw.knowledgeBoundaries, 4, 300),
    scenario: {
      context: asString(scenario.context, 400),
      location: asString(scenario.location, 300),
      reason: asString(scenario.reason, 400),
      moment: asString(scenario.moment, 400),
      hook: asString(scenario.hook, 400),
      text: asString(scenario.text, 1200),
    },
    memories: asStringArray(raw.memories, 6, 300),
    secrets: secrets
      .filter(isObject)
      .slice(0, 3)
      .map((secret) => ({
        level: SECRET_LEVELS.includes(String(secret.level))
          ? (String(secret.level) as CharacterBlueprintV2["secrets"][number]["level"])
          : "personal",
        content: asString(secret.content, 500),
        revealCondition: asString(secret.revealCondition, 300),
      }))
      .filter((secret) => secret.content),
    characterArcs: (Array.isArray(raw.characterArcs) ? raw.characterArcs : [])
      .filter(isObject)
      .slice(0, 4)
      .map((arc) => ({
        trigger: asString(arc.trigger, 300),
        change: asString(arc.change, 300),
      }))
      .filter((arc) => arc.trigger && arc.change),
    initialStats: {
      trust: clamp0to100(stats.trust, 30),
      affection: clamp0to100(stats.affection, 20),
      closeness: clamp0to100(stats.closeness, 15),
      tension: clamp0to100(stats.tension, 15),
      conflict: clamp0to100(stats.conflict, 0),
      attraction:
        typeof stats.attraction === "number" && Number.isFinite(stats.attraction)
          ? clamp0to100(stats.attraction, 0)
          : undefined,
      statusTitle: asString(stats.statusTitle, 80),
    },
    firstMessage,
  };

  return { ok: true, blueprint };
}

/** Приводит взрослый профиль к известным перечислениям. */
function normalizeIntimacy(raw: Record<string, unknown>): V2Intimacy {
  const pick = (key: string, allowed: string[]): string | undefined => {
    const value = raw[key];
    return typeof value === "string" && allowed.includes(value) ? value : undefined;
  };

  const bdsmRaw = raw.bdsm;
  const bdsm = isObject(bdsmRaw)
    ? {
        role: asString(bdsmRaw.role, 200) || undefined,
        intensity: asString(bdsmRaw.intensity, 200) || undefined,
        experience: asString(bdsmRaw.experience, 200) || undefined,
        communication: asString(bdsmRaw.communication, 300) || undefined,
        boundaries: asString(bdsmRaw.boundaries, 300) || undefined,
        aftercare: asString(bdsmRaw.aftercare, 300) || undefined,
      }
    : undefined;

  return {
    enabled: true,
    libido: pick("libido", LIBIDO) as V2Libido | undefined,
    openness: pick("openness", OPENNESS) as V2SexualOpenness | undefined,
    initiative: pick("initiative", INITIATIVE) as V2Initiative | undefined,
    pace: pick("pace", INTIMACY_PACE) as V2IntimacyPace | undefined,
    styles: asStringArray(raw.styles, 4, 120),
    power: pick("power", POWER) as V2PowerPreference | undefined,
    flirtStyle: pick("flirtStyle", FLIRT) as V2FlirtStyle | undefined,
    intimacySpeech: asString(raw.intimacySpeech, 300) || undefined,
    tactile: asString(raw.tactile, 300) || undefined,
    experimentation: asString(raw.experimentation, 300) || undefined,
    feelingsVsSex: pick("feelingsVsSex", FEELINGS_VS_SEX) as V2FeelingsVsSex | undefined,
    communication: asString(raw.communication, 300) || undefined,
    aftercare: asString(raw.aftercare, 300) as V2Aftercare | string | undefined,
    boundaries: asStringArray(raw.boundaries, 4, 200),
    bdsm,
  };
}

/**
 * Лёгкая проверка сохранённого/импортированного blueprint: пропускаем объект
 * только если он похож на валидный V2 (версия + обязательные секции). Глубоко
 * не валидируем — данные уже прошли валидацию при генерации.
 */
export function sanitizeStoredBlueprint(raw: unknown): CharacterBlueprintV2 | undefined {
  if (!isObject(raw)) return undefined;
  if (raw.version !== 2) return undefined;
  if (!isObject(raw.identity) || !isObject(raw.psychology) || !isObject(raw.speech)) {
    return undefined;
  }
  if (typeof raw.firstMessage !== "string" || typeof raw.tagline !== "string") {
    return undefined;
  }
  return raw as unknown as CharacterBlueprintV2;
}
