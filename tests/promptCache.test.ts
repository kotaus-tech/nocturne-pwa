import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPromptParts,
  composeTurnTail,
  TURN_CONTEXT_HEADER,
  type GroupSceneContext,
} from "../src/services/promptBuilder";
import { getSliceForContext } from "../src/services/contextWindow";
import {
  callLLM,
  messagesToTurns,
  requestRoleplayReply,
  type ChatTurn,
} from "../src/services/apiClient";
import { buildAssistantLabeler } from "../src/services/groupScene";
import { buildRoleplayTurnDirective } from "../src/services/turnDirectives";
import { DEFAULT_API_CONFIG, DEFAULT_STATS } from "../src/types";
import type {
  ApiConfig,
  Character,
  ChatSession,
  Message,
  RelationshipStats,
  UserProfile,
} from "../src/types";

/**
 * Проверки кэшируемости промпта (ТЗ «перестановка блоков»).
 *
 * Идея: между двумя соседними ходами одного чата начало запроса
 * (системный префикс + история) должно совпадать побайтно, а изменчивый
 * контекст хода — идти ПОСЛЕ истории. Запросы перехватываются на уровне fetch,
 * поэтому проверяется реальное тело, которое уходит провайдеру.
 */

// ---------- фикстуры ----------

const character = (id: string, name: string): Character => ({
  id,
  name,
  avatarUrl: "",
  tagline: "",
  personality: `${name}: спокойная и внимательная.`,
  description: `Описание ${name}.`,
  systemPrompt: "",
  firstMessage: "…",
  initialStats: { ...DEFAULT_STATS },
  lorebook: [],
  createdAt: 1,
});

const player: UserProfile = {
  name: "Странник",
  avatarUrl: "",
  personaDescription: "гость",
};

const aya = character("c-1", "Ая");
const mira = character("c-2", "Мира");
const yan = character("c-3", "Ян");

const baseSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: "s-1",
  characterId: "c-1",
  characterIds: [],
  title: "Ветка",
  directorNotes: "",
  summary: "Синопсис: герои познакомились на вокзале.",
  currentStats: { ...DEFAULT_STATS, trust: 40 },
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const userMessage = (index: number): Message => ({
  id: `u-${index}`,
  sessionId: "s-1",
  sender: "user",
  swipes: [`Реплика игрока №${index}.`],
  currentSwipeIndex: 0,
  timestamp: index,
});

const assistantMessage = (index: number, characterId = "c-1", name = "Ая"): Message => ({
  id: `a-${index}`,
  sessionId: "s-1",
  sender: "assistant",
  characterId,
  characterName: name,
  swipes: [`— Ответ №${index}, *кивает*.`],
  currentSwipeIndex: 0,
  timestamp: index,
});

/** Чередующаяся история: user, assistant, user, … длиной `count`. */
function history(count: number, start = 0): Message[] {
  return Array.from({ length: count }, (_, i) =>
    (start + i) % 2 === 0 ? userMessage(start + i) : assistantMessage(start + i)
  );
}

const WINDOW = 20;

// ---------- перехват запросов ----------

const SSE_OPENAI = `data: {"choices":[{"delta":{"content":"— Ок."}}]}\n\ndata: [DONE]\n\n`;
const SSE_GEMINI = `data: {"candidates":[{"content":{"parts":[{"text":"— Ок."}]},"finishReason":"STOP"}]}\n\n`;

let bodies: any[] = [];

