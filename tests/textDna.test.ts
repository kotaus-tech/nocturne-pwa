import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, sanitizeCharacter } from "../src/db";
import { DEFAULT_STATS } from "../src/types";
import { createGroupSession, createSession } from "../src/utils/sessionActions";
import {
  createTextDnaTask,
  extractTextDna,
  isTextDnaTaskCompatible,
  TEXT_DNA_INDEX_BATCH_CHARS,
  TEXT_DNA_INDEX_INPUT_MAX_CHARS,
  prepareTextDnaPayload,
  splitTextForTextDna,
  validateTextDnaPayload,
  type TextDnaGroupPayload,
  type TextDnaSinglePayload,
} from "../src/services/textDna";
import type { ApiConfig, Character } from "../src/types";

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
  options: {
    finishReason?: string;
    usage?: Record<string, number>;
  } = {}
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
    initialStats: { ...DEFAULT_STATS, trust: 21 },
    lorebook: [{ keys: ["архив"], content: "В архиве лежит письмо, которого никто не должен найти." }],
    preservedMaterial: ["Авторское правило: не решай за игрока и не сглаживай противоречия."],
  };
}

function singlePayload(
  sectionIds: Array<{ id: string; start: number; end: number }>
): TextDnaSinglePayload {
  return {
    mode: "single",
    character: characterPayload("Мира") as TextDnaSinglePayload["character"],
    session: {
      title: "Ночной архив",
      summary: "Встреча в архиве после полуночи.",
      directorNotes: "Общее правило сцены: тайна не раскрывается авторским голосом.",
      preservedMaterial: ["Дословная инструкция сцены: оставляй игроку право выбора."],
    },
    preservedMaterial: ["Фрагмент, который нельзя было разложить по полям."],
    coverage: sectionIds.map((section) => ({
      sectionId: section.id,
      sourceStart: section.start,
      sourceEnd: section.end,
      retainedFacts: ["имя", "событие", "правило"],
    })),
  };
}

function semanticSinglePayload(
  sectionCount = 1
): Omit<TextDnaSinglePayload, "coverage"> & {
  coverage: Array<{ retainedFacts: string[] }>;
} {
  const payload = singlePayload(
    Array.from({ length: sectionCount }, (_, index) => ({
      id: `source-${index + 1}`,
      start: index * 10,
      end: (index + 1) * 10,
    }))
  );
  return {
    ...payload,
    coverage: Array.from({ length: sectionCount }, (_, index) => ({
      retainedFacts: [`semantic fact ${index + 1}`],
    })),
  };
}

function groupPayload(
  sectionIds: Array<{ id: string; start: number; end: number }>
): TextDnaGroupPayload {
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
    ] as TextDnaGroupPayload["characters"],
    relations: [
      { fromKey: "mira", toKey: "ilya", text: "Мира считает, что Илья спрятал письмо; Илья уверен, что она ошибается." },
      { fromKey: "ilya", toKey: "sonya", text: "Илья не знает, что Соня уже видела печать раньше." },
    ],
    preservedMaterial: ["Деталь сцены: Соня знает правду, но считает это только своей догадкой."],
    coverage: sectionIds.map((section) => ({
      sectionId: section.id,
      sourceStart: section.start,
      sourceEnd: section.end,
      retainedFacts: ["состав", "отношение", "секрет"],
    })),
  };
}

function chunkEvidence(fact: string) {
  return {
    entities: [{ name: "Мира", aliases: ["она"] }],
    evidence: [
      {
        subject: "Мира",
        category: "rule",
        text: fact,
        sourceQuote: fact,
      },
    ],
    sharedContext: ["Общая сцена сохраняет право игрока на выбор."],
    relations: ["Мира подозревает архивиста."],
    unmappedMaterial: ["Авторская формулировка, которую нельзя потерять."],
  };
}

function synthesisIndex() {
  return {
    mode: "single",
    character: { key: "main", name: "Мира", aliases: ["она"] },
    session: {
      title: "Ночной архив",
      summary: "Встреча в архиве после полуночи.",
      directorNotes: "Не раскрывай тайну авторским голосом.",
      preservedMaterial: [],
    },
    preservedMaterial: [],
  };
}

