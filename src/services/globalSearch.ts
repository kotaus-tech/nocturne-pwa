import type { Character, ChatSession, Message } from "../types";

/**
 * Поиск по всему миру игрока: персонажи, ветки, реплики, миры (лобуки),
 * дневники, память и якоря. Логика чистая — данные приходят снаружи, поэтому
 * её легко проверять тестами.
 */

export type GlobalSearchKind =
  | "character"
  | "session"
  | "message"
  | "lore"
  | "diary"
  | "memory";

export interface GlobalSearchHit {
  kind: GlobalSearchKind;
  id: string;
  /** Заголовок строки результата. */
  title: string;
  /** Подпись: имя персонажа, ветка, дата. */
  subtitle?: string;
  /** Кусок текста вокруг совпадения. */
  snippet?: string;
  /** Куда вести игрока. */
  sessionId?: string;
  characterId?: string;
}

export interface GlobalSearchData {
  characters: Character[];
  sessions: ChatSession[];
  messages: Message[];
}

/** Сколько символов показываем вокруг найденного места. */
const SNIPPET_RADIUS = 60;

/** Ниже этой длины запрос слишком общий: ищем только по названиям. */
const MIN_QUERY_LENGTH = 2;

export function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
}

/**
 * Кусок текста вокруг первого совпадения — чтобы в выдаче было видно, за что
 * зацепились, а не первые слова документа.
 */
export function buildSnippet(text: string, query: string, radius = SNIPPET_RADIUS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const haystack = normalizeSearchText(flat);
  const needle = normalizeSearchText(query);
  const at = needle ? haystack.indexOf(needle) : -1;

  if (flat.length <= radius * 2) return flat;
  if (at === -1) return `${flat.slice(0, radius * 2).trim()}…`;

  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + needle.length + radius);

  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${
    end < flat.length ? "…" : ""
  }`;
}

interface TextSource {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle?: string;
  /** Тексты, по которым ищем: чем раньше, тем «важнее» совпадение. */
  fields: string[];
  sessionId?: string;
  characterId?: string;
}

function collectSources(
  data: GlobalSearchData,
  charactersById: Map<string, Character>
): TextSource[] {
  const sources: TextSource[] = [];

  for (const character of data.characters) {
    sources.push({
      kind: "character",
      id: character.id,
      title: character.name,
      subtitle: character.genre?.trim() || "Персонаж",
      characterId: character.id,
      fields: [
        character.name,
        character.tagline || "",
        character.description || "",
        character.personality || "",
        character.scenario || "",
      ],
    });
  }

  for (const session of data.sessions) {
    const character = charactersById.get(session.characterId);
    const cast = (session.characterIds ?? [])
      .map((id) => charactersById.get(id)?.name)
      .filter(Boolean)
      .join(", ");

    sources.push({
      kind: "session",
      id: session.id,
      title: session.title || "Ветка",
      subtitle: [character?.name, cast].filter(Boolean).join(" · ") || "Ветка диалога",
      sessionId: session.id,
      characterId: session.characterId,
      fields: [session.title || "", session.summary || ""],
    });

    for (const fact of session.extractedFacts ?? []) {
      sources.push({
        kind: "memory",
        id: fact.id,
        title: character ? `${character.name}: якорь памяти` : "Якорь памяти",
        subtitle: fact.keys.join(", "),
        sessionId: session.id,
        characterId: session.characterId,
        fields: [fact.content, fact.keys.join(" ")],
      });
    }

    for (const entry of session.diary ?? []) {
      sources.push({
        kind: "diary",
        id: entry.id,
        title: character ? `${character.name}: дневник №${entry.entryNumber}` : "Дневник",
        subtitle: entry.mood || "Запись дневника",
        sessionId: session.id,
        characterId: session.characterId,
        fields: [entry.thought, entry.mood || ""],
      });
    }

    for (const event of session.storyLog ?? []) {
      sources.push({
        kind: "memory",
        id: event.id,
        title: character ? `${character.name}: эпизод истории` : "Эпизод истории",
        subtitle: "Хроника",
        sessionId: session.id,
        characterId: session.characterId,
        fields: [event.text],
      });
    }

    if (session.summary?.trim()) {
      sources.push({
        kind: "memory",
        id: `${session.id}-summary`,
        title: character ? `${character.name}: синопсис` : "Синопсис",
        subtitle: "Память ветки",
        sessionId: session.id,
        characterId: session.characterId,
        fields: [session.summary],
      });
    }
  }

  for (const character of data.characters) {
    for (const entry of character.lorebook ?? []) {
      sources.push({
        kind: "lore",
        id: entry.id,
        title: `${character.name}: ${entry.keys[0] || "запись мира"}`,
        subtitle: entry.keys.join(", ") || "Лорбук",
        characterId: character.id,
        fields: [entry.keys.join(" "), entry.content],
      });
    }
  }

  for (const message of data.messages) {
    const session = data.sessions.find((item) => item.id === message.sessionId);
    const author =
      (message.characterId ? charactersById.get(message.characterId)?.name : undefined) ||
      (message.sender === "user" ? "Вы" : undefined) ||
      charactersById.get(session?.characterId ?? "")?.name ||
      "Реплика";

    const text = message.swipes[message.currentSwipeIndex] ?? "";

    sources.push({
      kind: "message",
      id: message.id,
      title: `${author} · ${session?.title || "ветка"}`,
      subtitle: "Реплика",
      sessionId: message.sessionId,
      characterId: message.characterId,
      fields: [text, message.innerThought || ""],
    });
  }

  return sources;
}

/**
 * Ищет запрос по всем источникам и возвращает отсортированные результаты:
 * сначала совпадения в начале поля (названия), потом остальные.
 */
export function searchEverything(
  query: string,
  data: GlobalSearchData,
  limitPerKind = 8
): GlobalSearchHit[] {
  const needle = normalizeSearchText(query);
  if (needle.length < MIN_QUERY_LENGTH) return [];

  const charactersById = new Map(data.characters.map((item) => [item.id, item]));
  const hits: { hit: GlobalSearchHit; score: number; order: number }[] = [];
  let order = 0;

  for (const source of collectSources(data, charactersById)) {
    let bestScore = -1;
    let matchedText = "";

    for (const field of source.fields) {
      if (!field) continue;

      const haystack = normalizeSearchText(field);
      const at = haystack.indexOf(needle);
      if (at === -1) continue;

      // Совпадение с начала строки важнее, чем упоминание в середине текста,
      // а короткое поле (название) важнее длинного описания.
      const score = (at === 0 ? 1000 : 500) - at + Math.max(0, 200 - haystack.length);
      if (score > bestScore) {
        bestScore = score;
        matchedText = field;
      }
    }

    if (bestScore < 0) continue;

    // Совпадение в самом заголовке строки важнее, чем в её тексте.
    if (normalizeSearchText(source.title).includes(needle)) bestScore += 600;

    hits.push({
      hit: {
        kind: source.kind,
        id: source.id,
        title: source.title,
        subtitle: source.subtitle,
        snippet: buildSnippet(matchedText, query),
        sessionId: source.sessionId,
        characterId: source.characterId,
      },
      score: bestScore,
      order: order++,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.order - b.order);

  const perKind = new Map<GlobalSearchKind, number>();
  const result: GlobalSearchHit[] = [];

  for (const entry of hits) {
    const used = perKind.get(entry.hit.kind) ?? 0;
    if (used >= limitPerKind) continue;
    perKind.set(entry.hit.kind, used + 1);
    result.push(entry.hit);
  }

  return result;
}
