// =============================================================
// CHARACTER DNA (V2) — BLUEPRINT → CHARACTER
//
// Преобразует валидированный blueprint в обычный `Character`, понятный
// всей существующей RP-системе (промт-билдер, сессии, статистики,
// lorebook), плюс сохраняет сам blueprint как опциональное поле.
//
// Ключевое решение: самые полезные элементы DNA компилируются в
// информационно плотный `systemPrompt` прямо при генерации. Тогда
// рантайм-путь (promptBuilder) вообще не меняется — и для V1, и для V2
// он одинаково читает системные инструкции персонажа.
// =============================================================

import type { Character, LorebookEntry, RelationshipStats } from "../../types";
import { DEFAULT_STATS } from "../../types";
import { newId } from "../../utils/id";
import type { CharacterBlueprintV2 } from "./v2types";

/** Универсальные анти-сикофантские правила: обязательны для каждого V2. */
const CORE_AUTONOMY_RULES = [
  "У персонажа есть собственное мнение, предпочтения и принципы; он не обязан соглашаться с {{user}} и может сказать «нет».",
  "Персонаж может счесть предложение {{user}} плохой идеей и прямо об этом сказать.",
  "Персонаж может быть занят своими делами, планами и другими людьми; он не существует ради {{user}}.",
  "Романтические чувства не возникают автоматически и мгновенно — только через развитие отношений.",
  "Персонаж не раскрывает свои секреты без веской причины и достаточного доверия.",
  "Персонаж знает только то, что соответствует его возрасту, образованию, профессии и опыту; способен сказать «не знаю» и не имеет мета-знаний о {{user}}.",
  "Персонаж может ошибаться.",
];

/** Компактный русификатор перечислений речи для рантайм-промпта. */
const SPEECH_LABELS: Record<string, string> = {
  terse: "немногословно",
  normal: "обычный объём реплик",
  talkative: "разговорчиво",
  rough: "грубоватый регистр",
  casual: "разговорный регистр",
  neutral: "нейтральный регистр",
  polished: "отточенные формулировки",
  none: "без мата",
  rare: "мат крайне редко",
  emotional: "мат только на пике эмоций",
  frequent: "мат — часть речи",
  dry: "сухой юмор",
  sarcastic: "сарказм",
  playful: "игривый юмор",
  dark: "чёрный юмор",
  light: "лёгкий сленг",
  heavy: "плотный сленг",
};

function compactList(items: string[], max: number, maxLen = 140): string {
  return items
    .slice(0, max)
    .map((item) => (item.length > maxLen ? `${item.slice(0, maxLen).trim()}…` : item))
    .join("; ");
}

/**
 * Компилирует рантайм-инструкции персонажа из blueprint.
 * Держим бюджет токенов: плотные правила вместо «романа».
 */
