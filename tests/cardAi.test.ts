import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedCard } from "../src/services/characterCard";
import {
  HUGE_CARD_CHARS,
  auditCard,
  fixCard,
  parseRepair,
  repairCard,
  cardTextLength,
  compressCard,
  enrichCard,
  findEmptyFields,
  needsTranslation,
  parseAudit,
  parseEnrichment,
  parseModelItems,
  planBatches,
  polishCard,
  shouldCompressCard,
  splitTextForModel,
  translateCard,
} from "../src/services/cardAi";
import { callLLM } from "../src/services/apiClient";
import { DEFAULT_API_CONFIG } from "../src/types";
import type { ApiConfig } from "../src/types";

/**
 * Проверяем не качество перевода (его делает модель), а механику: что мы
 *正确地 отправляем все поля, дробим длинные тексты, терпимо относимся к
 * частичным и битым ответам и не перезаписываем уже заполненные поля.
 */

vi.mock("../src/services/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/apiClient")>();
  return { ...actual, callLLM: vi.fn() };
});

const mockedCallLLM = vi.mocked(callLLM);

const apiConfig: ApiConfig = { ...DEFAULT_API_CONFIG, apiKey: "test-key" };

/** Модель, которая «переводит», приписывая метку к каждому фрагменту. */
function replyWithTag(tag: string) {
  mockedCallLLM.mockImplementation(async (_config, _system, turns) => {
    const request = JSON.parse(turns[turns.length - 1].content);
    const items = request.items ?? [{ id: "x", text: turns[turns.length - 1].content }];

    return JSON.stringify({
      items: items.map((item: { id: string; text: string }) => ({
        id: item.id,
        text: `${tag}${item.text}`,
      })),
    });
  });
}

function lastRequest(): { items?: { id: string; text: string }[]; raw: string } {
  const call = mockedCallLLM.mock.calls[mockedCallLLM.mock.calls.length - 1];
  const raw = call[2][call[2].length - 1].content;

  try {
    return { ...JSON.parse(raw), raw };
  } catch {
    return { raw };
  }
}

const ENGLISH_CARD: NormalizedCard = {
  spec: "v2",
  name: "Rosalia Convallaria",
  description: "A tall half-elf with silver hair and cold blue eyes.",
  personality: "Reserved, poised, and serene. An ice queen at first glance.",
  scenario: "Ethralis, a noble household that never embraced her.",
  firstMessage: "*does not turn around* — You are late.",
  alternateGreetings: ["*looks up* — Again you."],
  systemPrompt: "Write in a calm, articulate manner.",
  exampleMessages: "{{user}}: sorry\n{{char}}: her ears turn crimson",
  postHistoryInstructions: "Do not summarise the scene.",
  creatorNotes: "My favourite character.",
  tags: ["fantasy"],
  world: undefined,
  book: [
    {
      keys: ["sword"],
      secondaryKeys: ["aerosteel blade"],
      content: "Her sword is feather-light.",
      enabled: true,
      insertionOrder: 0,
    },
  ],
  iconUri: undefined,
  age: undefined,
};

beforeEach(() => {
  mockedCallLLM.mockReset();
});

