import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, sanitizeCharacter } from "../src/db";
import { DEFAULT_STATS } from "../src/types";
import {
  createGroupSession,
  createSession,
} from "../src/utils/sessionActions";
import {
  extractTextDna,
  prepareTextDnaPayload,
  splitTextForTextDna,
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

function responseFor(value: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
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

function singlePayload(sectionIds: Array<{ id: string; start: number; end: number }>): TextDnaSinglePayload {
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

function groupPayload(sectionIds: Array<{ id: string; start: number; end: number }>): TextDnaGroupPayload {
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

function mockFetchWithQueue(values: unknown[]) {
  const queue = [...values];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
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

  it("строит карту секций перед финальным сведением длинного текста", async () => {
    const source = "ИМЯ Мира. Секрет архива.\n" + "Деталь исходного материала. ".repeat(700);
    const sections = splitTextForTextDna(source);
    const evidenceResponses = sections.map((section) => ({
      sectionId: section.id,
      entities: [{ name: "Мира", aliases: ["она"] }],
      evidence: [{ subject: "Мира", category: "rule", text: "Не раскрывать секрет архива.", sourceQuote: "секрет архива" }],
      sharedContext: [],
      relations: [],
      unmappedMaterial: [],
    }));
    const final = singlePayload(sections);
    const fetchMock = mockFetchWithQueue([...evidenceResponses, final]);

    const result = await extractTextDna(apiConfig, source, "single");

    expect(fetchMock).toHaveBeenCalledTimes(sections.length + 1);
    expect(result.sourceLength).toBe(source.length);
    expect(result.sourceSections).toHaveLength(sections.length);
    expect(result.prepared.mode).toBe("single");
  });
});

describe("Text DNA: typed extraction and mapping", () => {
  it("переносит факты, секрет, правила, лорбук и исходное приветствие в Character", async () => {
    const source = "Имя Мира. Большая карточка с правилами, биографией и первым сообщением.";
    const sections = splitTextForTextDna(source);
    mockFetchWithQueue([singlePayload(sections)]);

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

  it("выстраивает общую сцену, направленные связи и отдельные карточки группы", () => {
    const payload = groupPayload([{ id: "source-1", start: 0, end: 10 }]);
    const prepared = prepareTextDnaPayload(payload);

    expect(prepared.mode).toBe("group");
    if (prepared.mode !== "group") throw new Error("expected group");
    expect(prepared.characters).toHaveLength(3);
    expect(prepared.relations).toHaveLength(2);
    expect(prepared.relations[0].from).toBe(prepared.characters[0].id);
    expect(prepared.relations[0].to).toBe(prepared.characters[1].id);
    expect(prepared.directorNotes).toContain("ПОЛНЫЕ ОТНОШЕНИЯ");
    expect(prepared.opening).toContain("Никто не ожидал");
  });

  it("не принимает неполное покрытие и не доходит до подготовки результата", async () => {
    const source = "A".repeat(11_000);
    const sections = splitTextForTextDna(source);
    const incomplete = singlePayload(sections);
    incomplete.coverage = [incomplete.coverage[0]];
    const fetchMock = mockFetchWithQueue([incomplete, incomplete]);

    await expect(extractTextDna(apiConfig, source, "single")).rejects.toThrow(/неполный|покрытие|сведение/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.characters.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
  });
});

describe("Text DNA: JSON correction and atomic mystery sessions", () => {
  it("делает ограниченный корректирующий запрос после некорректного JSON", async () => {
    const source = "Имя Мира и её первое сообщение.";
    const sections = splitTextForTextDna(source);
    const fetchMock = mockFetchWithQueue(["не JSON", singlePayload(sections)]);

    const result = await extractTextDna(apiConfig, source, "single");

    expect(result.corrected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.messages).toHaveLength(3);
    expect(secondBody.messages[2].content).toContain("Верни только полный JSON");
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
    expect((await db.messages.where("sessionId").equals(session.id).count())).toBe(1);
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
