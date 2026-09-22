import { newId } from "../../utils/id";
import type { ApiConfig } from "../../types";
import { requestV2Json, V2JsonError } from "../v2/provider";
import { getRecentGroupSignatures, makeGroupSignature, rememberGroupSignature } from "./signatures";
import { buildGroupCorrectionPrompt, buildGroupGenerationPrompt, buildGroupPartialPrompt } from "./prompt";
import { validateGroupBlueprint } from "./schema";
import type {
  GeneratedCharacterDraft,
  GeneratedGroup,
  GeneratedGroupRelation,
  GroupBlueprint,
  GroupGenerationResult,
  GroupPreferences,
  GroupRegenerationSection,
} from "./types";

const MAX_ATTEMPTS = 2;
const GROUP_MAX_TOKENS = 7600;

export class GroupGenerationError extends Error {}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizedPreferences(prefs: GroupPreferences): GroupPreferences {
  return {
    ...prefs,
    size: Math.min(4, Math.max(2, Math.round(Number.isFinite(prefs.size) ? prefs.size : 2))),
    customIdea: typeof prefs.customIdea === "string" ? prefs.customIdea.trim().slice(0, 1600) : "",
    selections: Object.fromEntries(
      Object.entries(prefs.selections ?? {}).map(([key, ids]) => [key, Array.isArray(ids) ? ids.slice(0, 4) : []])
    ),
  };
}

export async function generateGroupBlueprint(
  apiConfig: ApiConfig,
  inputPrefs: GroupPreferences
): Promise<GroupGenerationResult> {
  const prefs = normalizedPreferences(inputPrefs);
  const basePrompt = buildGroupGenerationPrompt(prefs, getRecentGroupSignatures());
  let lastRaw = "";
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let parsed: unknown;
    try {
      parsed = await requestV2Json(
        apiConfig,
        attempt === 1
          ? [{ role: "user", content: basePrompt }]
          : [
              { role: "user", content: basePrompt },
              { role: "assistant", content: lastRaw },
              { role: "user", content: buildGroupCorrectionPrompt(basePrompt, lastRaw, lastIssues) },
            ],
        GROUP_MAX_TOKENS
      );
    } catch (cause) {
      if (cause instanceof V2JsonError) {
        lastRaw = cause.message;
        lastIssues = ["Ответ не является валидным JSON"];
        if (attempt < MAX_ATTEMPTS) continue;
        throw new GroupGenerationError(
          "Модель не смогла отдать структурированную группу. Попробуйте ещё раз или выберите модель с большим контекстом."
        );
      }
      throw cause;
    }

    lastRaw = safeStringify(parsed);
    const validation = validateGroupBlueprint(parsed, prefs.size);
    if (validation.ok) {
      rememberGroupSignature(makeGroupSignature(validation.blueprint));
      return {
        blueprint: validation.blueprint,
        group: blueprintToGeneratedGroup(validation.blueprint),
        corrected: attempt > 1,
      };
    }

    lastIssues = validation.issues;
  }

  throw new GroupGenerationError(
    `Модель дважды вернула группу с ошибками: ${lastIssues.slice(0, 4).join("; ")}. Попробуйте ещё раз.`
  );
}

/**
 * Перегенерирует один смысловой слой, сохраняя остальные слои blueprint.
 * Полный JSON всё равно проверяется той же схемой, чтобы не получить
 * частично повреждённую ветку.
 */