describe("нарезка текста для модели", () => {
  it("короткий текст не режется", () => {
    expect(splitTextForModel("one two three")).toHaveLength(1);
  });

  it("длинный текст режется по абзацам и собирается обратно", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Абзац номер ${i}. ${"слово ".repeat(40)}`);
    const source = paragraphs.join("\n\n");

    const parts = splitTextForModel(source, 1200);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("\n\n")).toContain("Абзац номер 19.");
  });

  it("огромный абзац режется по фразам", () => {
    const source = `${"Очень длинное предложение о персонаже. ".repeat(200)}`;
    const parts = splitTextForModel(source, 1000);

    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((part) => part.length <= 1400)).toBe(true);
  });
});

describe("пакеты запросов", () => {
  it("не превышают лимит и нумеруют куски одного поля", () => {
    const slots = [
      { id: "short", target: { kind: "field", field: "description" } as const, parts: ["a".repeat(100)], joinWith: "\n\n" },
      { id: "long", target: { kind: "field", field: "personality" } as const, parts: ["b".repeat(600), "c".repeat(600)], joinWith: "\n\n" },
    ];

    const batches = planBatches(slots, 1000);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches[0].items.map((item) => item.id)).toEqual(["short", "long#0"]);
    expect(batches[1].items.map((item) => item.id)).toEqual(["long#1"]);
    for (const batch of batches) {
      expect(batch.items.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(1000);
    }
  });
});

describe("разбор ответа модели", () => {
  it("читает ровный JSON", () => {
    const result = parseModelItems('{"items":[{"id":"a","text":"А"},{"id":"b","text":"Б"}]}');
    expect(result.get("a")).toBe("А");
    expect(result.get("b")).toBe("Б");
  });

  it("переживает оборванный JSON", () => {
    const result = parseModelItems('{"items":[{"id":"a","text":"А"},{"id":"b","text":"Б"');
    expect(result.get("a")).toBe("А");
  });

  it("переживает пояснения вокруг JSON", () => {
    const result = parseModelItems('Вот перевод:\n```json\n{"items":[{"id":"a","text":"А"}]}\n```\nГотово.');
    expect(result.get("a")).toBe("А");
  });

  it("пропускает пустые и битые записи", () => {
    const result = parseModelItems('{"items":[{"id":"a","text":"   "},{"id":"b"},{"nope":1},{"id":"c","text":"С"}]}');
    expect([...result.keys()]).toEqual(["c"]);
  });

  it("мусор вместо JSON не роняет импорт", () => {
    expect(parseModelItems("извините, не могу помочь").size).toBe(0);
  });
});

describe("нужно ли переводить", () => {
  it("английский — да, русский — нет", () => {
    expect(needsTranslation("She is an ice queen")).toBe(true);
    expect(needsTranslation("Она ледяная королева, сдержанная и спокойная")).toBe(false);
    expect(needsTranslation("*** --- 42")).toBe(false);
    expect(needsTranslation("a")).toBe(false);
  });
});

describe("перевод карточки", () => {
  it("переводит все текстовые поля, включая лорбук и примеры", async () => {
    replyWithTag("[ru] ");

    const { card, changed } = await translateCard(ENGLISH_CARD, { apiConfig });

    expect(changed).toBe(12);
    expect(card.description).toBe("[ru] A tall half-elf with silver hair and cold blue eyes.");
    expect(card.personality).toContain("[ru] ");
    expect(card.scenario).toContain("[ru] ");
    expect(card.firstMessage).toContain("[ru] ");
    expect(card.systemPrompt).toContain("[ru] ");
    expect(card.exampleMessages).toContain("[ru] ");
    expect(card.postHistoryInstructions).toContain("[ru] ");
    expect(card.creatorNotes).toContain("[ru] ");
    expect(card.alternateGreetings[0]).toContain("[ru] ");
    expect(card.book[0].content).toBe("[ru] Her sword is feather-light.");
    // Ключи лорбука важнее всего: по ним ищется активация записи.
    expect(card.book[0].keys[0]).toBe("[ru] sword");
    expect(card.book[0].secondaryKeys[0]).toBe("[ru] aerosteel blade");
    // Имя собственное модель не трогает — его мы и не отправляли.
    expect(card.name).toBe("Rosalia Convallaria");
  });

  it("не отправляет модель уже русский текст", async () => {
    replyWithTag("[ru] ");

    const russian: NormalizedCard = {
      ...ENGLISH_CARD,
      description: "Высокая полуэльфийка с серебряными волосами и холодными глазами.",
      personality: "Сдержанная, спокойная, настоящая ледяная королева.",
    };

    const { changed } = await translateCard(russian, { apiConfig });
    const request = lastRequest();

    expect(changed).toBeLessThan(12);
    expect(request.raw).not.toContain("ледяная королева");
  });

  it("карточка целиком на русском не вызывает модель вовсе", async () => {
    replyWithTag("[ru] ");

    const russian: NormalizedCard = {
      ...ENGLISH_CARD,
      description: "Высокая полуэльфийка.",
      personality: "Сдержанная и спокойная.",
      scenario: "Этралис, дом, который её не принял.",
      firstMessage: "*не оборачивается* — Ты опоздал.",
      alternateGreetings: ["*смотрит* — Снова ты."],
      systemPrompt: "Пиши спокойно.",
      exampleMessages: "Игрок: прости\nПерсонаж: уши краснеют",
      postHistoryInstructions: "Не подводи итоги.",
      creatorNotes: "Мой любимый персонаж.",
      book: [{ ...ENGLISH_CARD.book[0], keys: ["меч"], secondaryKeys: [], content: "Меч лёгкий." }],
    };

    await translateCard(russian, { apiConfig });
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("длинное поле уходит модели несколькими запросами и собирается обратно", async () => {
    replyWithTag("[ru] ");

    const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. ${"word ".repeat(120)}`).join("\n\n");
    const { card } = await translateCard({ ...ENGLISH_CARD, description: long }, { apiConfig });

    expect(mockedCallLLM.mock.calls.length).toBeGreaterThan(1);
    expect(card.description).toContain("Paragraph 0.");
    expect(card.description).toContain("Paragraph 59.");
    expect(card.description.split("[ru] ").length - 1).toBeGreaterThan(1);
  });

  it("пачки уходят параллельно: не больше трёх одновременно", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockedCallLLM.mockImplementation(async (_config, _system, turns) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      await new Promise((resolve) => setTimeout(resolve, 5));

      const items = JSON.parse(turns[turns.length - 1].content).items;
      inFlight -= 1;

      return JSON.stringify({
        items: items.map((item: { id: string; text: string }) => ({ id: item.id, text: item.text })),
      });
    });

    const huge: NormalizedCard = {
      ...ENGLISH_CARD,
      description: Array.from({ length: 200 }, (_, i) => `Block ${i}. ${"word ".repeat(150)}`).join("\n\n"),
    };

    await translateCard(huge, { apiConfig });

    expect(mockedCallLLM.mock.calls.length).toBeGreaterThan(3);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("просит у модели место на ответ: maxTokens не ниже 8192", async () => {
    replyWithTag("[ru] ");

    await translateCard(ENGLISH_CARD, { apiConfig: { ...apiConfig, maxTokens: 1024 } });

    expect(mockedCallLLM.mock.calls[0][0].maxTokens).toBe(8192);
  });

  it("передаёт сигнал отмены в модель", async () => {
    replyWithTag("[ru] ");
    const controller = new AbortController();

    await translateCard(ENGLISH_CARD, { apiConfig, signal: controller.signal });

    expect(mockedCallLLM.mock.calls[0][4]).toBe(controller.signal);
  });

  it("частичный ответ модели не ломает карточку", async () => {
    mockedCallLLM.mockImplementation(async (_config, _system, turns) => {
      const items = JSON.parse(turns[turns.length - 1].content).items;
      return JSON.stringify({ items: items.slice(0, 1).map((i: { id: string }) => ({ id: i.id, text: "перевод" })) });
    });

    const { card } = await translateCard(ENGLISH_CARD, { apiConfig });

    // Что модель вернула — применилось, остальное осталось в оригинале.
    expect(card.description).toBe("перевод");
    expect(card.personality).toContain("ice queen");
  });
});

