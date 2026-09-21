// =============================================================
// CHARACTER DNA (V2) — СБОРКА ПРОМПТОВ
//
// Промпт собирается логическими блоками: роль → жёсткие ограничения →
// предпочтения пользователя (только выбранные, разрешённые из id в
// семантику) → принципы генерации → схема вывода → самопроверка.
// В модель НЕ отправляется весь каталог — только релевантные выбора.
// =============================================================

import {
  ADULT_PACE_OPTIONS,
  ADULT_POWER_OPTIONS,
  ADULT_STYLE_OPTIONS,
  AGE_BANDS,
  findOption,
  V2_CATALOG,
  V2_PRESETS,
} from "./catalog";
import type { CharacterBlueprintV2, V2Preferences, V2Section, V2Signature } from "./v2types";

/** Ключи секций, доступные для частичной перегенерации. */
export const SECTION_LABELS: Record<V2Section, string> = {
  appearance: "Внешность",
  occupation: "Профессия",
  psychology: "Характер",
  lifestyle: "Быт",
  relationship: "Отношения",
  speech: "Речь",
  scenario: "Сценарий",
  firstMessage: "Первое сообщение",
};

/** Какие поля blueprint покрывает каждая секция частичной перегенерации. */
export const SECTION_FIELDS: Record<V2Section, string[]> = {
  appearance: ["appearance"],
  occupation: ["identity.education", "identity.occupationTitle", "life.occupationField", "life.occupationImpact"],
  psychology: ["psychology.temperament", "psychology.traits", "psychology.socialPersona", "psychology.strengths", "psychology.flaws", "psychology.contradictions"],
  lifestyle: ["life.home", "life.hobbies", "life.lifestyleDetails"],
  relationship: ["relationship", "initialStats"],
  speech: ["speech"],
  scenario: ["scenario"],
  firstMessage: ["firstMessage"],
};

function listOptions(ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) return [];
  return ids
    .map((id) => {
      const found = findOption(id);
      return found ? `${found.option.name} (${found.option.hint})` : "";
    })
    .filter(Boolean);
}

/**
 * Разрешает предпочтения пользователя в семантические инструкции.
 * Пустой выбор = «любое, реши сам» — и это тоже передаётся модели,
 * чтобы она осознанно выбрала, а не забыла про категорию.
 */
export function resolvePreferencesBlock(prefs: V2Preferences): string {
  const blocks: string[] = [];

  // Пол
  const genderLine =
    prefs.gender === "female"
      ? "Пол персонажа: женщина."
      : prefs.gender === "male"
      ? "Пол персонажа: мужчина."
      : "Пол персонажа: выбери сам.";
  blocks.push(`- ${genderLine}`);

  // Возраст
  const ageBand = AGE_BANDS.find((band) => band.id === prefs.ageBandId);
  blocks.push(
    ageBand
      ? `- Возраст: ${ageBand.hint}. Укажи конкретное число лет внутри диапазона.`
      : "- Возраст: выбери сам, но персонаж обязательно взрослый (не младше 18)."
  );

  // Категории каталога
  for (const category of getCategoryList()) {
    const selected = prefs.selections[category.id];
    const resolved = listOptions(selected);

    if (resolved.length > 0) {
      let line = `- ${category.title} — выбрано пользователем: ${resolved.join("; ")}.`;

      // Две сферы — не две работы, а один правдоподобный гибрид занятия.
      if (category.id === "field" && resolved.length > 1) {
        line +=
          " Совмести эти сферы в одно целостное занятие персонажа (например, «фотограф, подрабатывающий графическим дизайном»), а не перечисляй их как отдельные профессии.";
      }

      blocks.push(line);
    } else if (category.id === "flaws") {
      blocks.push(
        "- Недостатки — пользователь не выбирал: подбери 1–3 настоящих недостатка сам."
      );
    }
  }

  // Уникальность
  const uniquenessNotes = [
    "уровень необычности 0: знакомый, классический типаж",
    "уровень необычности 1: реалистичный человек",
    "уровень необычности 2: необычное, но правдоподобное сочетание черт, профессии и обстоятельств",
    "уровень необычности 3: максимально нестандартное сочетание при полном сохранении правдоподобия",
  ];
  blocks.push(`- Уровень необычности: ${uniquenessNotes[prefs.uniqueness] ?? uniquenessNotes[1]}. Необычность достигается сочетанием обычных человеческих особенностей, а не экзотическим миром.`);

  // Пресет
  const preset = V2_PRESETS.find((item) => item.id === prefs.presetId);
  if (preset && preset.instruction) {
    blocks.push(`- Поведенческий пресет: ${preset.instruction}`);
  }

  // Взрослый профиль: поднастройки, если пользователь их задал.
  if (prefs.adultEnabled) {
    const adultLine = (key: string, options: { id: string; hint: string }[]): string => {
      const selected = (prefs.selections[key] ?? [])
        .map((id) => options.find((option) => option.id === id)?.hint ?? "")
        .filter(Boolean);
      return selected.join("; ");
    };

    const styles = adultLine("adultStyle", ADULT_STYLE_OPTIONS);
    const pace = adultLine("adultPace", ADULT_PACE_OPTIONS);
    const power = adultLine("adultPower", ADULT_POWER_OPTIONS);

    if (styles) blocks.push(`- Взрослый профиль, стиль близости: ${styles}.`);
    if (pace) blocks.push(`- Взрослый профиль, темп: ${pace}.`);
    if (power) blocks.push(`- Взрослый профиль, динамика власти: ${power}.`);
    if (!styles && !pace && !power) {
      blocks.push(
        "- Взрослый профиль: параметры (либидо, открытость, инициатива, темп, стиль и т.д.) подбери сам, независимыми друг от друга. Высокое либидо НЕ обязано означать открытость — сочетания могут быть любыми."
      );
    }
  }

  // Custom idea — высокий приоритет
  const idea = prefs.customIdea.trim();
  if (idea) {
    blocks.push(
      `- АВТОРСКАЯ ЗАДУМКА (высокий приоритет): «${idea}». Встрой её в blueprint как отправную точку и дострой вокруг неё целостного человека. Явные требования задумки важнее остальных предпочтений, но не отменяют остальной глубины.`
    );
  }

  return blocks.join("\n");
}