function cardResponse(name = "Мира") {
  return { character: characterPayload(name) };
}

function longSource(): string {
  return [
    `СЕКЦИЯ А. ${"Первый факт о Мире и правило архива. ".repeat(260)}`,
    `СЕКЦИЯ Б. ${"Второй факт о Мире, её секрет и диалог. ".repeat(260)}`,
    `СЕКЦИЯ В. ${"Третий факт о сцене и сохранённая авторская инструкция. ".repeat(260)}`,
  ].join("\n\n");
}

function expectedIndexBatchCount(
  facts: string[],
  sections: Array<{ id: string }>
): number {
  let batches = 0;
  let size = 2;
  facts.forEach((fact, index) => {
    const item = { sectionId: sections[index].id, ...chunkEvidence(fact) };
    const itemSize = JSON.stringify(item).length + 1;
    if (size > 2 && size + itemSize > TEXT_DNA_INDEX_BATCH_CHARS) {
      batches += 1;
      size = 2;
    }
    size += itemSize;
  });
  if (facts.length > 0) batches += 1;
  return batches;
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

afterEach(async () => {
  vi.restoreAllMocks();
  await db.characters.clear();
  await db.sessions.clear();
  await db.messages.clear();
});

describe("Text DNA: lossless source handling", () => {
  it("делит большой исходник без потери порядка, переводов строк и хвоста", () => {
    const source = `${"Раздел первый. Факт и правило.\n\n".repeat(700)}ФИНАЛЬНЫЙ_ФАКТ_НЕ_ТЕРЯТЬ`;
    const sections = splitTextForTextDna(source, 1_000);

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.map((section) => section.text).join("")).toBe(source);
    expect(sections[0].start).toBe(0);
    expect(sections.at(-1)?.end).toBe(source.length);
  });

  it("обрабатывает длинный материал по evidence → index → отдельная карточка", async () => {
    const source = longSource();
    const sections = splitTextForTextDna(source);
    const facts = sections.map((_, index) => `FACT_FROM_SECTION_${index + 1}`);
    const fetchMock = mockFetchWithQueue([
      ...facts.map((fact) => chunkEvidence(fact)),
      synthesisIndex(),
      cardResponse(),
    ]);

    const result = await extractTextDna(apiConfig, source, "single");

    expect(fetchMock).toHaveBeenCalledTimes(sections.length + 2);
    expect(result.sourceLength).toBe(source.length);
    expect(result.sourceSections).toHaveLength(sections.length);
    expect(result.prepared.mode).toBe("single");
    if (result.prepared.mode === "single") {
      expect(result.prepared.directorNotes).toContain("FACT_FROM_SECTION_1");
      expect(result.prepared.directorNotes).toContain(`FACT_FROM_SECTION_${sections.length}`);
    }
  });
});