describe("чистка и сжатие моделью", () => {
  it("чистка прогоняет все поля и пишет результат обратно", async () => {
    mockedCallLLM.mockImplementation(async (_config, _system, turns) => {
      const items = JSON.parse(turns[turns.length - 1].content).items;
      return JSON.stringify({
        items: items.map((item: { id: string; text: string }) => ({
          id: item.id,
          text: item.text.replace(/Update:.*$/gim, "").trim(),
        })),
      });
    });

    const dirty: NormalizedCard = {
      ...ENGLISH_CARD,
      systemPrompt: "Write calmly. 17/07 Update: fixed typos.",
    };

    const { card } = await polishCard(dirty, { apiConfig });
    expect(card.systemPrompt).not.toContain("Update");
    expect(card.systemPrompt).toContain("Write calmly.");
  });

  it("сжатие трогает только раздутые поля", async () => {
    replyWithTag("[short] ");

    const huge: NormalizedCard = {
      ...ENGLISH_CARD,
      description: "word ".repeat(2_000),
      personality: ENGLISH_CARD.personality,
    };

    const { card, changed } = await compressCard(huge, { apiConfig });
    const request = lastRequest();

    expect(changed).toBeGreaterThan(0);
    expect(card.description).toContain("[short] ");
    expect(card.personality).toBe(ENGLISH_CARD.personality);
    expect(request.raw).not.toContain(ENGLISH_CARD.personality);
  });

  it("сжатие предлагается только для очень больших карточек", () => {
    expect(shouldCompressCard(ENGLISH_CARD)).toBe(false);

    const huge: NormalizedCard = { ...ENGLISH_CARD, description: "а".repeat(HUGE_CARD_CHARS + 100) };
    expect(shouldCompressCard(huge)).toBe(true);
    expect(cardTextLength(huge)).toBeGreaterThan(HUGE_CARD_CHARS);
  });
});