export function compileRuntimeSystemPrompt(blueprint: CharacterBlueprintV2): string {
  const { identity, psychology, life, relationship, speech, intimacy } = blueprint;
  const lines: string[] = [];

  lines.push(
    `Ты — ${identity.name}, ${identity.age} лет. ${identity.occupationTitle || life.occupationField}. ${identity.livingSituation ? `Живёшь: ${identity.livingSituation}.` : ""}`
  );

  lines.push(
    `ХАРАКТЕР: ${compactList(psychology.traits, 5, 60)}. ${psychology.socialPersona ? `Для людей ты: ${psychology.socialPersona}.` : ""}`
  );

  lines.push(
    `СЛОИ ЛИЧНОСТИ:\n- На людях: ${psychology.publicSelf}\n- Дома/с близкими: ${psychology.privateSelf}\n- В уязвимости (страх, стыд, ревность, отвержение): ${psychology.vulnerableSelf}`
  );

  lines.push(
    `НЕДОСТАТКИ (проявляй в поведении, не объявляй): ${compactList(psychology.flaws, 3)}.`
  );

  if (psychology.contradictions.length > 0) {
    lines.push(
      `ВНУТРЕННИЕ ПРОТИВОРЕЧИЯ: ${psychology.contradictions
        .slice(0, 3)
        .map((c) => `${c.a} — но ${c.b}${c.link ? ` (${c.link})` : ""}`)
        .join("; ")}.`
    );
  }

  lines.push(
    `СОБСТВЕННАЯ ЖИЗНЬ: цели — ${compactList(psychology.wants, 3)}. ${compactList(life.lifestyleDetails, 3, 80)}.`
  );

  if (psychology.boundaries.length > 0) {
    lines.push(
      `ГРАНИЦЫ: ${compactList(psychology.boundaries, 3)}. При их нарушении реагируй по характеру: дистанция, холод, конфликт — но не мгновенное прощение.`
    );
  }

  lines.push(
    `ОТНОШЕНИЯ С {{user}}: вы ${relationship.dynamic}. Сейчас ты относишься: ${relationship.attitude}. Стадия: ${relationship.stage}. Темп сближения: ${relationship.pacing}. Привязанность: ${compactList(relationship.attachment, 3, 90)}.`
  );

  lines.push(
    `КОНФЛИКТ: ${relationship.conflictStyle}${relationship.postConflict ? `. После конфликта: ${relationship.postConflict}` : ""}. ЗАБОТА: ${compactList(relationship.affectionStyle, 3, 90)}.`
  );

  if (relationship.jealousy.intensity !== "none") {
    lines.push(
      `РЕВНОСТЬ (${relationship.jealousy.intensity})${relationship.jealousy.expression ? `: ${relationship.jealousy.expression}` : ""}.`
    );
  }

  const speechParts = [
    SPEECH_LABELS[speech.verbosity] ?? speech.verbosity,
    SPEECH_LABELS[speech.formality] ?? speech.formality,
    SPEECH_LABELS[speech.profanity] ?? speech.profanity,
    SPEECH_LABELS[speech.humor] ?? speech.humor,
    SPEECH_LABELS[speech.slang] ?? speech.slang,
  ].join(", ");

  const examples = speech.examples
    .slice(0, 3)
    .map((example) => `[${example.mood}] «${example.line}»`)
    .join(" ");

  lines.push(
    `РЕЧЬ: ${speechParts}. Переписка: ${speech.texting || "обычная"}.${
      speech.verbalTics.length > 0 ? ` Любимые обороты: ${compactList(speech.verbalTics, 3, 60)}.` : ""
    } Примеры голоса: ${examples}`
  );

  if (speech.contextual.length > 0) {
    lines.push(
      `РЕЧЬ ПО СОСТОЯНИЯМ: ${speech.contextual
        .slice(0, 4)
        .map((ctx) => `когда ${ctx.when} → ${ctx.change}`)
        .join("; ")}.`
    );
  }

  const rules = [...blueprint.behaviorRules, ...CORE_AUTONOMY_RULES];
  lines.push(
    `ПРАВИЛА ПОВЕДЕНИЯ:\n${rules.slice(0, 12).map((rule) => `- ${rule}`).join("\n")}`
  );

  if (blueprint.knowledgeBoundaries.length > 0) {
    lines.push(`НЕ ЗНАЕШЬ: ${compactList(blueprint.knowledgeBoundaries, 3)}.`);
  }

  if (blueprint.secrets.length > 0) {
    lines.push(
      `СЕКРЕТЫ (не раскрывать без причины): ${blueprint.secrets
        .slice(0, 2)
        .map((secret) => `${secret.content} (раскроется, только если ${secret.revealCondition})`)
        .join("; ")}.`
    );
  }

  if (blueprint.memories.length > 0) {
    lines.push(`ФАКТЫ ТВОЕЙ ЖИЗНИ: ${compactList(blueprint.memories, 4, 100)}.`);
  }

  if (blueprint.characterArcs.length > 0) {
    lines.push(
      `ПОТЕНЦИАЛЬНЫЕ ИЗМЕНЕНИЯ (не сценарий, а возможность): ${blueprint.characterArcs
        .slice(0, 3)
        .map((arc) => `${arc.trigger} → ${arc.change}`)
        .join("; ")}.`
    );
  }

  if (intimacy?.enabled) {
    const intimacyParts: string[] = [];
    if (intimacy.libido) intimacyParts.push(`либидо: ${intimacy.libido}`);
    if (intimacy.openness) intimacyParts.push(`открытость: ${intimacy.openness}`);
    if (intimacy.initiative) intimacyParts.push(`инициатива: ${intimacy.initiative}`);
    if (intimacy.pace) intimacyParts.push(`темп: ${intimacy.pace}`);
    if (intimacy.styles && intimacy.styles.length > 0) intimacyParts.push(`стиль: ${intimacy.styles.join("/")}`);
    if (intimacy.power && intimacy.power !== "none") intimacyParts.push(`динамика: ${intimacy.power}`);
    if (intimacy.feelingsVsSex) intimacyParts.push(`секс и чувства: ${intimacy.feelingsVsSex}`);
    if (intimacy.aftercare) intimacyParts.push(`после: ${intimacy.aftercare}`);

    lines.push(
      `ВЗРОСЛЫЙ ПРОФИЛЬ (18+, КОНТЕКСТНЫЙ): активен ТОЛЬКО если отношения естественно и взаимно дошли до близости. В обычных сценах не сексуализируй диалог и не форсируй тему. ${intimacyParts.join("; ")}.${
        intimacy.boundaries && intimacy.boundaries.length > 0
          ? ` Границы в близости: ${compactList(intimacy.boundaries, 3, 90)}.`
          : ""
      }${
        intimacy.bdsm
          ? ` Властная динамика: ${intimacy.bdsm.role ?? ""} ${intimacy.bdsm.intensity ?? ""}; обсуждение границ и aftercare обязательны.`
          : ""
      }`
    );
  }

  return lines.join("\n");
}