describe("Text DNA: coverage belongs to the client", () => {
  it("восстанавливает все пустые sectionId по точным диапазонам", () => {
    const source = "A".repeat(21_000);
    const sections = splitTextForTextDna(source);
    const payload = singlePayload(sections).coverage.map((item) => ({
      ...item,
      sectionId: "",
    }));
    const checked = validateTextDnaPayload(
      { ...singlePayload(sections), coverage: payload },
      "single",
      sections
    );

    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.payload.coverage.map((item) => item.sectionId)).toEqual(
        sections.map((section) => section.id)
      );
    }
  });

  it("принимает semantic coverage без технических id и offsets", () => {
    const source = "Короткий исходный материал.";
    const sections = splitTextForTextDna(source);
    const checked = validateTextDnaPayload(
      semanticSinglePayload(sections.length),
      "single",
      sections
    );

    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.payload.coverage[0]).toEqual({
        sectionId: sections[0].id,
        sourceStart: sections[0].start,
        sourceEnd: sections[0].end,
        retainedFacts: ["semantic fact 1"],
      });
    }
  });

  it("отвергает отсутствующую запись покрытия", () => {
    const source = "A".repeat(21_000);
    const sections = splitTextForTextDna(source);
    const payload = singlePayload(sections);
    payload.coverage = payload.coverage.slice(0, -1);

    const checked = validateTextDnaPayload(payload, "single", sections);

    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues.join(" ")).toMatch(/неполное|отсутствует/i);
  });

  it("отвергает неизвестный id, дубликат и неполный диапазон", () => {
    const sections = splitTextForTextDna("A".repeat(21_000));
    const payload = singlePayload(sections);
    payload.coverage[0].sectionId = "alien-section";
    payload.coverage[1].sectionId = sections[0].id;
    payload.coverage[1].sourceEnd = sections[1].end - 1;

    const checked = validateTextDnaPayload(payload, "single", sections);

    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      const issues = checked.issues.join(" ");
      expect(issues).toMatch(/неизвестная|повтор|диапазон/i);
    }
  });

  it("не теряет связи, scene и отдельные карточки группы", () => {
    const payload = groupPayload([{ id: "source-1", start: 0, end: 10 }]);
    const prepared = prepareTextDnaPayload(payload);

    expect(prepared.mode).toBe("group");
    if (prepared.mode !== "group") throw new Error("expected group");
    expect(prepared.characters).toHaveLength(3);
    expect(prepared.relations).toHaveLength(2);
    expect(prepared.relations[0].from).toBe(prepared.characters[0].id);
    expect(prepared.relations[0].to).toBe(prepared.characters[1].id);
    expect(prepared.directorNotes).toContain("ПОЛНЫЕ ОТНОШЕНИЯ");
  });
});

