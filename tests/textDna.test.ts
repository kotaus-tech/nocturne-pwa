import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, sanitizeCharacter } from "../src/db";
import { createSession } from "../src/utils/sessionActions";
import {
  createTextDnaTask,
  extractTextDna,
  isTextDnaTaskCompatible,
  splitTextForTextDna,
  validateTextDnaPayload,
  type TextDnaGroupPayload,
  type TextDnaSinglePayload,
} from "../src/services/textDna";
import {
  isTextDnaTextFile,
  readTextDnaFile,
  toggleTextDnaSourceVisibility,
} from "../src/utils/textDnaFile";
import type { ApiConfig } from "../src/types";

const apiConfig: ApiConfig = {
  mode: "openai",
  baseUrl: "https://example.test/v1",
  apiKey: "test-key",
  model: "test-model",
  temperature: 0.2,
  contextWindow: 32,
};

function responseFor(
  value: unknown,
  options: { finishReason?: string; usage?: Record<string, number> } = {}
): Response {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: content === undefined ? {} : { content },
          ...(options.finishReason ? { finish_reason: options.finishReason } : {}),
        },
      ],
      ...(options.usage ? { usage: options.usage } : {}),
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function characterPayload(name: string, key?: string) {
  return {
    ...(key ? { key } : {}),
    name,
    aliases: name === "Мира" ? ["Мир", "Архивистка"] : [],
    tagline: "сохранённая подпись",
    age: "29",
    genre: "неонуар",
    tags: ["детектив"],
    firstImpression: "Спокойная внешность скрывает усталость.",
    startingPoint: "Она ждёт у закрытого архива.",
    summaryQuote: "Некоторые письма лучше не открывать.",
    description: "Шрам над бровью; исходная формулировка внешности.",
    personality: "Наблюдательная, противоречивая, не доверяет обещаниям.",
    scenario: "В прошлом она скрыла важное событие и всё ещё живёт с его последствиями.",
    systemPrompt: "Не раскрывай секрет без естественного повода. Говори короткими фразами.",
    firstMessage: "*Закрывает папку.* — Ты пришёл раньше.",
    alternateGreetings: ["— Я ждала этого разговора."],
    initialStats: { trust: 21, affection: 30, closeness: 20, tension: 10, conflict: 0, statusTitle: "Знакомство" },
    lorebook: [{ keys: ["архив"], content: "В архиве лежит письмо, которого никто не должен найти." }],
    preservedMaterial: ["Авторское правило: не решай за игрока и не сглаживай противоречия."],
  };
}

function singleResponse(): TextDnaSinglePayload {
  return {
    mode: "single",
    character: characterPayload("Мира"),
    session: {
      title: "Ночной архив",
      summary: "Встреча в архиве после полуночи.",
      directorNotes: "Общее правило сцены: тайна не раскрывается авторским голосом.",
      preservedMaterial: ["Дословная инструкция сцены: оставляй игроку право выбора."],
    },
    preservedMaterial: ["Фрагмент, который нельзя было разложить по полям."],
    // Это поле намеренно отсутствует в настоящем LLM-ответе в тестах direct flow.
    coverage: [],
  };
}

function modelSingleResponse(): Omit<TextDnaSinglePayload, "coverage"> {
  const { coverage: _coverage, ...withoutCoverage } = singleResponse();
  return withoutCoverage;
}

function groupResponse(): Omit<TextDnaGroupPayload, "coverage"> {
  return {
    mode: "group",
    scene: {
      title: "Три голоса в архиве",
      setting: "Закрытый городской архив ночью.",
      premise: "Трое пришли за разными ответами и знают разные части истории.",
      currentMoment: "На столе обнаружено письмо с чужой печатью.",
      tone: "напряжённый и камерный",
      opening: "*Лампа мерцает над письмом.* — Никто не ожидал увидеть здесь эту печать.",
      summary: "Общая история начинается с найденного письма.",
      directorNotes: "Не смешивай личные знания участников; слухи не считать фактами.",
      preservedMaterial: ["Общее авторское правило: не говорить за игрока."],
    },
    characters: [
      characterPayload("Мира", "mira"),
      characterPayload("Илья", "ilya"),
      characterPayload("Соня", "sonya"),
    ],
    relations: [
      { fromKey: "mira", toKey: "ilya", text: "Мира считает, что Илья спрятал письмо." },
      { fromKey: "ilya", toKey: "sonya", text: "Илья не знает, что Соня уже видела печать." },
    ],
    preservedMaterial: ["Соня знает правду, но считает это только своей догадкой."],
  };
}

function mockFetchWithQueue(values: unknown[]) {
  const queue = [...values];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (
      Array.isArray(next) &&
      next.length === 2 &&
      typeof next[1] === "object" &&
      next[1] !== null
    ) {
      return responseFor(next[0], next[1] as { finishReason?: string; usage?: Record<string, number> });
    }
    return responseFor(next);
  });
}

function requestBody(fetchMock: ReturnType<typeof mockFetchWithQueue>, index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index][1]?.body)) as Record<string, unknown>;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await db.characters.clear();
  await db.sessions.clear();
  await db.messages.clear();
});