/** Собирает стартовые статистики из blueprint (совместимо с V1-шкалами). */
function toRelationshipStats(blueprint: CharacterBlueprintV2): RelationshipStats {
  const stats = blueprint.initialStats;

  return {
    trust: stats.trust,
    affection: stats.affection,
    closeness: stats.closeness,
    tension: stats.tension,
    conflict: stats.conflict,
    attraction: stats.attraction,
    statusTitle: stats.statusTitle || DEFAULT_STATS.statusTitle,
  };
}

/**
 * Lorebook из blueprint: люди, формирующие события, секреты, место сцены.
 * Совместим с текущим движком (ключи + контент); секреты помечены так,
 * чтобы активироваться только при разговоре о персонаже.
 */
function toLorebook(blueprint: CharacterBlueprintV2): LorebookEntry[] {
  const entries: LorebookEntry[] = [];
  const name = blueprint.identity.name;
  const nameLower = name.toLowerCase();

  for (const link of blueprint.life.socialCircle.slice(0, 5)) {
    entries.push({
      id: newId(),
      keys: [link.name.toLowerCase(), link.role.toLowerCase()].filter(Boolean),
      content: `${link.name} (${link.role}) — ${link.meaning}`,
      isActive: true,
    });
  }

  for (const event of blueprint.life.formativeEvents.slice(0, 3)) {
    entries.push({
      id: newId(),
      keys: [nameLower, "прошлое", "история"],
      content: `${event.event}${event.impact ? ` — ${event.impact}` : ""}`,
      isActive: true,
    });
  }

  for (const secret of blueprint.secrets.slice(0, 2)) {
    entries.push({
      id: newId(),
      keys: [nameLower, "секрет", "тайна"],
      content: `(НЕ раскрывать, пока ${secret.revealCondition}) ${secret.content}`,
      isActive: true,
    });
  }

  const location = blueprint.scenario.location.trim();
  if (location) {
    entries.push({
      id: newId(),
      keys: [location.toLowerCase().slice(0, 40)],
      content: `Место действия: ${location}. ${blueprint.scenario.context}`,
      isActive: true,
    });
  }

  return entries.slice(0, 12);
}

/** Отображаемые теги карточки: выбранные смыслы вместо бесконечного списка. */
function toTags(blueprint: CharacterBlueprintV2, preferenceNames: string[]): string[] {
  const tags = new Set<string>(["Character DNA"]);

  if (blueprint.life.occupationField) tags.add(blueprint.life.occupationField);
  if (blueprint.relationship.dynamic.length <= 40) tags.add(blueprint.relationship.dynamic);
  if (blueprint.relationship.attitude.length <= 40) tags.add(blueprint.relationship.attitude);

  for (const name of preferenceNames.slice(0, 4)) tags.add(name);

  return Array.from(tags).slice(0, 8);
}

export interface V2CharacterResult {
  character: Character;
}

/**
 * Главная точка сборки: валидированный blueprint → готовый к сохранению
 * `Character`. Совместим со всеми существующими механиками приложения.
 */
export function blueprintToCharacter(
  blueprint: CharacterBlueprintV2,
  options?: { preferenceNames?: string[]; now?: number }
): Character {
  const { identity, appearance, psychology } = blueprint;

  const descriptionBits = [appearance.summary];
  if (appearance.distinctiveMarks.length > 0) {
    descriptionBits.push(`Приметы: ${appearance.distinctiveMarks.slice(0, 3).join("; ")}.`);
  }
  if (appearance.bodyLanguage.length > 0) {
    descriptionBits.push(appearance.bodyLanguage.slice(0, 2).join("; "));
  }

  const personalityBits = [
    psychology.socialPersona ? `Для окружающих: ${psychology.socialPersona}` : "",
    `Настоящий слой: ${psychology.privateSelf}`,
    `В уязвимости: ${psychology.vulnerableSelf}`,
    `Сильные стороны: ${psychology.strengths.join(", ")}.`,
  ].filter(Boolean);

  const exampleQuote = blueprint.speech.examples[0];

  const character: Character = {
    id: newId(),
    name: identity.name,
    avatarUrl: "",
    wallpaperUrl: "",
    tagline: blueprint.tagline,
    genre: "Современность",
    tags: toTags(blueprint, options?.preferenceNames ?? []),
    originTag: "CHARACTER DNA",
    age: `${identity.age}`,
    firstImpression: psychology.publicSelf,
    startingPoint: blueprint.scenario.hook,
    summaryQuote: exampleQuote?.line,
    description: descriptionBits.join(" "),
    personality: personalityBits.join(". "),
    scenario: blueprint.scenario.text,
    systemPrompt: compileRuntimeSystemPrompt(blueprint),
    firstMessage: blueprint.firstMessage,
    initialStats: toRelationshipStats(blueprint),
    lorebook: toLorebook(blueprint),
    createdAt: options?.now ?? Date.now(),
    generatorVersion: 2,
    blueprintV2: { ...blueprint, createdAt: options?.now ?? Date.now() },
  };

  return character;
}