export async function regenerateGroupSection(
  apiConfig: ApiConfig,
  inputPrefs: GroupPreferences,
  blueprint: GroupBlueprint,
  section: GroupRegenerationSection,
  targetKey?: string
): Promise<GroupGenerationResult> {
  const prefs = normalizedPreferences(inputPrefs);
  const targetInstruction = section === "cast" && targetKey
    ? `Перепиши только персонажа со стабильным key «${targetKey}». Остальных персонажей скопируй без изменений, сохрани их ключи, relations и opening.`
    : "";
  const basePrompt = buildGroupPartialPrompt(prefs, blueprint, section, targetInstruction);
  let lastRaw = "";
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let parsed: unknown;
    try {
      parsed = await requestV2Json(
        apiConfig,
        attempt === 1
          ? [{ role: "user", content: basePrompt }]
          : [
              { role: "user", content: basePrompt },
              { role: "assistant", content: lastRaw },
              { role: "user", content: buildGroupCorrectionPrompt(basePrompt, lastRaw, lastIssues) },
            ],
        GROUP_MAX_TOKENS
      );
    } catch (cause) {
      if (cause instanceof V2JsonError) {
        lastRaw = cause.message;
        lastIssues = ["Ответ не является валидным JSON"];
        if (attempt < MAX_ATTEMPTS) continue;
        throw new GroupGenerationError("Не удалось перегенерировать часть группы: модель вернула невалидный JSON.");
      }
      throw cause;
    }

    lastRaw = safeStringify(parsed);
    const validation = validateGroupBlueprint(parsed, prefs.size);
    if (validation.ok) {
      const merged = mergeSection(blueprint, validation.blueprint, section, targetKey);
      return {
        blueprint: merged,
        group: blueprintToGeneratedGroup(merged),
        corrected: attempt > 1,
      };
    }
    lastIssues = validation.issues;
  }

  throw new GroupGenerationError(
    `Перегенерация не прошла проверку: ${lastIssues.slice(0, 4).join("; ")}`
  );
}

function mergeSection(
  previous: GroupBlueprint,
  next: GroupBlueprint,
  section: GroupRegenerationSection,
  targetKey?: string
): GroupBlueprint {
  if (section === "scene") return { ...previous, scene: next.scene };
  if (section === "opening") return { ...previous, opening: next.opening };
  if (section === "relations") return { ...previous, relations: next.relations };

  // Для cast сохраняем исходные ключи и отношения: это защита от случайного
  // переименования, которое могло бы отсоединить связи в уже собранной сцене.
  if (targetKey) {
    const targetIndex = previous.cast.findIndex((item) => item.key === targetKey);
    const replacement = next.cast.find((item) => item.key === targetKey) ?? next.cast[targetIndex];
    if (!replacement || targetIndex < 0) return previous;
    return {
      ...previous,
      cast: previous.cast.map((item, index) => index === targetIndex
        ? { ...replacement, key: item.key }
        : item),
    };
  }

  const cast = next.cast.map((item, index) => ({
    ...item,
    key: previous.cast[index]?.key ?? item.key,
  }));
  return { ...previous, cast };
}

function compileCharacterSystemPrompt(
  blueprint: GroupBlueprint,
  character: GroupBlueprint["cast"][number]
): string {
  const relations = blueprint.relations
    .filter((relation) => relation.fromKey === character.key || relation.toKey === character.key)
    .map((relation) => {
      const otherKey = relation.fromKey === character.key ? relation.toKey : relation.fromKey;
      const other = blueprint.cast.find((item) => item.key === otherKey);
      const direction = relation.fromKey === character.key ? "ты к нему" : "он к тебе";
      return `- ${other?.name ?? otherKey} (${relation.label}; ${direction}): ${relation.currentDynamic}`;
    })
    .join("\n");

  return [
    `Ты — ${character.name}, ${character.age} лет. Твоя роль в общей сцене: ${character.role}.`,
    `ПУБЛИЧНЫЙ СЛОЙ: ${character.publicPersona}`,
    `ЛИЧНЫЙ СЛОЙ: ${character.privateLayer}. Это твои внутренние данные; не выкладывай их без причины и не делай их общим знанием NPC.`,
    `ЦЕЛИ: ${character.wants.join("; ")}. СИЛЬНЫЕ СТОРОНЫ: ${character.strengths.join("; ") || "проявляются через действия"}. НЕДОСТАТКИ: ${character.flaws.join("; ")}.`,
    `ГОЛОС: ${character.speech.register}; ритм — ${character.speech.rhythm}. Характерные маркеры: ${character.speech.markers.join(", ") || "нет обязательного словаря"}. Примеры: ${character.speech.examples.join(" / ")}.`,
    `ГРАНИЦЫ: ${character.boundaries.join("; ") || "реагируй на нарушение соразмерно характеру"}.`,
    `ПРАВИЛА ПОВЕДЕНИЯ:\n${character.behaviorRules.map((rule) => `- ${rule}`).join("\n")}`,
    `ОБЩАЯ СЦЕНА: ${blueprint.scene.setting}. ${blueprint.scene.premise} Сейчас: ${blueprint.scene.currentMoment}.`,
    relations ? `ТВОИ СВЯЗИ В ГРУППЕ:\n${relations}` : "У тебя нет заранее заданной близкой связи — строй её по наблюдаемым событиям.",
    "Не говори, не думай и не действуй за игрока. NPC могут автономно говорить друг с другом; игрок не обязан быть адресатом каждой реплики. Не форсируй романтику, трагедию или откровенные темы.",
  ].join("\n\n");
}