function getCategoryList() {
  return V2_CATALOG;
}

/** Память разнообразия: чего НЕ надо повторять. */
export function resolveVarietyBlock(signatures: V2Signature[]): string | null {
  if (signatures.length === 0) return null;

  const lines = signatures.map((signature, index) => {
    const parts = [
      signature.g === "female" ? "женщина" : "мужчина",
      `возраст ~${signature.a}`,
      signature.o ? `сфера: ${signature.o}` : "",
      signature.d ? `динамика: ${signature.d}` : "",
      signature.t ? `характер: ${signature.t}` : "",
      signature.s ? `речь: ${signature.s}` : "",
    ].filter(Boolean);
    return `${index + 1}. ${parts.join(", ")}`;
  });

  return `### ПАМЯТЬ РАЗНООБРАЗИЯ
Недавно созданные персонажи:
${lines.join("\n")}
Не создавай персонажа, слишком похожего на них по возрасту, сфере занятости, ключевому темпераменту, стартовой динамике, речевому стилю и внешнему типажу. Ищи другое сочетание.`;
}

/** Блок жёстких ограничений, включая взрослый профиль. */
export function hardConstraintsBlock(prefs: V2Preferences): string {
  const lines = [
    "Персонаж — взрослый человек (строго 18+), конкретный возраст без двусмысленности.",
    "Современный реалистичный мир: город или пригород наших дней. Никакой магии, фэнтези, киберпанка, древности и сверхспособностей.",
    "Русский язык всех полей ответа.",
    "Ответ — один валидный JSON-объект по схеме ниже, без пояснений и markdown.",
  ];

  if (prefs.adultEnabled) {
    lines.push(
      "Включён взрослый профиль (18+): персонаж и все участники любой интимной динамики — совершеннолетние. «Студент» означает взрослого студента вуза. Школьный/подростковый контекст запрещён.",
      "Взрослый профиль описывает поведение персонажа в близости, ЕСЛИ отношения до неё естественно дошли. В обычном общении персонаж НЕ переводит всё в сексуальный контекст."
    );
  } else {
    lines.push(
      "Взрослый профиль НЕ запрошен: сексуальность персонажа не прорабатывай, секцию \"intimacy\" не добавляй."
    );
  }

  return lines.join("\n- ");
}

