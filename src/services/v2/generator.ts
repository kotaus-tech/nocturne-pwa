// =============================================================
// CHARACTER DNA (V2) — ПАЙПЛАЙН ГЕНЕРАЦИИ
//
// USER PREFERENCES → PROMPT → MODEL JSON → STRICT VALIDATION
//   → (один коррекционный повтор при ошибках) → BLUEPRINT
//   → CHARACTER (см. toCharacter)
//
// V1-пайплайн (теги → персонаж) живёт отдельно и не затронут.
// =============================================================

import type { ApiConfig } from "../../types";
import {
  buildV2CorrectionPrompt,
  buildV2GenerationPrompt,
  buildV2PartialPrompt,
} from "./prompt";
import { validateBlueprint } from "./schema";
import { getRecentSignatures, rememberSignature, makeSignature } from "./signatures";
import { requestV2Json, V2JsonError } from "./provider";
import type {
  CharacterBlueprintV2,
  V2Preferences,
  V2Section,
} from "./v2types";

/** Результат пайплайна. */
export interface V2GenerationResult {
  blueprint: CharacterBlueprintV2;
  /** true, если ответ пришлось чинить коррекционным повтором. */
  corrected: boolean;
}

/** Ошибка генерации с понятным пользователю сообщением. */
export class V2GenerationError extends Error {}

/** Максимум попыток: первая генерация + один коррекционный повтор. */
const MAX_ATTEMPTS = 2;

/**
 * Основная генерация: предпочтения → валидированный blueprint.
 * Память разнообразия учитывается автоматически.
 */
export async function generateV2Blueprint(
  apiConfig: ApiConfig,
  prefs: V2Preferences
): Promise<V2GenerationResult> {
  const signatures = getRecentSignatures();
  const basePrompt = buildV2GenerationPrompt(prefs, signatures);

  let lastRaw = "";
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let parsed: unknown;

    try {
      if (attempt === 1) {
        parsed = await requestV2Json(apiConfig, [{ role: "user", content: basePrompt }]);
      } else {
        parsed = await requestV2Json(apiConfig, [
          { role: "user", content: basePrompt },
          { role: "assistant", content: lastRaw },
          {
            role: "user",
            content: buildV2CorrectionPrompt(basePrompt, lastRaw, lastIssues),
          },
        ]);
      }
    } catch (cause) {
      if (cause instanceof V2JsonError) {
        // Неразобранный ответ: даём модели один шанс переписать начисто.
        lastRaw = cause.message;
        lastIssues = ["Ответ не является валидным JSON"];
        if (attempt < MAX_ATTEMPTS) continue;
        throw new V2GenerationError(
          "Модель не смогла отдать структурированный ответ. Попробуйте ещё раз или выберите модель покрупнее."
        );
      }
      throw cause;
    }

    lastRaw = safeStringify(parsed);
    const validation = validateBlueprint(parsed);

    if (validation.ok) {
      rememberSignature(makeSignature(validation.blueprint));
      return { blueprint: validation.blueprint, corrected: attempt > 1 };
    }

    lastIssues = validation.issues;
  }

  throw new V2GenerationError(
    `Модель дважды вернула данные с ошибками: ${lastIssues.slice(0, 3).join("; ")}. Попробуйте ещё раз или выберите модель покрупнее.`
  );
}

/**
 * Частичная перегенерация: переписать только указанные секции, сохранив
 * остального персонажа. Основа для locks — всё, что не перечислено,
 * остаётся нетронутым.
 */
export async function regenerateV2Sections(
  apiConfig: ApiConfig,
  prefs: V2Preferences,
  blueprint: CharacterBlueprintV2,
  sections: V2Section[],
  extraInstruction = ""
): Promise<V2GenerationResult> {
  if (sections.length === 0) return { blueprint, corrected: false };

  const prompt = buildV2PartialPrompt(prefs, blueprint, sections, extraInstruction.trim());

  let lastRaw = "";
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let parsed: unknown;

    try {
      if (attempt === 1) {
        parsed = await requestV2Json(apiConfig, [{ role: "user", content: prompt }]);
      } else {
        parsed = await requestV2Json(apiConfig, [
          { role: "user", content: prompt },
          { role: "assistant", content: lastRaw },
          { role: "user", content: buildV2CorrectionPrompt(prompt, lastRaw, lastIssues) },
        ]);
      }
    } catch (cause) {
      if (cause instanceof V2JsonError) {
        lastRaw = cause.message;
        lastIssues = ["Ответ не является валидным JSON"];
        if (attempt < MAX_ATTEMPTS) continue;
        throw new V2GenerationError(
          "Не удалось перегенерировать секцию: модель не отдала структурированный ответ."
        );
      }
      throw cause;
    }

    lastRaw = safeStringify(parsed);
    const validation = validateBlueprint(parsed);

    if (validation.ok) {
      // Страховка: секции вне запроса не должны были меняться, но модель
      // могла что-то уронить — проверяем ключевую идентичность персонажа.
      if (
        validation.blueprint.identity.name !== blueprint.identity.name ||
        validation.blueprint.identity.age !== blueprint.identity.age
      ) {
        validation.blueprint.identity = { ...validation.blueprint.identity, ...blueprint.identity };
      }
      return { blueprint: validation.blueprint, corrected: attempt > 1 };
    }

    lastIssues = validation.issues;
  }

  throw new V2GenerationError(
    `Перегенерация не прошла валидацию: ${lastIssues.slice(0, 3).join("; ")}`
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
