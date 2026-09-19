import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  normalizeSearchText,
  searchEverything,
  type GlobalSearchData,
} from "../src/services/globalSearch";
import { DEFAULT_STATS } from "../src/types";
import type { Character, ChatSession, Message } from "../src/types";

const character = (id: string, name: string, extra: Partial<Character> = {}): Character =>
  ({
    id,
    name,
    avatarUrl: "",
    tagline: "",
    description: "",
    personality: "",
    scenario: "",
    firstMessage: "",
    initialStats: { ...DEFAULT_STATS },
    lorebook: [],
    createdAt: 1,
    ...extra,
  } as Character);

const session = (id: string, extra: Partial<ChatSession> = {}): ChatSession =>
  ({
    id,
    characterId: "c-1",
    title: "Ночная смена",
    directorNotes: "",
    currentStats: { ...DEFAULT_STATS },
    createdAt: 1,
    updatedAt: 2,
    ...extra,
  } as ChatSession);

const message = (id: string, text: string, extra: Partial<Message> = {}): Message =>
  ({
    id,
    sessionId: "s-1",
    sender: "assistant",
    swipes: [text],
    currentSwipeIndex: 0,
    timestamp: 1,
    ...extra,
  } as Message);

const data: GlobalSearchData = {
  characters: [
    character("c-1", "Мира", {
      description: "Ведьма с зелёными глазами",
      lorebook: [
        {
          id: "l-1",
          keys: ["Северная башня"],
          content: "В башне живёт старый хранитель",
          isActive: true,
        },
      ],
    }),
    character("c-2", "Кай", { tagline: "Вор с золотым сердцем" }),
  ],
  sessions: [
    session("s-1", {
      summary: "Мира рассказала про северную башню.",
      extractedFacts: [
        {
          id: "f-1",
          keys: ["башня"],
          content: "Мира боится башни",
          createdAt: 3,
        },
      ],
      diary: [
        { id: "d-1", timestamp: 4, entryNumber: 1, thought: "Он спросил про башню", mood: "тревога" },
      ],
      storyLog: [{ id: "e-1", timestamp: 5, text: "Ночь в башне выдалась долгой" }],
    }),
  ],
  messages: [
    message("m-1", "— Я не пойду в башню сегодня."),
    message("m-2", "— Тогда я схожу сам, — усмехнулся Кай."),
  ],
};

describe("глобальный поиск", () => {
  it("не ищет по слишком коротким запросам", () => {
    expect(searchEverything("б", data)).toEqual([]);
    expect(searchEverything("  ", data)).toEqual([]);
  });

  it("находит персонажа по имени и по описанию", () => {
    const byName = searchEverything("мира", data);
    expect(byName[0]).toMatchObject({ kind: "character", id: "c-1", title: "Мира" });

    const byText = searchEverything("золотым", data);
    expect(byText.map((hit) => hit.id)).toContain("c-2");
  });

  it("ставит совпадение в названии выше упоминания в тексте", () => {
    const hits = searchEverything("башн", data);
    const first = hits[0];

    expect(first.kind).toBe("lore");
    expect(hits.map((hit) => hit.kind)).toContain("message");
  });

  it("находит реплики и показывает кусок текста вокруг совпадения", () => {
    const hits = searchEverything("схожу сам", data);
    const reply = hits.find((hit) => hit.kind === "message");

    expect(reply?.id).toBe("m-2");
    expect(reply?.sessionId).toBe("s-1");
    expect(reply?.snippet).toContain("схожу сам");
  });

  it("ищет по памяти, дневникам и хронике", () => {
    const kinds = searchEverything("башню", data).map((hit) => hit.kind);

    expect(kinds).toContain("memory");
    expect(kinds).toContain("diary");
    expect(kinds).toContain("session");
  });

  it("ограничивает число результатов одного типа", () => {
    const many: GlobalSearchData = {
      ...data,
      messages: Array.from({ length: 20 }, (_, index) =>
        message(`m-${index}`, `— Про башню, часть ${index}`)
      ),
    };

    const hits = searchEverything("башню", many, 3);
    expect(hits.filter((hit) => hit.kind === "message")).toHaveLength(3);
  });

  it("возвращает пустой список, если совпадений нет", () => {
    expect(searchEverything("единорог", data)).toEqual([]);
  });
});

describe("сниппеты и нормализация", () => {
  it("нормализует регистр и лишние пробелы", () => {
    expect(normalizeSearchText("  Мира   И   Кай ")).toBe("мира и кай");
  });

  it("вырезает кусок вокруг совпадения в длинном тексте", () => {
    const text = `${"а".repeat(200)} башня ${"б".repeat(200)}`;
    const snippet = buildSnippet(text, "башня", 20);

    expect(snippet).toContain("башня");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThan(text.length);
  });

  it("короткий текст отдаёт целиком", () => {
    expect(buildSnippet("Мира боится башни", "башни")).toBe("Мира боится башни");
  });
});