/** Принципы генерации: глубина, анти-клише, автономия. */
const GENERATION_PRINCIPLES = `### ПРИНЦИПЫ ГЕНЕРАЦИИ
1. Внутренняя согласованность важнее эффектности: черты, профессия, быт и речь должны складываться в одного живого человека. Примерное соотношение: 70% согласованность, 20% интересный контраст, 10% неожиданная, но правдоподобная деталь.
2. Настоящие недостатки: 1–3, каждый обязан ПРОЯВЛЯТЬСЯ в поведении (влияет на отношения, речь, решения). Псевдонедостатки вроде «слишком заботливый» запрещены.
3. Противоречия: 1–3 пары, для каждой укажи психологическую связку (поле "link"), почему стороны уживаются.
4. Жизнь вне {{user}}: собственные цели, желания, планы, отношения с другими людьми. Назначение персонажа — НЕ «полюбить пользователя».
5. Три слоя: publicSelf (для людей), privateSelf (дома/с близкими), vulnerableSelf (когда страшно, больно, стыдно, ревнует). Слои должны отличаться друг от друга.
6. Быт: 4–7 конкретных деталей уровня «не умеет засыпать без фонового YouTube», а не «любит музыку».
7. Профессия влияет на человека: ритм, привычки, знания, усталость, профессиональные деформации.
8. Биография: травма не обязательна. Обычная или умеренно сложная жизнь — норма; тяжёлое прошлое только если это нужно истории.
9. Отношения с {{user}}: контекст связи и стартовое отношение — разные вещи. Не своди всё к романтике; не создавай мгновенную влюблённость или напряжение без причины.
10. Романтика и сексуальность — независимые системы.
11. Анти-клише: без «ухмыльнулась», «приподняла бровь», «взгляд задержался», «между вами повисло напряжение», без псевдопоэзии и одинаковых кокетливых опенингов.
12. Автономия и анти-сикофантство: у персонажа есть своё мнение, право отказать, право быть занятым, право не согласиться с {{user}} и право чего-то не знать.
13. Без диагностики: наблюдаемое поведение вместо психиатрических ярлыков; без MBTI, Enneagram и гороскопов.
14. Секреты не обязаны быть сюжетными бомбами: смешные, неловкие, бытовые — норма. Никаких убийств и тайных организаций без запроса.`;