describe("Text DNA: direct full-source architecture", () => {
  it("делает ровно один основной API-вызов для одного полного исходника", async () => {
    const source = "UNIQUE_SOURCE_MARKER\nИмя Мира, её биография, секрет и первое сообщение.";
    const fetchMock = mockFetchWithQueue([modelSingleResponse()]);

    const result = await extractTextDna(apiConfig, source, "single");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.sourceLength).toBe(source.length);
    expect(result.sourceSections).toEqual([{ id: "source-1", start: 0, end: source.length }]);
    const firstBody = requestBody(fetchMock);
    const serializedRequest = JSON.stringify(firstBody);
    expect(serializedRequest.match(/UNIQUE_SOURCE_MARKER/g)).toHaveLength(1);
    expect(firstBody.max_tokens).toBe(8_192);
  });

  it("отправляет компактную схему без coverage/evidence/index и строит coverage на клиенте", async () => {
    const source = "Короткий материал о Мире.";
    const fetchMock = mockFetchWithQueue([modelSingleResponse()]);
    const result = await extractTextDna(apiConfig, source, "single");
    const body = requestBody(fetchMock);
    const prompt = JSON.stringify(body);

    expect(prompt).not.toContain('"coverage"');
    expect(prompt).not.toContain('"evidence"');
    expect(prompt).not.toContain('"index"');
    expect(result.payload.coverage).toHaveLength(1);
    expect(result.payload.coverage[0].sourceStart).toBe(0);
    expect(result.payload.coverage[0].sourceEnd).toBe(source.length);
  });

  it("сохраняет имена, алиасы, карточку, секреты, правила, диалоги, лорбук и дополнительные сведения", async () => {
    mockFetchWithQueue([modelSingleResponse()]);

    const result = await extractTextDna(
      apiConfig,
      "Материал с противоречием версии возраста и авторским правилом.",
      "single"
    );

    if (result.prepared.mode !== "single") throw new Error("expected single");
    expect(result.payload.mode).toBe("single");
    if (result.payload.mode !== "single") throw new Error("expected single payload");
    expect(result.payload.character.aliases).toEqual(["Мир", "Архивистка"]);
    expect(result.prepared.character.name).toBe("Мира");
    expect(result.prepared.character.systemPrompt).toContain("Альтернативные имена");
    expect(result.prepared.character.systemPrompt).toContain("не сглаживай противоречия");
    expect(result.prepared.character.firstMessage).toContain("Ты пришёл раньше");
    expect(result.prepared.character.alternateGreetings?.[0]).toContain("Я ждала");
    expect(result.prepared.character.lorebook[0].content).toContain("письмо");
    expect(result.prepared.directorNotes).toContain("право выбора");
  });

  it("обрабатывает group одним вызовом и сохраняет отдельные knowledge boundaries в карточках/сцене", async () => {
    const source = "Мира, Илья и Соня встречаются в архиве; каждый знает разную часть истории.";
    const fetchMock = mockFetchWithQueue([groupResponse()]);

    const result = await extractTextDna(apiConfig, source, "group");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.prepared.mode).toBe("group");
    if (result.prepared.mode !== "group") throw new Error("expected group");
    expect(result.prepared.characters).toHaveLength(3);
    expect(result.prepared.relations).toHaveLength(2);
    expect(result.prepared.summary).toContain("Закрытый городской архив");
    expect(result.prepared.directorNotes).toContain("Соня знает правду");
    expect(result.prepared.characters[0].systemPrompt).toContain("Альтернативные имена");
  });

  it("не делит большие и маленькие тексты на платные стадии: один запрос получает source целиком", async () => {
    const small = "SMALL_SOURCE_MARKER";
    const smallFetch = mockFetchWithQueue([modelSingleResponse()]);
    await extractTextDna(apiConfig, small, "single");
    expect(smallFetch).toHaveBeenCalledTimes(1);

    const large = `${"LARGE_SOURCE_MARKER\n"}${"Подтверждённый факт. ".repeat(25_000)}`;
    const largeFetch = mockFetchWithQueue([modelSingleResponse()]);
    const largeResult = await extractTextDna(apiConfig, large, "single");
    expect(largeFetch).toHaveBeenCalledTimes(1);
    expect(largeResult.sourceLength).toBe(large.length);
    expect(JSON.stringify(requestBody(largeFetch)).match(/LARGE_SOURCE_MARKER/g)).toHaveLength(1);
  });

  it("не дублирует полный исходник в техническом correction", async () => {
    const source = "CORRECTION_SOURCE_MARKER\nМира и её полная история.";
    const invalid = { mode: "single", character: {}, session: {}, preservedMaterial: [] };
    const fetchMock = mockFetchWithQueue([invalid, modelSingleResponse()]);

    const result = await extractTextDna(apiConfig, source, "single");

    expect(result.corrected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(requestBody(fetchMock, 0)).match(/CORRECTION_SOURCE_MARKER/g)).toHaveLength(1);
    expect(JSON.stringify(requestBody(fetchMock, 1))).not.toContain("CORRECTION_SOURCE_MARKER");
  });

  it("отличает output limit и не пытается признать обрезанный JSON успешным", async () => {
    const fetchMock = mockFetchWithQueue([["{\"mode\":\"single\"", { finishReason: "length" }]]);

    await expect(extractTextDna(apiConfig, "OUTPUT_LIMIT_SOURCE", "single")).rejects.toMatchObject({
      kind: "output_limit",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("не сохраняет ничего при неуспешном JSON или schema validation", async () => {
    const fetchMock = mockFetchWithQueue(["не JSON", "снова не JSON"]);

    await expect(extractTextDna(apiConfig, "NO_JSON_SOURCE", "single")).rejects.toMatchObject({
      kind: "no_json",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.characters.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);
  });

  it("передаёт успешный результат в атомарное сохранение Character и mystery session", async () => {
    mockFetchWithQueue([modelSingleResponse()]);
    const result = await extractTextDna(apiConfig, "PERSISTENCE_SOURCE", "single");
    if (result.prepared.mode !== "single") throw new Error("expected single");

    const character = sanitizeCharacter(result.prepared.character);
    const session = await createSession(character, result.prepared.title, {
      persistCharacter: character,
      mysteryMode: true,
      summary: result.prepared.summary,
      directorNotes: result.prepared.directorNotes,
    });

    expect(session.mysteryMode).toBe(true);
    expect(await db.characters.get(character.id)).toBeTruthy();
    expect(await db.messages.where("sessionId").equals(session.id).count()).toBe(1);
  });

  it("не обрезает неподдерживаемую группу молча и не делает второй платный запрос", async () => {
    const tooMany = {
      mode: "group",
      scene: {},
      characters: ["Мира", "Илья", "Соня", "Лев", "Ника"].map((name, index) => ({
        ...characterPayload(name, `c${index}`),
      })),
      relations: [],
      preservedMaterial: [],
    };
    const fetchMock = mockFetchWithQueue([tooMany]);

    await expect(extractTextDna(apiConfig, "TOO_MANY_SOURCE", "group")).rejects.toMatchObject({
      kind: "schema",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Text DNA: client metadata and in-memory task", () => {
  it("сохраняет полный source в lossless utility, но task использует один full-source range", () => {
    const source = `${"Раздел. Факт и правило.\n\n".repeat(700)}TAIL_MUST_SURVIVE`;
    const sections = splitTextForTextDna(source, 1_000);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.map((section) => section.text).join("")).toBe(source);
    expect(sections[0].start).toBe(0);
    expect(sections.at(-1)?.end).toBe(source.length);

    const task = createTextDnaTask(source, "single");
    expect(task.sections).toHaveLength(1);
    expect(task.sections[0]).toMatchObject({ id: "source-1", start: 0, end: source.length });
    expect(isTextDnaTaskCompatible(task, source, "single")).toBe(true);
    expect(isTextDnaTaskCompatible(task, `${source}!`, "single")).toBe(false);
    expect(isTextDnaTaskCompatible(task, source, "group")).toBe(false);
  });

  it("принимает direct JSON без технического coverage и строго проверяет переданный coverage", () => {
    const source = "Мира и её сцена.";
    const sections = createTextDnaTask(source, "single").sections;
    const direct = validateTextDnaPayload(modelSingleResponse(), "single", sections);
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.payload.coverage[0].sectionId).toBe("source-1");

    const broken = validateTextDnaPayload(
      { ...modelSingleResponse(), coverage: [{ sectionId: "foreign", retainedFacts: ["x"] }] },
      "single",
      sections
    );
    expect(broken.ok).toBe(false);
  });
});

describe("Text DNA: TXT input helpers", () => {
  it("принимает .txt с пустым MIME и отклоняет другие расширения", async () => {
    const valid = { name: "material.TXT", text: async () => "полный текст\nс переносом" } as unknown as File;
    const invalid = { name: "material.json", text: async () => "{}" } as unknown as File;

    expect(isTextDnaTextFile(valid)).toBe(true);
    expect(isTextDnaTextFile(invalid)).toBe(false);
    await expect(readTextDnaFile(valid)).resolves.toBe("полный текст\nс переносом");
    await expect(readTextDnaFile(invalid)).rejects.toThrow(/только.*\.txt/i);
  });

  it("не теряет ошибки чтения и не подменяет их тихим пустым результатом", async () => {
    const broken = {
      name: "broken.txt",
      text: async () => {
        throw new Error("read failed");
      },
    } as unknown as File;

    await expect(readTextDnaFile(broken)).rejects.toThrow(/не удалось прочитать/i);
  });

  it("скрывает и показывает многострочный source без его очистки или изменения", () => {
    const source = "строка один\n\nстрока два\nсекрет и диалог";
    const hidden = toggleTextDnaSourceVisibility({ source, visible: true });
    const shown = toggleTextDnaSourceVisibility(hidden);

    expect(hidden).toEqual({ source, visible: false });
    expect(shown).toEqual({ source, visible: true });
  });
});