describe("Text DNA: finish reason, JSON correction and diagnostics", () => {
  it("различает оборванный output по finish_reason и не делает correction", async () => {
    const source = "Имя Мира и её первое сообщение.";
    const fetchMock = mockFetchWithQueue([
      ['{"mode":"single","character":', { finishReason: "length", usage: { prompt_tokens: 100, completion_tokens: 6000, total_tokens: 6100 } }],
    ]);

    await expect(extractTextDna(apiConfig, source, "single")).rejects.toMatchObject({
      kind: "output_limit",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.characters.count()).toBe(0);
  });

  it("делает один компактный correction для повреждённого, но завершённого JSON", async () => {
    const source = "Имя Мира и её первое сообщение.";
    const fetchMock = mockFetchWithQueue([
      '{"mode":"single",}',
      semanticSinglePayload(),
    ]);

    const result = await extractTextDna(apiConfig, source, "single");

    expect(result.corrected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.messages).toHaveLength(1);
    expect(secondBody.messages[0].content).toContain("Краткая ожидаемая схема");
    expect(secondBody.messages[0].content).not.toContain(source);
    expect(JSON.stringify(secondBody).length).toBeLessThan(JSON.stringify(firstBody).length);
  });

  it("не скрывает неудачу, если обе попытки финального этапа неуспешны", async () => {
    const source = "Имя Мира и её первое сообщение.";
    const fetchMock = mockFetchWithQueue(["не JSON", "снова не JSON"]);

    await expect(extractTextDna(apiConfig, source, "single")).rejects.toMatchObject({
      kind: "no_json",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.characters.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
  });

  it("отличает отказ провайдера от ошибки JSON и не делает correction", async () => {
    const source = "Имя Мира и её первое сообщение.";
    const fetchMock = mockFetchWithQueue([["", { finishReason: "content_filter" }]]);

    await expect(extractTextDna(apiConfig, source, "single")).rejects.toMatchObject({
      kind: "provider",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("не применяет неподдерживаемый состав группы и не просит модель молча обрезать его", async () => {
    const source = "Мира, Илья, Соня, Лев и Ника действуют вместе.";
    const tooMany = {
      mode: "group",
      scene: {},
      characters: ["Мира", "Илья", "Соня", "Лев", "Ника"].map((name, index) => ({
        key: `c${index}`,
        name,
        aliases: [],
      })),
      relations: [],
      preservedMaterial: [],
      coverage: [{ retainedFacts: ["состав"] }],
    };
    const fetchMock = mockFetchWithQueue([tooMany]);

    await expect(extractTextDna(apiConfig, source, "group")).rejects.toMatchObject({
      kind: "schema",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.characters.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
  });

  it("не дублирует большой payload в correction длинного этапа", async () => {
    const source = longSource();
    const sections = splitTextForTextDna(source);
    const largeFact = "UNIQUE_LARGE_SOURCE_FACT_" + "x".repeat(2_000);
    const fetchMock = mockFetchWithQueue([
      ...sections.map(() => chunkEvidence(largeFact)),
      { mode: "wrong" },
      { mode: "wrong" },
    ]);

    await expect(extractTextDna(apiConfig, source, "single")).rejects.toMatchObject({
      kind: "schema",
    });
    const firstIndexBody = JSON.parse(String(fetchMock.mock.calls[sections.length][1]?.body));
    const correctionBody = JSON.parse(String(fetchMock.mock.calls[sections.length + 1][1]?.body));
    const correctionText = JSON.stringify(correctionBody);
    expect(JSON.stringify(firstIndexBody)).toContain(largeFact);
    expect(correctionText).not.toContain(largeFact);
    expect(correctionText.length).toBeLessThan(JSON.stringify(firstIndexBody).length);
  });
});

describe("Text DNA: resumable long task", () => {
  it("после сбоя index повторяет только index и карточку, а не секции", async () => {
    const source = longSource();
    const sections = splitTextForTextDna(source);
    const task = createTextDnaTask(source, "single");
    const fetchMock = mockFetchWithQueue([
      ...sections.map((_, index) => chunkEvidence(`cached-fact-${index + 1}`)),
      { mode: "wrong" },
      { mode: "wrong" },
    ]);

    await expect(extractTextDna(apiConfig, source, "single", { task })).rejects.toMatchObject({
      kind: "schema",
    });
    expect(task.evidence).toHaveLength(sections.length);
    expect(task.index).toBeUndefined();

    fetchMock.mockImplementationOnce(async () => responseFor(synthesisIndex()));
    fetchMock.mockImplementationOnce(async () => responseFor(cardResponse()));
    const resumed = await extractTextDna(apiConfig, source, "single", { task });

    expect(fetchMock).toHaveBeenCalledTimes(sections.length + 4);
    expect(resumed.prepared.mode).toBe("single");
    expect(task.evidence).toHaveLength(sections.length);
  });

  it("интервально сводит большой evidence, не отправляя его целиком в каждый этап", async () => {
    const source = longSource();
    const sections = splitTextForTextDna(source);
    const facts = sections.map((_, index) => `BATCH_FACT_${index}_${"x".repeat(16_000)}`);
    const batches = expectedIndexBatchCount(facts, sections);
    expect(JSON.stringify(facts).length).toBeGreaterThan(TEXT_DNA_INDEX_INPUT_MAX_CHARS);

    const fetchMock = mockFetchWithQueue([
      ...facts.map((fact) => chunkEvidence(fact)),
      ...Array.from({ length: batches }, () => synthesisIndex()),
      synthesisIndex(),
      cardResponse(),
    ]);

    const result = await extractTextDna(apiConfig, source, "single");

    expect(fetchMock).toHaveBeenCalledTimes(sections.length + batches + 2);
    if (result.prepared.mode !== "single") throw new Error("expected single");
    expect(result.prepared.directorNotes).toContain("BATCH_FACT_0");
    expect(result.prepared.directorNotes).toContain(`BATCH_FACT_${facts.length - 1}`);
  });

  it("инвалидирует кэш при изменении исходника или режима", () => {
    const source = longSource();
    const task = createTextDnaTask(source, "single");

    expect(isTextDnaTaskCompatible(task, source, "single")).toBe(true);
    expect(isTextDnaTaskCompatible(task, `${source}!`, "single")).toBe(false);
    expect(isTextDnaTaskCompatible(task, source, "group")).toBe(false);
  });

  it("сохраняет уникальные факты всех секций в итоговом ledger", async () => {
    const source = longSource();
    const sections = splitTextForTextDna(source);
    const facts = sections.map((_, index) => `UNIQUE_FACT_${index + 1}`);
    mockFetchWithQueue([
      ...facts.map((fact) => chunkEvidence(fact)),
      synthesisIndex(),
      cardResponse(),
    ]);

    const result = await extractTextDna(apiConfig, source, "single");
    if (result.prepared.mode !== "single") throw new Error("expected single");
    for (const fact of facts) expect(result.prepared.directorNotes).toContain(fact);
    expect(result.payload.coverage).toHaveLength(sections.length);
    expect(result.payload.coverage.every((item) => item.retainedFacts.length > 0)).toBe(true);
  });
});

describe("Text DNA: atomic application and no partial persistence", () => {
  it("переносит факты, секрет, правила, лорбук и исходное приветствие в Character", async () => {
    const source = "Имя Мира. Большая карточка с правилами, биографией и первым сообщением.";
    mockFetchWithQueue([singlePayload(splitTextForTextDna(source))]);

    const result = await extractTextDna(apiConfig, source, "single");
    if (result.prepared.mode !== "single") throw new Error("expected single");

    expect(result.prepared.character.name).toBe("Мира");
    expect(result.prepared.character.systemPrompt).toContain("Не раскрывай секрет");
    expect(result.prepared.character.systemPrompt).toContain("не сглаживай противоречия");
    expect(result.prepared.character.firstMessage).toContain("Ты пришёл раньше");
    expect(result.prepared.character.alternateGreetings?.[0]).toContain("Я ждала");
    expect(result.prepared.character.lorebook[0].content).toContain("письмо");
    expect(result.prepared.directorNotes).toContain("право выбора");
  });

  it("не создаёт персонажей и сессии при любом неуспешном извлечении", async () => {
    const source = "Имя Мира и её первое сообщение.";
    mockFetchWithQueue(["не JSON", "снова не JSON"]);

    await expect(extractTextDna(apiConfig, source, "single")).rejects.toThrow();
    expect(await db.characters.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);
  });

  it("создаёт одиночный чат с mysteryMode до первого отображения", async () => {
    const character = sanitizeCharacter({
      id: "text-single",
      name: "Мира",
      firstMessage: "— Ты пришёл.",
      initialStats: { ...DEFAULT_STATS },
    });

    const session = await createSession(character, "Ночной архив", {
      persistCharacter: character,
      mysteryMode: true,
    });

    expect(session.mysteryMode).toBe(true);
    expect(session.showRelationshipToasts).toBe(false);
    expect(await db.characters.get(character.id)).toBeTruthy();
    expect(await db.messages.where("sessionId").equals(session.id).count()).toBe(1);
  });

  it("оставляет обычную новую сессию без глобального режима тайны", async () => {
    const character = sanitizeCharacter({
      id: "text-ordinary",
      name: "Мира",
      firstMessage: "— Обычное начало.",
      initialStats: { ...DEFAULT_STATS },
    });

    const session = await createSession(character, undefined, { persistCharacter: character });

    expect(session.mysteryMode).toBeUndefined();
    expect(session.showRelationshipToasts).toBeUndefined();
  });

  it("создаёт групповую тайную сцену со всеми участниками и отношениями", async () => {
    const cast: Character[] = ["Мира", "Илья", "Соня"].map((name, index) =>
      sanitizeCharacter({
        id: `text-${index}`,
        name,
        firstMessage: `— Я ${name}.`,
        initialStats: { ...DEFAULT_STATS },
      })
    );
    const relations = [
      { id: "r1", from: cast[0].id, to: cast[1].id, text: "Мира подозревает Илью.", updatedAt: Date.now() },
      { id: "r2", from: cast[1].id, to: cast[2].id, text: "Илья скрывает от Сони правду.", updatedAt: Date.now() },
    ];

    const session = await createGroupSession(cast[0], [cast[1], cast[2]], {
      opening: "*Лампа мерцает.*",
      relations,
      persistCharacters: cast,
      mysteryMode: true,
    });

    expect(session.mysteryMode).toBe(true);
    expect(session.showRelationshipToasts).toBe(false);
    expect(session.characterIds).toEqual([cast[1].id, cast[2].id]);
    expect(session.relations).toHaveLength(2);
    expect(await db.characters.count()).toBe(3);
    expect((await db.messages.where("sessionId").equals(session.id).first())?.swipes[0]).toContain("Лампа");
  });
});