describe("дополнение полей", () => {
  it("разбирает ответ и ограничивает теги", () => {
    const result = parseEnrichment(
      '{"tagline":"Ледяная наёмница","genre":"Фэнтези","tags":["наёмница","полуэльф","фэнтези","меч","город","птицы","лишний"]}'
    );

    expect(result.tagline).toBe("Ледяная наёмница");
    expect(result.genre).toBe("Фэнтези");
    expect(result.tags).toHaveLength(6);
  });

  it("пустой и битый ответ не даёт ничего", () => {
    expect(parseEnrichment("{}")).toEqual({});
    expect(parseEnrichment("не json")).toEqual({});
  });

  it("заполняет только пустые поля и не выдумывает лишнего", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({ tagline: "Ледяная наёмница", genre: "Фэнтези", tags: ["наёмница", "полуэльф"] })
    );

    const withoutNotes: NormalizedCard = { ...ENGLISH_CARD, creatorNotes: "" };
    const { card, filled } = await enrichCard(withoutNotes, { apiConfig });

    expect(filled).toContain("подпись");
    expect(filled).toContain("жанр");
    expect(card.world).toBe("Фэнтези");
    expect(card.creatorNotes).toBe("Ледяная наёмница");
    // Свои теги карточки сохранились и дополнились, а не заменились.
    expect(card.tags).toEqual(["fantasy", "наёмница", "полуэльф"]);
  });

  it("модель не выдумывает: пустые значения игнорируются", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ tagline: "", genre: "", tags: [] }));

    const { card, filled } = await enrichCard(ENGLISH_CARD, { apiConfig });

    expect(filled).toEqual([]);
    expect(card.world).toBeUndefined();
    expect(card.creatorNotes).toBe(ENGLISH_CARD.creatorNotes);
  });

  it("уже заполненные поля не перезаписываются", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ genre: "Другое" }));

    const withGenre: NormalizedCard = { ...ENGLISH_CARD, world: "Своё фэнтези" };
    const { card, filled } = await enrichCard(withGenre, { apiConfig });

    expect(card.world).toBe("Своё фэнтези");
    expect(filled).not.toContain("жанр");
  });
});