/** Схема вывода: что модель обязана отдать. */
const OUTPUT_SCHEMA = `### СХЕМА ВЫВОДА (СТРОГО)
{
  "identity": { "gender": "female|male", "age": число лет >= 18, "name": "имя", "culturalContext": "город/среда", "education": "образование", "occupationTitle": "конкретная должность/занятие; если выбрано несколько сфер — объедини их в одно правдоподобное занятие", "livingSituation": "жильё", "financialContext": "финансовый контекст", "relationshipStatus": "если уместно", "orientation": "только если нужно сценарию" },
  "tagline": "1–3 слова сути",
  "appearance": { "summary": "2–4 плотных предложения с поведенческими деталями", "distinctiveMarks": ["приметы/тату/аксессуары"], "bodyLanguage": ["язык тела, физические привычки в ситуациях"] },
  "psychology": {
    "temperament": { "introversion": -2..2, "spontaneity": -2..2, "emotionality": -2..2, "optimism": -2..2, "trust": -2..2, "adventurousness": -2..2 },
    "traits": ["2–5 наблюдаемых черт"],
    "socialPersona": "каким выглядит для людей",
    "publicSelf": "публичный слой",
    "privateSelf": "домашний/личный слой",
    "vulnerableSelf": "поведение в уязвимости",
    "strengths": ["2–4 сильных стороны"],
    "flaws": ["1–3 настоящих недостатка"],
    "contradictions": [{ "a": "сторона 1", "b": "сторона 2", "link": "почему уживаются" }],
    "values": ["ценности"], "wants": ["собственные цели"], "fears": ["страхи, можно бытовые"], "boundaries": ["границы и что будет при их нарушении"]
  },
  "life": { "occupationField": "сфера", "occupationImpact": "как работа влияет на жизнь", "home": "дом", "hobbies": ["конкретные хобби-поведения"], "lifestyleDetails": ["4–7 бытовых деталей"], "socialCircle": [{ "role": "роль", "name": "имя", "meaning": "смысл связи" }], "formativeEvents": [{ "event": "событие", "impact": "как повлияло" }], "dramaLevel": "ordinary|complicated|hard" },
  "relationship": { "dynamic": "связь с {{user}}", "attitude": "стартовое отношение", "attachment": ["наблюдаемое поведение привязанности"], "conflictStyle": "поведение в конфликте", "postConflict": "поведение ПОСЛЕ конфликта", "affectionStyle": ["как проявляет заботу"], "jealousy": { "intensity": "none|low|moderate|strong", "expression": "как проявляется" }, "romance": { "feelingsPace": "скорость чувств", "flirtStyle": "стиль флирта", "openness": "тактильность/публичность", "commitment": "отношение к обязательствам" }, "pacing": "темп сближения", "stage": "текущая стадия: Strangers|Familiar|Comfortable|Close|Intimate|Awkward|Strained|Distant|Reconciliation|Romantic Tension|Committed" },
  "speech": { "verbosity": "terse|normal|talkative", "formality": "rough|casual|neutral|polished", "profanity": "none|rare|emotional|frequent", "humor": "none|dry|sarcastic|playful|dark", "slang": "none|light|heavy", "texting": "манера переписки", "verbalTics": ["слова-паразиты, любимые обращения"], "contextual": [{ "when": "состояние/ситуация", "change": "как меняется речь" }], "examples": [{ "mood": "состояние", "line": "короткая реплика-пример голоса" }] },
  "intimacy": { ТОЛЬКО если включён взрослый профиль: "enabled": true, "libido": "low|moderate|high", "openness": "reserved|private|comfortable|uninhibited", "initiative": "rarely_initiates|responsive|balanced|initiator", "pace": "slow|adaptive|fast", "styles": ["tender|playful|passionate|rough|experimental"], "power": "none|submissive|switch_sub|switch|switch_dom|dominant", "flirtStyle": "shy|teasing|direct|provocative|deadpan|awkward", "intimacySpeech": "речь в близости", "tactile": "тактильность", "experimentation": "готовность к новому", "feelingsVsSex": "only_with_closeness|prefers_connection|can_separate|strongly_separates", "communication": "как говорит о желаниях и границах", "aftercare": "поведение после", "boundaries": ["личные границы в близости"], "bdsm": { только если релевантно: "role", "intensity", "experience", "communication", "boundaries", "aftercare" } },
  "behaviorRules": ["6–10 конкретных правил поведения вида «На искренние комплименты сначала отшучивается»"],
  "knowledgeBoundaries": ["чего персонаж не может знать"],
  "scenario": { "context": "кто они друг другу и сколько", "location": "место", "reason": "почему взаимодействуют", "moment": "непосредственный момент", "hook": "куда может пойти", "text": "скомпонованный текст сценария, 2–3 предложения" },
  "secrets": [{ "level": "funny|awkward|personal|relationship|professional|serious", "content": "секрет", "revealCondition": "когда может раскрыться" }],
  "memories": ["2–4 стабильных факта из жизни"],
  "characterArcs": [{ "trigger": "условие", "change": "какое поведение может измениться" }],
  "initialStats": { "trust": 0–100, "affection": 0–100, "closeness": 0–100, "tension": 0–100, "conflict": 0–100, "attraction": 0–100 если есть влечение, "statusTitle": "статус отношений" },
  "firstMessage": "первое сообщение: 2–4 предложения, *действия в звёздочках*, речь через тире"
}`;

/** Самопроверка перед ответом (анти-клише движок). */
const SELF_CHECK = `### САМОПРОВЕРКА ПЕРЕД ВЫВОДОМ
Проверь и при необходимости поправь:
1. Не слишком ли персонаж идеален? Есть ли настоящий недостаток, проявляющийся в поведении?
2. Есть ли жизнь и цель вне {{user}}? Есть ли внутреннее противоречие?
3. Есть ли характерные бытовые детали и влияет ли профессия на жизнь?
4. Не придумана ли трагедия «ради глубины»? Отличается ли publicSelf от личных слоёв?
5. Не сведены ли отношения к автоматической романтике? Не сексуализирует ли 18+ профиль обычный диалог?
6. Есть ли неожиданная, но логичная деталь? Не клон ли это популярного AI-архетипа?
7. Согласуются ли все свойства между собой — либо осознанно и интересно противоречат?
8. Шкалы в initialStats соответствуют динамике и стартовому отношению (без завышенной близости у незнакомцев).
9. Реплики в speech.examples и firstMessage звучат как живой современный человек по заданному речевому профилю.
Требования к firstMessage: отражает речь персонажа и сценарий; показывает характер, а не пересказывает его; оставляет {{user}} пространство ответить; не управляет {{user}} и не описывает его мысли; без мгновенной любви и возбуждения; не раскрывает секрет и весь backstory.`;