export function blueprintToGeneratedGroup(blueprint: GroupBlueprint): GeneratedGroup {
  const tags = ["Group DNA"];
  const characters: GeneratedCharacterDraft[] = blueprint.cast.map((item) => ({
    groupKey: item.key,
    name: item.name,
    age: String(item.age),
    tagline: item.tagline,
    genre: blueprint.scene.setting.slice(0, 80),
    tags,
    originTag: "GROUP DNA",
    description: item.appearance,
    personality: [
      item.personality,
      `Публичная манера: ${item.publicPersona}`,
      `Сильные стороны: ${item.strengths.join(", ") || "раскрываются в игре"}.`,
      `Недостатки: ${item.flaws.join(", ")}.`,
      `Собственные цели: ${item.wants.join(", ")}.`,
    ].join(" "),
    scenario: item.scenarioRole,
    systemPrompt: compileCharacterSystemPrompt(blueprint, item),
    firstMessage: item.firstMessage,
    initialStats: { ...item.initialStats },
    lorebook: [
      ...item.facts.map((fact) => ({
        id: newId(),
        keys: [item.name.toLocaleLowerCase("ru-RU"), "факт", "память"],
        content: fact,
        isActive: true,
      })),
      ...(item.secret
        ? [{
            id: newId(),
            keys: [item.name.toLocaleLowerCase("ru-RU"), "секрет"],
            content: `(Не раскрывать без естественного повода.) ${item.secret}`,
            isActive: true,
          }]
        : []),
    ].slice(0, 10),
  }));

  const relations: GeneratedGroupRelation[] = blueprint.relations.map((relation) => ({
    fromKey: relation.fromKey,
    toKey: relation.toKey,
    text: `${relation.label}: ${relation.currentDynamic}${relation.history ? ` Предыстория: ${relation.history}` : ""}${relation.leverage ? ` Точка напряжения: ${relation.leverage}` : ""}`,
  }));

  const summary = `${blueprint.scene.premise} Сейчас: ${blueprint.scene.currentMoment} Тон: ${blueprint.scene.tone}. Возможное направление: ${blueprint.scene.hook}`;

  return {
    characters,
    opening: blueprint.opening,
    title: blueprint.scene.title,
    summary,
    relations,
    scene: {
      setting: blueprint.scene.setting,
      premise: blueprint.scene.premise,
      currentMoment: blueprint.scene.currentMoment,
      tone: blueprint.scene.tone,
      hook: blueprint.scene.hook,
    },
    blueprint,
  };
}

/** Backward-compatible entry point used by the V1 modal and older callers. */
export async function generateGroupWithDNA(
  apiConfig: ApiConfig,
  prefs: GroupPreferences
): Promise<GeneratedGroup> {
  const result = await generateGroupBlueprint(apiConfig, prefs);
  return result.group;
}