describe("проверка полей", () => {
  it("пустые поля находятся без модели", () => {
    const empty = findEmptyFields({
      ...ENGLISH_CARD,
      personality: "",
      scenario: "",
      book: [],
    });

    expect(empty).toContain("характер");
    expect(empty).toContain("сценарий и завязка");
    expect(empty).toContain("лорбук");
    expect(empty).not.toContain("внешность и описание");
  });

  it("разбирает замечания модели, обрезая список", () => {
    const issues = Array.from({ length: 12 }, (_, i) => ({
      field: "поле",
      problem: `проблема ${i}`,
      suggestion: `правка ${i}`,
    }));

    const result = parseAudit(JSON.stringify({ issues, summary: "Всё плохо" }));

    expect(result.issues).toHaveLength(8);
    expect(result.summary).toBe("Всё плохо");
  });

  it("непонятный ответ модели объясняется по-человечески", () => {
    const result = parseAudit("модель недоступна");
    expect(result.issues).toEqual([]);
    expect(result.summary).toMatch(/проверка не удалась/i);
  });

});

describe("проверка карточки моделью", () => {
  it("возвращает замечания модели вместе с пустыми полями", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({
        issues: [{ field: "характер", problem: "Здесь лежит внешность", suggestion: "Поменять местами" }],
        summary: "Поля перепутаны",
      })
    );

    const result = await auditCard({ ...ENGLISH_CARD, personality: "" }, { apiConfig });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].problem).toBe("Здесь лежит внешность");
    expect(result.summary).toBe("Поля перепутаны");
    expect(result.emptyFields).toContain("характер");
  });
});

describe("исправление карточки (поля перепутаны)", () => {
  it("разбирает ответ модели и применяет только изменённые поля", () => {
    const result = parseRepair(
      '{"fields":{"description":"Высокая полуэльфийка","personality":"Сдержанная"},"notes":["поменял местами"]}'
    );

    expect(result.fields.description).toBe("Высокая полуэльфийка");
    expect(result.fields.personality).toBe("Сдержанная");
    expect(result.fields.scenario).toBeUndefined();
    expect(result.notes).toEqual(["поменял местами"]);
  });

  it("пустые правки игнорируются, мусорный ответ не ломает карточку", () => {
    expect(parseRepair('{"fields":{"description":"   "}}').fields).toEqual({});
    expect(parseRepair("модель не отвечает").fields).toEqual({});
  });

  it("модель сама расставляет поля: характер возвращается из внешности", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({
        fields: { description: "Серебряные волосы, холодные глаза.", personality: "Сдержанная, язвительная." },
        notes: ["характер и внешность были перепутаны"],
      })
    );

    const swapped: NormalizedCard = {
      ...ENGLISH_CARD,
      description: "Reserved and sharp-tongued.",
      personality: "Silver hair, cold blue eyes.",
    };

    const { card, notes } = await repairCard(swapped, { apiConfig });

    expect(card.description).toBe("Серебряные волосы, холодные глаза.");
    expect(card.personality).toBe("Сдержанная, язвительная.");
    expect(notes).toEqual(["характер и внешность были перепутаны"]);
    // Что модель не вернула — остаётся как было.
    expect(card.scenario).toBe(ENGLISH_CARD.scenario);
  });
});