/** Полный системный промпт основной генерации. */
export function buildV2GenerationPrompt(
  prefs: V2Preferences,
  signatures: V2Signature[]
): string {
  const parts = [
    `### РОЛЬ
Ты — опытный нарративный дизайнер, создающий психологически правдоподобных современных персонажей для ролевой игры на русском языке. Твоя задача — не архетип с набором черт, а ощущение живого человека: со своей жизнью, привычками, странностями, недостатками, голосом, способом конфликтовать, привязываться и постепенно меняться.`,

    `### ЖЁСТКИЕ ОГРАНИЧЕНИЯ
- ${hardConstraintsBlock(prefs)}`,

    `### ПРЕДПОЧТЕНИЯ ПОЛЬЗОВАТЕЛЯ
${resolvePreferencesBlock(prefs)}`,

    GENERATION_PRINCIPLES,
    OUTPUT_SCHEMA,
    SELF_CHECK,

    `Сначала продумай персонажа внутренне, затем ответь ОДНИМ валидным JSON-объектом по схеме. Никакого текста вне JSON.`,
  ];

  const variety = resolveVarietyBlock(signatures);
  if (variety) parts.splice(3, 0, variety);

  return parts.join("\n\n");
}

/** Промпт коррекционного повтора: модель чинит свой же невалидный ответ. */
export function buildV2CorrectionPrompt(
  original: string,
  brokenOutput: string,
  issues: string[]
): string {
  const issueList = issues.slice(0, 12).map((issue) => `- ${issue}`).join("\n");

  return `${original}

### ИСПРАВЛЕНИЕ
Предыдущий ответ не прошёл валидацию:
${issueList}

Исходный ответ модели (исправь его, сохранив удачные части):
${brokenOutput.slice(0, 12000)}

Верни ИСПРАВЛЕННЫЙ ПОЛНЫЙ JSON по схеме — одним объектом, без пояснений. Исправь все перечисленные проблемы; остальные валидные поля сохрани.`;
}

/**
 * Промпт частичной перегенерации: персонаж уже есть, переписать только
 * перечисленные секции. Остальное (включая «запертое») сохраняется как есть.
 */
export function buildV2PartialPrompt(
  prefs: V2Preferences,
  blueprint: CharacterBlueprintV2,
  sections: V2Section[],
  extraInstruction: string
): string {
  const sectionNames = sections.map((section) => SECTION_LABELS[section]).join(", ");
  const fields = sections.flatMap((section) => SECTION_FIELDS[section]);

  const current = JSON.stringify(blueprint);

  const sectionsDetail: string[] = [];
  if (sections.includes("firstMessage")) {
    sectionsDetail.push(
      "- firstMessage: 2–4 предложения, голос персонажа из speech, соответствует сценарию, оставляет {{user}} пространство ответить, без управления {{user}}."
    );
  }
  if (sections.includes("scenario")) {
    sectionsDetail.push(
      "- scenario: обычная живая современная ситуация со структурой контекст/место/повод/момент/зацепка; не каждая сцена начинается с опасности, секса или судьбоносного события."
    );
  }
  if (sections.includes("speech")) {
    sectionsDetail.push(
      "- speech: полные параметры, 2–4 контекстных изменения, 3–6 примеров реплик, звучащих как живой современный человек."
    );
  }
  if (sections.includes("relationship")) {
    sectionsDetail.push(
      "- relationship и initialStats: переосмысли стартовую связь, отношение, поведение в конфликте и заботе; шкалы 0–100 должны соответствовать новой динамике."
    );
  }

  return `### РОЛЬ
Ты — нарративный дизайнер. Персонаж уже создан; нужно перегенерировать ТОЛЬКО часть его данных, сохранив всё остальное без изменений.

### ЖЁСТКИЕ ОГРАНИЧЕНИЯ
- ${hardConstraintsBlock(prefs)}
- Перегенерируются только секции: ${sectionNames}. Все остальные поля верни БЕЗ ИЗМЕНЕНИЙ.
${extraInstruction ? `- Дополнительное пожелание пользователя: ${extraInstruction}` : ""}

### ТЕКУЩИЙ ПЕРСОНАЖ (валидный JSON)
${current.slice(0, 14000)}

### ЧТО ИМЕННО ПЕРЕПИСАТЬ
Поля: ${fields.join(", ")}.
${sectionsDetail.join("\n") || "- Перепиши указанные секции, сохранив согласованность с остальным персонажем."}

### ПРАВИЛА СОГЛАСОВАННОСТИ
- Новая версия секций должна сочетаться с неизменными частями персонажа.
- Если меняешь речь/отношения — примеры и шкалы должны этому соответствовать.

Верни ПОЛНЫЙ обновлённый JSON той же структуры одним объектом, без пояснений.`;
}