beforeEach(() => {
  bodies = [];
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const isGemini = String(_input).includes("generativelanguage");
    return new Response(isGemini ? SSE_GEMINI : SSE_OPENAI, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const openaiConfig: ApiConfig = {
  ...DEFAULT_API_CONFIG,
  mode: "openai",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "k",
  model: "openai/gpt-4o-mini",
  streamEnabled: true,
};

const geminiConfig: ApiConfig = {
  ...DEFAULT_API_CONFIG,
  mode: "gemini",
  baseUrl: "",
  apiKey: "k",
  model: "gemini-2.5-flash",
  streamEnabled: true,
};

const localConfig: ApiConfig = {
  ...DEFAULT_API_CONFIG,
  mode: "openai",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  model: "qwen",
  streamEnabled: true,
};

/**
 * Собирает запрос хода так же, как ChatView.callModelAndAppend:
 * окно истории → промпт (префикс + хвост) → история → эфемерный хвост.
 */
function soloTurn(
  messages: Message[],
  opts: { session?: ChatSession; directive?: string | null; character?: Character } = {}
) {
  const windowed = getSliceForContext(messages, WINDOW, true);
  const parts = buildPromptParts(
    opts.character ?? aya,
    opts.session ?? baseSession(),
    player,
    windowed,
    false
  );
  const turns = messagesToTurns(windowed);
  const tail = composeTurnTail(parts.turnContext, opts.directive ?? null);
  if (tail) turns.push({ role: "user", content: tail });
  return { system: parts.system, turns, tail, windowed };
}

function groupTurn(
  messages: Message[],
  speaker: Character,
  group: Omit<GroupSceneContext, "others"> & { others: Character[] },
  session: ChatSession
) {
  const windowed = getSliceForContext(messages, WINDOW, true);
  const parts = buildPromptParts(speaker, session, player, windowed, false, group);
  const labeler = buildAssistantLabeler(speaker.id, aya.id, (m) => m.characterName ?? "");
  const turns = messagesToTurns(windowed, labeler);
  const tail = composeTurnTail(parts.turnContext);
  if (tail) turns.push({ role: "user", content: tail });
  return { system: parts.system, turns, tail };
}

const openaiMessages = (body: any) => body.messages as { role: string; content: string }[];

// ---------- solo ----------

describe("кэш: solo-чат", () => {
  it("системный префикс и старая история совпадают побайтно между соседними ходами", async () => {
    // Окно 20 со ступенчатым шагом 10: начало истории не сдвигается на 25→27 сообщений.
    const turnA = soloTurn(history(25), {
      session: baseSession({ currentStats: { ...DEFAULT_STATS, trust: 40 } }),
    });
    const messagesB = [...history(25), assistantMessage(25), userMessage(26)];
    const turnB = soloTurn(messagesB, {
      session: baseSession({ currentStats: { ...DEFAULT_STATS, trust: 42 } }),
    });

    await callLLM(openaiConfig, turnA.system, turnA.turns, () => {});
    await callLLM(openaiConfig, turnB.system, turnB.turns, () => {});
    const [a, b] = bodies.map(openaiMessages);

    // system — одинаковый
    expect(b[0]).toEqual(a[0]);
    // всё, кроме хвоста хода A, — точный префикс запроса B
    expect(b.slice(0, a.length - 1)).toEqual(a.slice(0, -1));
    // хвосты различаются (шкалы изменились), и это единственное отличие
    expect(a.at(-1)!.content).not.toBe(b.at(-1)!.content);
    expect(a.at(-1)!.role).toBe("user");
    expect(a.at(-1)!.content.startsWith(TURN_CONTEXT_HEADER)).toBe(true);
  });

  it("изменчивые блоки уходят в хвост, а не в системный префикс", () => {
    const withLore = {
      ...aya,
      // Ключ совпадает с репликой игрока из последних сообщений окна.
      lorebook: [{ id: "lb-1", keys: ["реплика игрока"], content: "Вокзал закрывают в полночь.", isActive: true }],
    };
    const turn = soloTurn(history(6), {
      character: withLore,
      session: baseSession({ directorNotes: "Она нервничает из-за опоздания." }),
    });
    const parts = buildPromptParts(withLore, baseSession({ directorNotes: "Она нервничает из-за опоздания." }), player, history(6), false);

    for (const marker of [
      "ТЕКУЩЕЕ СОСТОЯНИЕ ОТНОШЕНИЙ",
      "АКТИВИРОВАННЫЙ LOREBOOK",
      "РЕЖИССЁРСКИЙ КОНТЕКСТ",
      "ДИРЕКТИВА СКРЫТОЙ МЫСЛИ",
    ]) {
      expect(parts.system).not.toContain(marker);
      expect(parts.turnContext).toContain(marker);
    }
    // Стабильные блоки — в префиксе.
    expect(parts.system).toContain("СИНОПСИС ИСТОРИИ");
    expect(parts.system).toContain("ВНЕШНОСТЬ И ОБЩЕЕ ОПИСАНИЕ");
    expect(parts.system).toContain("ФУНДАМЕНТАЛЬНЫЙ ПСИХОЛОГИЧЕСКИЙ РЕАЛИЗМ");
    expect(turn.tail).toContain("Вокзал закрывают в полночь.");
  });

  it("смена заметок режиссёра меняет только хвост", async () => {
    const first = soloTurn(history(25), {
      session: baseSession({ directorNotes: "Тихий вечер." }),
    });
    const second = soloTurn([...history(25), assistantMessage(25), userMessage(26)], {
      session: baseSession({ directorNotes: "Внезапный звонок." }),
    });

    await callLLM(openaiConfig, first.system, first.turns, () => {});
    await callLLM(openaiConfig, second.system, second.turns, () => {});
    const [a, b] = bodies.map(openaiMessages);

    expect(b.slice(0, a.length - 1)).toEqual(a.slice(0, -1));
    expect(a.at(-1)!.content).toContain("Тихий вечер.");
    expect(b.at(-1)!.content).toContain("Внезапный звонок.");
  });

  it("эфемерный хвост не попадает в историю и не меняет доменные сообщения", () => {
    const messages = history(25);
    const snapshot = structuredClone(messages);
    const turn = soloTurn(messages, { directive: buildRoleplayTurnDirective("continue", "Странник", "Ая") });

    expect(messages).toEqual(snapshot);
    // В истории реплик нет ни заголовка, ни директивы.
    const historyTurns = turn.turns.slice(0, -1);
    for (const t of historyTurns) {
      expect(t.content).not.toContain(TURN_CONTEXT_HEADER);
      expect(t.content).not.toContain("Продолжение текущей сцены");
    }
    // И системный префикс хвоста не содержит.
    expect(turn.system).not.toContain(TURN_CONTEXT_HEADER);
  });

  it("детерминизм: префикс не зависит от текущего времени и Math.random", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const first = soloTurn(history(12)).system;

    vi.setSystemTime(new Date("2031-07-19T23:59:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const second = soloTurn(history(12)).system;

    expect(second).toBe(first);
    vi.restoreAllMocks();
  });

  it("ступенчатое окно: начало истории одно и то же в пределах шага", () => {
    const a = getSliceForContext(history(25), WINDOW, true);
    const b = getSliceForContext([...history(25), assistantMessage(25), userMessage(26)], WINDOW, true);
    expect(a[0].id).toBe(b[0].id);
  });
});

// ---------- Gemini ----------

describe("кэш: Gemini", () => {
  it("хвост уходит в contents в конце, systemInstruction содержит только префикс", async () => {
    const turn = soloTurn(history(25));
    await callLLM(geminiConfig, turn.system, turn.turns, () => {});
    const body = bodies[0];

    expect(body.systemInstruction.parts[0].text).toBe(turn.system);
    expect(body.systemInstruction.parts[0].text).not.toContain(TURN_CONTEXT_HEADER);

    const last = body.contents.at(-1);
    expect(last.role).toBe("user");
    // Последний user-ход истории склеен с хвостом (Gemini не любит два user подряд).
    expect(last.parts[0].text).toContain(TURN_CONTEXT_HEADER);
    expect(last.parts[0].text.startsWith("Реплика игрока №24.")).toBe(true);
  });

  it("ход Gemini: граница кэша — перед последним user-ходом; старая история совпадает", async () => {
    const a = soloTurn(history(25));
    const b = soloTurn([...history(25), assistantMessage(25), userMessage(26)]);
    await callLLM(geminiConfig, a.system, a.turns, () => {});
    await callLLM(geminiConfig, b.system, b.turns, () => {});
    const [ga, gb] = bodies.map((x) => x.contents as any[]);

    expect(bodies[1].systemInstruction.parts[0].text).toBe(bodies[0].systemInstruction.parts[0].text);
    // Последний user-ход A склеен с хвостом, поэтому в B он уже «чистый»:
    // совпадает всё до него (компромисс Gemini-склейки, см. отчёт).
    const common = ga.length - 2;
    expect(gb.slice(0, common)).toEqual(ga.slice(0, common));
  });

  it("Continue: последний ход — assistant, хвост идёт отдельным user-ходом с директивой", async () => {
    const messages = [...history(25), assistantMessage(25)];
    const turn = soloTurn(messages, {
      directive: buildRoleplayTurnDirective("continue", "Странник", "Ая"),
    });
    await callLLM(geminiConfig, turn.system, turn.turns, () => {});
    const contents = bodies[0].contents as any[];

    expect(contents.at(-2).role).toBe("model");
    expect(contents.at(-1).role).toBe("user");
    expect(contents.at(-1).parts[0].text).toContain("Продолжение текущей сцены");
    expect(contents.at(-1).parts[0].text.startsWith(TURN_CONTEXT_HEADER)).toBe(true);
  });
});

// ---------- OpenAI-совместимые ----------

describe("кэш: OpenAI-совместимый путь", () => {
  it("хвост — отдельное user-сообщение в конце messages, не склеено с историей", async () => {
    const turn = soloTurn(history(25));
    await callLLM(openaiConfig, turn.system, turn.turns, () => {});
    const messages = openaiMessages(bodies[0]);

    expect(messages[0].role).toBe("system");
    expect(messages.at(-1)!.role).toBe("user");
    expect(messages.at(-1)!.content.startsWith(TURN_CONTEXT_HEADER)).toBe(true);
    // Последняя реплика истории осталась нетронутой.
    expect(messages.at(-2)!.content).toBe("Реплика игрока №24.");
  });

  it("regenerate: контекст хода без директивы", () => {
    const turn = soloTurn(history(9));
    expect(turn.tail).toBe(composeTurnTail(buildPromptParts(aya, baseSession(), player, turn.windowed, false).turnContext));
    expect(turn.tail).not.toContain("Продолжение текущей сцены");
  });
});

// ---------- группа ----------

describe("кэш: групповая сцена", () => {
  const groupSession = baseSession({
    isGroup: true,
    characterIds: ["c-2", "c-3"],
    activeCharacterIds: ["c-1", "c-2", "c-3"],
  });

  const groupMessages = (count: number) =>
    Array.from({ length: count }, (_, i) => {
      if (i % 3 === 0) return userMessage(i);
      if (i % 3 === 1) return assistantMessage(i, "c-2", "Мира");
      return assistantMessage(i, "c-3", "Ян");
    });

  it("повторный ход одного персонажа: префикс и история совпадают, меняются только хвост-блоки", async () => {
    const speakerMemoryA = { privateNotes: ["Мира что-то скрывает."], intention: null };
    const speakerMemoryB = {
      privateNotes: ["Мира что-то скрывает.", "Ян опоздал."],
      intention: { text: "Выяснить, где Мира была вечером.", scope: "scene" as const },
    };
    const a = groupTurn(groupMessages(25), aya, {
      others: [mira, yan],
      relations: [{ from: "c-2", to: "c-3", text: "настороженно" }],
      personalMemory: speakerMemoryA,
    } as any, groupSession);
    const b = groupTurn([...groupMessages(25), userMessage(25), assistantMessage(26, "c-2", "Мира")], aya, {
      others: [mira, yan],
      absent: [],
      relations: [{ from: "c-2", to: "c-3", text: "настороженно" }],
      personalMemory: speakerMemoryB,
    } as any, groupSession);

    await callLLM(openaiConfig, a.system, a.turns, () => {});
    await callLLM(openaiConfig, b.system, b.turns, () => {});
    const [x, y] = bodies.map(openaiMessages);

    expect(y[0]).toEqual(x[0]);
    expect(y.slice(0, x.length - 1)).toEqual(x.slice(0, -1));
    expect(a.system).toContain("ГРУППОВАЯ СЦЕНА");
    expect(a.system).not.toContain("### ТВОЯ ЛИЧНАЯ ПАМЯТЬ");
    expect(a.tail).toContain("### ТВОЯ ЛИЧНАЯ ПАМЯТЬ");
    expect(b.tail).toContain("ТВОЁ ТЕКУЩЕЕ НАМЕРЕНИЕ");
  });

  it("блок присутствия («за кадром») — только в хвосте, а не в префиксе", () => {
    const withAbsence = groupTurn(groupMessages(12), aya, {
      others: [mira],
      absent: [{ character: yan, reason: "ушёл за сигаретами" }],
    }, groupSession);
    const present = groupTurn(groupMessages(12), aya, { others: [mira, yan] }, groupSession);

    expect(withAbsence.system).not.toContain("### СЦЕНИЧЕСКОЕ ПРИСУТСТВИЕ");
    expect(withAbsence.tail).toContain("### СЦЕНИЧЕСКОЕ ПРИСУТСТВИЕ");
    expect(present.tail).not.toContain("СЦЕНИЧЕСКОЕ ПРИСУТСТВИЕ");
  });

  it("ограничение: смена состава сцены меняет ростер в префиксе (ростер не переносился по ТЗ)", () => {
    // Ростер перечисляет присутствующих, поэтому уход персонажа меняет префикс.
    // Событие редкое (уход/возврат), поэтому оставлено в префиксе — см. отчёт.
    const before = groupTurn(groupMessages(12), aya, { others: [mira, yan] }, groupSession);
    const after = groupTurn(groupMessages(12), aya, {
      others: [mira],
      absent: [{ character: yan }],
    }, groupSession);
    expect(after.system).not.toBe(before.system);
    expect(after.system).toContain("- Мира:");
    expect(after.system).not.toContain("- Ян:");
  });

  it("другой говорящий: префикс меняется (имя в правилах) — это задокументированное ограничение", () => {
    const forAya = groupTurn(groupMessages(12), aya, { others: [mira, yan] }, groupSession);
    const forMira = groupTurn(groupMessages(12), mira, { others: [aya, yan] }, groupSession);
    expect(forMira.system).not.toBe(forAya.system);
  });
});

// ---------- вспомогательное ----------

describe("composeTurnTail", () => {
  it("возвращает пустую строку, если хвостовать нечего", () => {
    expect(composeTurnTail("")).toBe("");
    expect(composeTurnTail("", null)).toBe("");
  });

  it("контекст хода идёт раньше директивы, оба — под одним заголовком", () => {
    const tail = composeTurnTail("### БЛОК\nтекст", "[Директива]");
    expect(tail).toBe(`${TURN_CONTEXT_HEADER}\n\n### БЛОК\nтекст\n\n[Директива]`);
  });
});

// ---------- локальная модель ----------

describe("локальная модель (Ollama): протокол тегов", () => {
  it("тег <thought>/<stats> разбирается как раньше, хвост не попадает в ответ", async () => {
    const turn = soloTurn(history(9));
    const prompt = buildPromptParts(aya, baseSession(), player, turn.windowed, true);
    expect(prompt.system).toContain("META-ПРОТОКОЛ ДЛЯ ЛОКАЛЬНОЙ МОДЕЛИ");
    expect(prompt.turnContext).toContain("ДИРЕКТИВА СКРЫТОЙ МЫСЛИ (<thought>)");
    expect(prompt.system).not.toContain("ДИРЕКТИВА СКРЫТОЙ МЫСЛИ");

    const answer =
      `<thought>Надо держать дистанцию.</thought>\n` +
      `<stats trust="+1" affection="0" tension="0" hint="настороженность" status="Знакомые"/>\n\n` +
      `— Привет.`;

    // Ollama NDJSON-поток
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      const line = JSON.stringify({ message: { content: answer } }) + "\n";
      return new Response(line, { status: 200 });
    });

    const parsed = await requestRoleplayReply(
      localConfig,
      prompt.system,
      turn.turns,
      () => {},
      { ...DEFAULT_STATS, trust: 40 } as RelationshipStats
    );

    expect(parsed.innerThought).toBe("Надо держать дистанцию.");
    expect(parsed.stats?.trust).toBe(41);
    expect(parsed.text).not.toContain("<thought>");
    expect(parsed.text).not.toContain(TURN_CONTEXT_HEADER);

    // В запросе хвост — последним user-сообщением, системное сообщение — префикс.
    const messages = openaiMessages(bodies.at(-1));
    expect(messages[0].content).toBe(prompt.system);
    expect(messages.at(-1)!.content.startsWith(TURN_CONTEXT_HEADER)).toBe(true);
  });
});

describe("история не содержит служебных меток", () => {
  it("messagesToTurns для старых сообщений даёт одинаковый результат при повторном вызове", () => {
    const messages = history(15);
    expect(messagesToTurns(messages)).toEqual(messagesToTurns(messages));
    const turns: ChatTurn[] = messagesToTurns(messages);
    expect(turns.every((t) => !t.content.includes(TURN_CONTEXT_HEADER))).toBe(true);
  });
});