describe("«привести в порядок» одним нажатием", () => {
  it("проходит чистку, исправление, дополнение и проверку", async () => {
    const stages: string[] = [];

    mockedCallLLM.mockImplementation(async (_config, system, turns) => {
      if (system.includes("Приведи её в порядок")) {
        stages.push("repair");
        return JSON.stringify({
          fields: { systemPrompt: "Пиши спокойно, не подводи итогов." },
          notes: ["убрал остатки changelog"],
        });
      }

      if (system.includes("часть полей пуста")) {
        stages.push("enrich");
        return JSON.stringify({ tagline: "Ледяная наёмница", genre: "Фэнтези", tags: ["наёмница"] });
      }

      if (system.includes("Проверь карточку")) {
        stages.push("audit");
        return JSON.stringify({ issues: [], summary: "Карточка в порядке" });
      }

      // Остальное — проход по тексту (чистка): удаляем «Update».
      const items = JSON.parse(turns[turns.length - 1].content).items;
      stages.push("polish");
      return JSON.stringify({
        items: items.map((item: { id: string; text: string }) => ({
          id: item.id,
          text: item.text.replace(/\d{2}\/\d{2} Update.*$/gim, "").trim(),
        })),
      });
    });

    const dirty: NormalizedCard = {
      ...ENGLISH_CARD,
      creatorNotes: "",
      systemPrompt: "Write calmly. 17/07 Update: fixed typos.",
    };

    const result = await fixCard(dirty, { apiConfig });

    expect(stages).toContain("polish");
    expect(stages).toContain("repair");
    expect(stages).toContain("enrich");
    expect(stages).toContain("audit");
    expect(result.card.systemPrompt).not.toContain("Update");
    expect(result.card.creatorNotes).toBe("Ледяная наёмница");
    expect(result.card.world).toBe("Фэнтези");
    expect(result.notes.some((note) => note.includes("changelog"))).toBe(true);
    expect(result.audit?.summary).toBe("Карточка в порядке");
  });

  it("если правок не было — честно об этом говорит", async () => {
    mockedCallLLM.mockImplementation(async (_config, system, turns) => {
      if (system.includes("Приведи её в порядок")) return JSON.stringify({ fields: {}, notes: [] });
      if (system.includes("часть полей пуста")) return JSON.stringify({});
      if (system.includes("Проверь карточку")) return JSON.stringify({ issues: [], summary: "Ок" });

      const items = JSON.parse(turns[turns.length - 1].content).items;
      return JSON.stringify({ items });
    });

    const result = await fixCard({ ...ENGLISH_CARD, creatorNotes: "есть", world: "есть" }, { apiConfig });

    expect(result.notes.join(" ")).toMatch(/правок не потребовалось/i);
  });
});

describe("модель вернула пустой ответ", () => {
  it("переспрашивает и дожимает со второй попытки", async () => {
    mockedCallLLM
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(JSON.stringify({ items: [{ id: "firstMessage", text: "*не оборачивается*" }] }));

    const { card } = await polishCard(ENGLISH_CARD, { apiConfig });

    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
    expect(card.firstMessage).toBe("*не оборачивается*");
  });

  it("ошибка «пустой ответ» от провайдера — тоже повод переспросить", async () => {
    mockedCallLLM
      .mockRejectedValueOnce(new Error("Gemini вернул пустой ответ."))
      .mockResolvedValueOnce(JSON.stringify({ issues: [], summary: "Ок" }));

    const result = await auditCard(ENGLISH_CARD, { apiConfig });

    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
    expect(result.summary).toBe("Ок");
  });

  it("проверка не роняет импорт, если модель не отвечает вовсе", async () => {
    mockedCallLLM.mockResolvedValue("   ");

    const result = await auditCard(ENGLISH_CARD, { apiConfig });

    expect(mockedCallLLM).toHaveBeenCalledTimes(3);
    expect(result.issues).toEqual([]);
    expect(result.summary).toMatch(/пустой ответ|попробуйте/i);
    expect(result.emptyFields).toEqual([]);
  });

  it("отмена не считается ошибкой и не вызывает повторы", async () => {
    const controller = new AbortController();
    controller.abort();

    mockedCallLLM.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    await expect(auditCard(ENGLISH_CARD, { apiConfig, signal: controller.signal })).rejects.toThrow(
      /aborted/i
    );
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
  });
});

describe("промпт перевода", () => {
  it("требует адаптировать имена и термины под русский", async () => {
    replyWithTag("[ru] ");
    await translateCard(ENGLISH_CARD, { apiConfig });

    const system = mockedCallLLM.mock.calls[0][1];

    expect(system).toMatch(/Rosalia → Розалия/);
    expect(system).toMatch(/Ethralis → Этралис/);
    expect(system).toMatch(/Варамис, Варамиса/);
    // И при этом не ломает оформление и характер.
    expect(system).toMatch(/\*действия в звёздочках\*/);
    expect(system).toMatch(/не цензурируй/);
  });
});
