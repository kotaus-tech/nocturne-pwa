import type { RelationshipStats } from "../types";
import { DEFAULT_STATS } from "../types";

export interface ParsedResponse {
  text: string;
  innerThought?: string;
  feelingHint?: string;
  stats?: RelationshipStats;
}

/** Оригинальный мета-протокол для ОБЛАЧНЫХ API (JSON в конце) */
export const META_PROTOCOL_INSTRUCTION = `### META-ПРОТОКОЛ СИСТЕМЫ (ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ):
В самом конце ответа (после всех реплик и художественных описаний) ты ОБЯЗАН сгенерировать блок метаданных строго в формате JSON:
\`\`\`meta
{
  "innerThought": "Искренние мысли персонажа от первого лица о текущей ситуации, сказанном игроком и своих скрытых мотивах",
  "feelingHint": "Краткое описание доминирующего чувства (1-3 слова, например: «Тепло и надежда»)",
  "stats": {
    "trust": 50,
    "affection": 30,
    "closeness": 20,
    "tension": 10,
    "conflict": 0,
    "statusTitle": "Знакомство"
  }
}
\`\`\``;

/**
 * Парсер ответа модели.
 * 1. Для облачных API: извлекает ```meta { ... }``` в конце сообщения.
 * 2. Для локальных LLM: извлекает теги <thought>...</thought> и <stats .../> в начале сообщения.
 */
export function parseMetaBlock(
  raw: string,
  baseStats?: RelationshipStats
): ParsedResponse {
  if (!raw) return { text: "" };

  let text = raw;
  let innerThought: string | undefined;
  let feelingHint: string | undefined;
  let newStats: RelationshipStats | undefined;

  // ─────────────────────────────────────────────────────────────
  // 1. ОБЛАЧНЫЙ СТАНДАРТ: ```meta ... ``` в конце сообщения
  // ─────────────────────────────────────────────────────────────
  const metaMatch = text.match(/```(?:meta|json)?\s*([\s\S]*?)\s*```/i);
  if (metaMatch) {
    try {
      const jsonStr = metaMatch[1].trim();
      const parsed = JSON.parse(jsonStr);

      if (typeof parsed.innerThought === "string" && parsed.innerThought.trim()) {
        innerThought = parsed.innerThought.trim();
      }
      if (typeof parsed.feelingHint === "string" && parsed.feelingHint.trim()) {
        feelingHint = parsed.feelingHint.trim();
      }
      if (parsed.stats && typeof parsed.stats === "object") {
        newStats = {
          trust: typeof parsed.stats.trust === "number" ? parsed.stats.trust : (baseStats?.trust ?? DEFAULT_STATS.trust),
          affection: typeof parsed.stats.affection === "number" ? parsed.stats.affection : (baseStats?.affection ?? DEFAULT_STATS.affection),
          closeness: typeof parsed.stats.closeness === "number" ? parsed.stats.closeness : (baseStats?.closeness ?? DEFAULT_STATS.closeness),
          tension: typeof parsed.stats.tension === "number" ? parsed.stats.tension : (baseStats?.tension ?? DEFAULT_STATS.tension),
          conflict: typeof parsed.stats.conflict === "number" ? parsed.stats.conflict : (baseStats?.conflict ?? DEFAULT_STATS.conflict),
          statusTitle: typeof parsed.stats.statusTitle === "string" && parsed.stats.statusTitle.trim()
            ? parsed.stats.statusTitle.trim()
            : (baseStats?.statusTitle ?? DEFAULT_STATS.statusTitle),
          customStats: parsed.stats.customStats || baseStats?.customStats || {},
        };
      }

      text = text.replace(/```(?:meta|json)?[\s\S]*?```/i, "").trim();
      return { text, innerThought, feelingHint, stats: newStats };
    } catch {
      text = text.replace(/```(?:meta|json)?[\s\S]*?```/i, "").trim();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. ЛОКАЛЬНЫЙ СТАНДАРТ: теги <thought> и <stats> в начале
  // ─────────────────────────────────────────────────────────────
  const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (thoughtMatch) {
    innerThought = thoughtMatch[1].trim();
    text = text.replace(/<thought>[\s\S]*?<\/thought>/i, "");
  } else {
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      text = text.replace(/<think>[\s\S]*?<\/think>/i, "");
    }
  }

  const statsMatch = text.match(/<stats\s+([^>]+?)\/?>/i);
  if (statsMatch) {
    const attrString = statsMatch[1];
    text = text.replace(/<stats\s+[^>]+?\/?>/i, "");

    const current = baseStats || DEFAULT_STATS;

    const parseAttr = (name: string): number | null => {
      const m = attrString.match(new RegExp(`${name}=["']([+-]?\\d+)["']`, "i"));
      if (!m) return null;
      const val = m[1];
      if (val.startsWith("+") || val.startsWith("-")) {
        return Math.min(100, Math.max(0, (current as any)[name] + parseInt(val, 10)));
      }
      return Math.min(100, Math.max(0, parseInt(val, 10)));
    };

    const hintMatch = attrString.match(/hint=["']([^"']+)["']/i);
    if (hintMatch) {
      feelingHint = hintMatch[1].trim();
    }

    const statusMatch = attrString.match(/(?:status|statusTitle)=["']([^"']+)["']/i);
    const statusTitle = statusMatch ? statusMatch[1].trim() : current.statusTitle;

    const t = parseAttr("trust");
    const a = parseAttr("affection");
    const c = parseAttr("closeness");
    const tn = parseAttr("tension");
    const cf = parseAttr("conflict");

    if (t !== null || a !== null || c !== null || tn !== null || cf !== null || statusMatch) {
      newStats = {
        trust: t !== null ? t : current.trust,
        affection: a !== null ? a : current.affection,
        closeness: c !== null ? c : current.closeness,
        tension: tn !== null ? tn : current.tension,
        conflict: cf !== null ? cf : current.conflict,
        statusTitle,
        customStats: current.customStats || {},
      };
    }
  }

  return {
    text: text.trim(),
    innerThought,
    feelingHint,
    stats: newStats,
  };
}