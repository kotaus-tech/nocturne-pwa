import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedCard } from "../src/services/characterCard";
import {
  HUGE_CARD_CHARS,
  fixCard,
  parseRepair,
  repairCard,
  cardTextLength,
  compressCard,
  enrichCard,
  needsTranslation,
  parseEnrichment,
  parseModelItems,
  planBatches,
  polishCard,
  polishSystem,
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

  it("английский текст с вкраплением русского имени всё равно переводится", () => {
    // Короткое поле, где {{user}} заменили на русское имя персоны: имя
    // перевешивает по символам, но английская проза никуда не делась.
    expect(needsTranslation("Александр meets the ice queen at the old tavern near the river")).toBe(true);
    // А вот почти чистое обращение без английской прозы — не переводим.
    expect(needsTranslation("Александр и Розалия")).toBe(false);
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

  it("пустая строка — осмысленная правка (очистить поле), мусорный ответ не ломает карточку", () => {
    // Модель перенесла содержимое в правильное поле и очищает старое место —
    // пустая строка должна дойти до карточки, иначе текст задвоится.
    expect(parseRepair('{"fields":{"description":"   "}}').fields).toEqual({ description: "" });
    expect(parseRepair("модель не отвечает").fields).toEqual({});
  });

  it("очистка поля применяется к карточке", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({
        fields: {
          description: "Серебряные волосы, холодные глаза.",
          personality: "Сдержанная, язвительная.",
          scenario: "",
        },
        notes: ["предыстория уехала из сценария"],
      })
    );

    // В сценарии лежит характер — после исправления сценарий пустеет.
    const swapped: NormalizedCard = {
      ...ENGLISH_CARD,
      description: "Reserved and sharp-tongued.",
      personality: "Silver hair, cold blue eyes.",
      scenario: "Personality dump that belongs elsewhere.",
    };

    const { card } = await repairCard(swapped, { apiConfig });

    expect(card.description).toBe("Серебряные волосы, холодные глаза.");
    expect(card.scenario).toBe("");
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
  it("проходит чистку, исправление и дополнение", async () => {
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
    expect(result.card.systemPrompt).not.toContain("Update");
    expect(result.card.creatorNotes).toBe("Ледяная наёмница");
    expect(result.card.world).toBe("Фэнтези");
    expect(result.notes.some((note) => note.includes("changelog"))).toBe(true);
  });

  it("если правок не было — честно об этом говорит", async () => {
    mockedCallLLM.mockImplementation(async (_config, system, turns) => {
      if (system.includes("Приведи её в порядок")) return JSON.stringify({ fields: {}, notes: [] });
      if (system.includes("часть полей пуста")) return JSON.stringify({});

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
      .mockResolvedValueOnce(JSON.stringify({ items: [{ id: "firstMessage", text: "*смотрит*" }] }));

    const { card } = await polishCard(ENGLISH_CARD, { apiConfig });

    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
    expect(card.firstMessage).toBe("*смотрит*");
  });

  it("отмена не считается ошибкой и не вызывает повторы", async () => {
    const controller = new AbortController();
    controller.abort();

    mockedCallLLM.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    await expect(polishCard(ENGLISH_CARD, { apiConfig, signal: controller.signal })).rejects.toThrow(
      /aborted/i
    );
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
  });
});

describe("модель ответила не по форме или отказалась", () => {
  it("на мусорный ответ переспрашивает с напоминанием формата и дожимает", async () => {
    mockedCallLLM
      .mockResolvedValueOnce("I'm sorry, I can't help with that.")
      .mockResolvedValueOnce(JSON.stringify({ items: [{ id: "firstMessage", text: "*перевод*" }] }));

    const { card, answered } = await polishCard(ENGLISH_CARD, { apiConfig });

    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
    // Во втором запросе — напоминание формата вместе с первым ответом модели.
    const retryTurns = mockedCallLLM.mock.calls[1][2];
    expect(retryTurns[retryTurns.length - 1].content).toMatch(/строго JSON/);
    expect(card.firstMessage).toBe("*перевод*");
    expect(answered).toBeGreaterThan(0);
  });

  it("если и переспрос не помог — ничего не применяется и отчёт честный", async () => {
    mockedCallLLM.mockResolvedValue("Я не могу обработать этот контент.");

    const { card, sent, answered, changed } = await translateCard(ENGLISH_CARD, { apiConfig });

    // Модель спрашивали (и переспрашивали), но ни один фрагмент не вернулся.
    expect(sent).toBeGreaterThan(0);
    expect(answered).toBe(0);
    expect(changed).toBe(0);
    // Карточка не испорчена отказом модели.
    expect(card.description).toBe(ENGLISH_CARD.description);
    expect(card.firstMessage).toBe(ENGLISH_CARD.firstMessage);
  });

  it("частичный ответ виден в отчёте: отвечено меньше, чем отправлено", async () => {
    mockedCallLLM.mockImplementation(async (_config, _system, turns) => {
      const items = JSON.parse(turns[turns.length - 1].content).items;
      return JSON.stringify({ items: items.slice(0, 1).map((i: { id: string }) => ({ id: i.id, text: "перевод" })) });
    });

    const { sent, answered } = await translateCard(ENGLISH_CARD, { apiConfig });

    expect(sent).toBeGreaterThan(answered);
    expect(answered).toBe(1);
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

describe("промпт чистки", () => {
  it("заменяет плейсхолдеры именами, а не вырезает их", () => {
    const system = polishSystem("Розалия", "Странник");

    // Имена подставлены.
    expect(system).toContain("«Розалия»");
    expect(system).toContain("«Странник»");
    // Главное требование — заменять, а не удалять.
    expect(system).toMatch(/заменять, а не вырезать/);
    expect(system).toMatch(/сохрани предложение целиком/);
  });

  it("отправляется модели вместе с именем персонажа", async () => {
    mockedCallLLM.mockImplementation(async (_config, _system, turns) => {
      const items = JSON.parse(turns[turns.length - 1].content).items;
      return JSON.stringify({ items });
    });

    await polishCard(ENGLISH_CARD, { apiConfig });

    const system = mockedCallLLM.mock.calls[0][1];
    expect(system).toContain("«Rosalia Convallaria»");
  });

  it("без имени персонажа использует запасное слово", () => {
    const system = polishSystem("", "");
    expect(system).toContain("«персонаж»");
    expect(system).toContain("«игрок»");
  });
});

describe("промпт перевода защищает макросы", () => {
  it("запрещает переводить и менять {{user}} / {{char}}", async () => {
    replyWithTag("[ru] ");
    await translateCard(ENGLISH_CARD, { apiConfig });

    const system = mockedCallLLM.mock.calls[0][1];
    expect(system).toMatch(/макросы/);
    expect(system).toMatch(/не переводи и не меняй/);
    // И требует вернуть ровно одну запись на каждый входной id.
    expect(system).toMatch(/верни ровно одну запись с тем же id/);
  });
});

describe("сжатие режет только раздутые куски", () => {
  it("короткие куски внутри длинного поля остаются нетронутыми", async () => {
    replyWithTag("[short] ");

    // description: один раздутый кусок и несколько коротких.
    // Короткие абзацы нарезка объединит, но они должны остаться как были.
    const shortA = "Короткая заметка о её мече.";
    const shortB = "Ещё одна короткая деталь гардероба.";
    const huge = "word ".repeat(2_000); // 10_000 символов

    const card: NormalizedCard = {
      ...ENGLISH_CARD,
      description: `${shortA}\n\n${huge}\n\n${shortB}`,
    };

    const { card: compressed } = await compressCard(card, { apiConfig });
    const request = lastRequest();
    const sentTexts = (request.items ?? []).map((item) => item.text);

    // Модели ушёл только раздутый кусок.
    expect(sentTexts.some((text) => text.length > 2_500)).toBe(true);
    expect(sentTexts.every((text) => text.length > 2_500)).toBe(true);
    // Короткие куски не отправлялись и не менялись.
    expect(request.raw).not.toContain(shortA);
    expect(request.raw).not.toContain(shortB);
    expect(compressed.description).toContain(shortA);
    expect(compressed.description).toContain(shortB);
    // А раздутый кусок модель сжала.
    expect(compressed.description).toContain("[short]");
  });

  it("сжатие не меняет язык текста", () => {
    // Косвенно проверяем через системный промпт: он больше не требует
    // писать по-русски, а просит сохранить язык оригинала.
    replyWithTag("[short] ");
    return compressCard(
      { ...ENGLISH_CARD, description: "word ".repeat(2_000) },
      { apiConfig }
    ).then(() => {
      const system = mockedCallLLM.mock.calls[0][1];
      expect(system).toMatch(/на языке исходного текста/);
      expect(system).toMatch(/примерно на 40%/);
    });
  });
});

describe("«привести в порядок» сжимает огромную карточку первой", () => {
  it("огромная карточка проходит сжатие до чистки и исправления", async () => {
    const stages: string[] = [];

    mockedCallLLM.mockImplementation(async (_config, system, turns) => {
      if (system.includes("примерно на 40%")) {
        stages.push("compress");
        const items = JSON.parse(turns[turns.length - 1].content).items;
        return JSON.stringify({
          items: items.map((item: { id: string; text: string }) => ({
            id: item.id,
            text: item.text.slice(0, 1_500),
          })),
        });
      }

      if (system.includes("Приведи её в порядок")) {
        stages.push("repair");
        return JSON.stringify({ fields: {}, notes: [] });
      }

      if (system.includes("часть полей пуста")) {
        stages.push("enrich");
        return JSON.stringify({});
      }

      stages.push("polish");
      const items = JSON.parse(turns[turns.length - 1].content).items;
      return JSON.stringify({ items });
    });

    const huge: NormalizedCard = {
      ...ENGLISH_CARD,
      creatorNotes: "есть",
      world: "есть",
      description: "Абзац о прошлом. ".repeat(2_000),
    };

    const result = await fixCard(huge, { apiConfig });

    expect(stages[0]).toBe("compress");
    expect(stages).toContain("polish");
    expect(stages).toContain("repair");
    expect(result.notes.some((note) => /сжат/i.test(note))).toBe(true);
    // Поле действительно стало короче.
    expect(result.card.description.length).toBeLessThan(huge.description.length);
  });
});
