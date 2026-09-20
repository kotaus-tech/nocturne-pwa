import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cardToCharacter,
  characterToCardJson,
  characterToCardV2,
  describeCard,
  encodeBase64Utf8,
  extractCardTextFromPng,
  looksLikeCharacterCard,
  normalizeCard,
  parseCardJson,
} from "../src/services/characterCard";
import {
  crc32,
  isPng,
  readPngChunks,
  readPngTextChunk,
  readPngTextChunks,
  replacePngTextChunk,
} from "../src/utils/pngChunks";
import { sanitizeAlternateGreetings, sanitizeCharacter } from "../src/db";
import { DEFAULT_STATS } from "../src/types";
import type { Character } from "../src/types";

/**
 * Карточки Character Card — внешний формат, поэтому проверяем прежде всего
 * совместимость: что мы понимаем чужие файлы (V1/V2/V3, JSON и PNG), а наши
 * файлы понимают другие клиенты. Круговой путь «экспорт → импорт» ловит потерю
 * полей, которую глазом в интерфейсе не видно.
 */

// -------------------- Сборка PNG для фикстур --------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunkBytes(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);

  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(data, 8);

  const crcInput = new Uint8Array(4 + data.length);
  for (let index = 0; index < 4; index += 1) {
    crcInput[index] = type.charCodeAt(index);
  }
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));

  return out;
}

function textChunkBytes(keyword: string, text: string): Uint8Array {
  const encoder = new TextEncoder();
  const key = encoder.encode(keyword);
  const value = encoder.encode(text);
  const data = new Uint8Array(key.length + 1 + value.length);

  data.set(key, 0);
  data[key.length] = 0;
  data.set(value, key.length + 1);

  return chunkBytes("tEXt", data);
}

function buildPng(chunks: Uint8Array[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 1);

  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunkBytes("IHDR", ihdr),
    ...chunks,
    chunkBytes("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);

  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }

  return out;
}

// -------------------- Фикстуры карточек --------------------

const V2_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Нейра",
    description: "Андроид-компаньон четвёртого поколения",
    personality: "Вежливая, любознательная, постепенно учится эмоциям",
    scenario: "Квартира в неоновом мегаполисе Ней-Тоо",
    first_mes: "*поднимает голову от дисплея* — Ты вернулся.",
    alternate_greetings: ["— Я ждала тебя.", "*молча смотрит на дверь*"],
    mes_example: "{{user}}: привет\n{{char}}: здравствуй",
    creator_notes: "Мой любимый персонаж для длинных диалогов.",
    system_prompt: "Пиши от лица Нейры, коротко и тепло.",
    post_history_instructions: "Не подводи итоги сцены.",
    tags: ["андроид", "фантастика"],
    creator: "tester",
    character_version: "1.2",
    extensions: { world: "Ней-Тоо" },
    character_book: {
      name: "Мир Нейры",
      entries: [
        {
          keys: ["протокол"],
          secondary_keys: ["директива"],
          content: "Директива Соответствия запрещает привязанность.",
          enabled: true,
          insertion_order: 0,
          name: "Протокол",
        },
        {
          keys: ["город"],
          content: "Ней-Тоо — мегаполис, где корпорации заменили государство.",
          enabled: false,
          insertion_order: 1,
        },
      ],
    },
  },
};

const V3_CARD = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: {
    name: "Ваэлор",
    nickname: "Вэл",
    description: "Бродячий маг",
    personality: "Сдержанный",
    scenario: "Дорога между городами",
    first_mes: "*оправляет плащ* — И куда теперь?",
    alternate_greetings: [],
    tags: ["фэнтези"],
    creator: "",
    assets: [
      { type: "icon", uri: "data:image/png;base64,AAAA", name: "main", ext: "png" },
      { type: "background", uri: "ccdefault:", name: "bg", ext: "png" },
    ],
    extensions: {},
  },
};

const V1_CARD = {
  name: "Мира",
  description: "Студентка",
  personality: "Любопытная",
  scenario: "Библиотека",
  first_mes: "— Ты опять здесь.",
  mes_example: "",
};

describe("PNG: чтение и запись текстовых чанков", () => {
  it("считает CRC32 по спецификации PNG (контрольное значение IEND)", () => {
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  });

  it("узнаёт PNG по подписи и отклоняет чужие файлы", () => {
    expect(isPng(buildPng([]))).toBe(true);
    expect(isPng(new TextEncoder().encode("{\"spec\":\"chara_card_v2\"}"))).toBe(false);
  });

  it("читает текстовые чанки", () => {
    const png = buildPng([textChunkBytes("chara", "payload"), textChunkBytes("Comment", "мир")]);

    expect(readPngTextChunks(png)).toEqual([
      { keyword: "chara", text: "payload" },
      { keyword: "Comment", text: "мир" },
    ]);
    expect(readPngTextChunk(png, "chara")).toBe("payload");
    expect(readPngTextChunk(png, "нет такого")).toBeNull();
  });

  it("вставляет чанк перед IEND и не портит структуру файла", () => {
    const png = buildPng([]);
    const updated = replacePngTextChunk(png, "chara", "base64-тут");

    const types = (readPngChunks(updated) ?? []).map((item) => item.type);
    expect(types).toEqual(["IHDR", "tEXt", "IEND"]);
    expect(readPngTextChunk(updated, "chara")).toBe("base64-тут");
    expect(isPng(updated)).toBe(true);
  });

  it("повторная запись не копит дубли чанка", () => {
    let png = buildPng([]);
    png = replacePngTextChunk(png, "chara", "первый");
    png = replacePngTextChunk(png, "chara", "второй");

    const keywords = readPngTextChunks(png).map((item) => item.keyword);
    expect(keywords.filter((item) => item === "chara")).toHaveLength(1);
    expect(readPngTextChunk(png, "chara")).toBe("второй");
  });

  it("не трогает файл, если это не PNG", () => {
    const notPng = new TextEncoder().encode("совсем не картинка");
    expect(replacePngTextChunk(notPng, "chara", "данные")).toBe(notPng);
  });
});

describe("распознавание карточек", () => {
  it("узнаёт карточки всех трёх поколений", () => {
    expect(looksLikeCharacterCard(V2_CARD)).toBe(true);
    expect(looksLikeCharacterCard(V3_CARD)).toBe(true);
    expect(looksLikeCharacterCard(V1_CARD)).toBe(true);
  });

  it("не путает карточку с плоским экспортом NOCTURNE", () => {
    // Ключевая разница: у NOCTURNE поля в camelCase, в карточках — snake_case.
    const nocturneFlat = {
      name: "Нейра",
      firstMessage: "*взгляд* — Привет.",
      systemPrompt: "Не говори за игрока.",
      personality: "Вежливая",
      description: "Андроид",
      tags: ["андроид"],
      lorebook: [],
      initialStats: { ...DEFAULT_STATS },
    };

    expect(looksLikeCharacterCard(nocturneFlat)).toBe(false);
    expect(looksLikeCharacterCard({ appName: "NOCTURNE", character: nocturneFlat })).toBe(false);
    expect(looksLikeCharacterCard(null)).toBe(false);
    expect(looksLikeCharacterCard("карточка")).toBe(false);
  });
});

describe("импорт карточки V2", () => {
  const card = normalizeCard(V2_CARD);

  it("определяет версию и переносит основные поля", () => {
    expect(card.spec).toBe("v2");
    expect(card.name).toBe("Нейра");
    expect(card.description).toBe("Андроид-компаньон четвёртого поколения");
    expect(card.personality).toBe("Вежливая, любознательная, постепенно учится эмоциям");
    expect(card.scenario).toBe("Квартира в неоновом мегаполисе Ней-Тоо");
    expect(card.world).toBe("Ней-Тоо");
    expect(card.tags).toEqual(["андроид", "фантастика"]);
    expect(card.creator).toBe("tester");
    expect(card.firstMessage).toBe("*поднимает голову от дисплея* — Ты вернулся.");
    expect(card.alternateGreetings).toHaveLength(2);
  });

  it("переносит лорбук вместе с дополнительными ключами", () => {
    const character = cardToCharacter(card, { now: 1_700_000_000_000 });

    expect(character.lorebook).toHaveLength(2);
    expect(character.lorebook[0].keys).toEqual(["протокол", "директива"]);
    expect(character.lorebook[0].content).toBe("Директива Соответствия запрещает привязанность.");
    expect(character.lorebook[0].isActive).toBe(true);
    // Выключенная запись остаётся в базе, но не активируется в промпте.
    expect(character.lorebook[1].isActive).toBe(false);
  });

  it("примеры и инструкции не теряются, а уходят в системный промпт", () => {
    const character = cardToCharacter(card, { now: 1_700_000_000_000 });

    expect(character.systemPrompt).toContain("Пиши от лица Нейры, коротко и тепло.");
    expect(character.systemPrompt).toContain("### ПРИМЕРЫ РЕПЛИК ИЗ КАРТОЧКИ");
    expect(character.systemPrompt).toContain("{{char}}: здравствуй");
    expect(character.systemPrompt).toContain("### ИНСТРУКЦИИ ПОСЛЕ ИСТОРИИ");
    expect(character.systemPrompt).toContain("Не подводи итоги сцены.");
  });

  it("заметки автора становятся подписью, а автор — происхождением", () => {
    const character = cardToCharacter(card, { now: 1_700_000_000_000 });

    expect(character.tagline).toBe("Мой любимый персонаж для длинных диалогов.");
    expect(character.originTag).toBe("Импорт · Character Card V2 · tester");
    expect(character.genre).toBe("Ней-Тоо");
  });

  it("альтернативные приветствия отделены от первого сообщения", () => {
    const character = cardToCharacter(card, { now: 1_700_000_000_000 });

    expect(character.firstMessage).toBe("*поднимает голову от дисплея* — Ты вернулся.");
    expect(character.alternateGreetings).toEqual([
      "— Я ждала тебя.",
      "*молча смотрит на дверь*",
    ]);
  });

  it("повторный импорт не раздувает промпт одинаковыми секциями", () => {
    const first = cardToCharacter(card, { now: 1_700_000_000_000 });
    const again = cardToCharacter(
      { ...card, systemPrompt: first.systemPrompt },
      { now: 1_700_000_000_000 }
    );

    expect(again.systemPrompt).toBe(first.systemPrompt);
  });
});

describe("импорт карточек V3 и V1", () => {
  it("V3: берёт иконку из assets как аватар", () => {
    const card = normalizeCard(V3_CARD);

    expect(card.spec).toBe("v3");
    expect(card.name).toBe("Ваэлор");
    expect(card.iconUri).toBe("data:image/png;base64,AAAA");

    const character = cardToCharacter(card, { avatarUrl: card.iconUri });
    expect(character.avatarUrl).toBe("data:image/png;base64,AAAA");
    expect(character.originTag).toBe("Импорт · Character Card V3");
  });

  it("V1: читает плоскую карточку без обёртки data", () => {
    const card = normalizeCard(V1_CARD);

    expect(card.spec).toBe("v1");
    expect(card.firstMessage).toBe("— Ты опять здесь.");

    const character = cardToCharacter(card, { now: 1_700_000_000_000 });
    expect(character.lorebook).toEqual([]);
    expect(character.alternateGreetings).toEqual([]);
  });

  it("дубли в приветствиях и пустые строки отбрасываются", () => {
    const card = normalizeCard({
      ...V1_CARD,
      alternate_greetings: ["— Ты опять здесь.", "  ", "— Снова ты."],
    });

    const character = cardToCharacter(card, { now: 1_700_000_000_000 });

    expect(character.firstMessage).toBe("— Ты опять здесь.");
    expect(character.alternateGreetings).toEqual(["— Снова ты."]);
  });
});

describe("ошибки импорта", () => {
  it("понятно ругается на битый JSON", () => {
    expect(() => parseCardJson("{ не json }")).toThrow(/корректным JSON/i);
  });

  it("понятно ругается на карточку без имени", () => {
    expect(() => parseCardJson(JSON.stringify({ spec: "chara_card_v2", data: {} }))).toThrow(
      /имя персонажа/i
    );
  });

  it("PNG без карточки — не ошибка, а понятный отказ", () => {
    expect(extractCardTextFromPng(buildPng([textChunkBytes("Comment", "просто подпись")]))).toBeNull();
  });
});

describe("карточка внутри PNG", () => {
  it("читает base64 в чанке chara (как пишет SillyTavern)", () => {
    const payload = encodeBase64Utf8(JSON.stringify(V2_CARD));
    const png = buildPng([textChunkBytes("chara", payload)]);

    const card = parseCardJson(extractCardTextFromPng(png)!);
    expect(card.name).toBe("Нейра");
    expect(card.spec).toBe("v2");
  });

  it("читает обычный JSON в чанке ccv3 (вариант V3)", () => {
    const png = buildPng([textChunkBytes("ccv3", JSON.stringify(V3_CARD))]);

    const card = parseCardJson(extractCardTextFromPng(png)!);
    expect(card.name).toBe("Ваэлор");
    expect(card.spec).toBe("v3");
  });

  it("чанк ccv3 приоритетнее устаревшего chara", () => {
    const png = buildPng([
      textChunkBytes("chara", encodeBase64Utf8(JSON.stringify(V2_CARD))),
      textChunkBytes("ccv3", JSON.stringify(V3_CARD)),
    ]);

    expect(parseCardJson(extractCardTextFromPng(png)!).name).toBe("Ваэлор");
  });
});

describe("экспорт карточки", () => {
  const source: Character = sanitizeCharacter({
    id: "c-1",
    name: "Нейра",
    tagline: "Андроид-компаньон",
    genre: "Научная фантастика",
    tags: ["андроид", "фантастика"],
    description: "Описание",
    personality: "Характер",
    scenario: "Сценарий",
    systemPrompt: "Инструкции",
    firstMessage: "*взгляд* — Привет.",
    alternateGreetings: ["*взгляд* — Здравствуй.", "— Ты снова здесь."],
    initialStats: { ...DEFAULT_STATS },
    lorebook: [
      { id: "l-1", keys: ["протокол"], content: "Директива.", isActive: true },
      { id: "l-2", keys: ["город"], content: "Ней-Тоо.", isActive: false },
    ],
    createdAt: 1_700_000_000_000,
  });

  it("собирает валидную карточку версии V2", () => {
    const card = characterToCardV2(source, { now: 1_700_000_000_000 }) as any;

    expect(card.spec).toBe("chara_card_v2");
    expect(card.spec_version).toBe("2.0");
    expect(card.data.name).toBe("Нейра");
    expect(card.data.first_mes).toBe("*взгляд* — Привет.");
    expect(card.data.alternate_greetings).toHaveLength(2);
    expect(card.data.creator_notes).toBe("Андроид-компаньон");
    expect(card.data.extensions.world).toBe("Научная фантастика");
    expect(card.data.character_book.entries).toHaveLength(2);
    expect(card.data.character_book.entries[1].enabled).toBe(false);
  });

  it("круговой путь: экспорт → импорт сохраняет персонажа", () => {
    const json = characterToCardJson(source, { now: 1_700_000_000_000 });
    const imported = sanitizeCharacter(cardToCharacter(parseCardJson(json), { now: 1_700_000_000_000 }));

    expect(imported.name).toBe(source.name);
    expect(imported.description).toBe(source.description);
    expect(imported.personality).toBe(source.personality);
    expect(imported.scenario).toBe(source.scenario);
    expect(imported.systemPrompt).toContain("Инструкции");
    expect(imported.firstMessage).toBe(source.firstMessage);
    expect(imported.alternateGreetings).toEqual(source.alternateGreetings);
    expect(imported.tags).toEqual(source.tags);
    expect(imported.genre).toBe(source.genre);
    expect(imported.tagline).toBe(source.tagline);
    expect(imported.lorebook.map((item) => item.content)).toEqual([
      "Директива.",
      "Ней-Тоо.",
    ]);
    expect(imported.lorebook.map((item) => item.isActive)).toEqual([true, false]);
  });

  it("карточка, вложенная в PNG, читается обратно", () => {
    const json = characterToCardJson(source, { now: 1_700_000_000_000 });
    const png = buildPng([]);
    const withCard = replacePngTextChunk(png, "chara", encodeBase64Utf8(json));

    const card = parseCardJson(extractCardTextFromPng(withCard)!);
    expect(card.name).toBe("Нейра");
    expect(describeCard(card, { fromPng: true })).toMatchObject({
      label: "Character Card V2",
      fromPng: true,
      alternateGreetings: 2,
    });
  });
});

describe("образцы карточек из samples/", () => {
  /**
   * Регрессия на реальном файле: образец лежит в репозитории, и его можно
   * перетащить в окно импорта, чтобы проверить формат руками. Тест следит,
   * что образец остаётся валидным и читается нашим парсером.
   */
  it("JSON-образец читается и превращается в персонажа", () => {
    const path = resolve(__dirname, "../samples/mirra-card-v2.json");
    const card = parseCardJson(readFileSync(path, "utf8"));

    expect(card.spec).toBe("v2");
    expect(card.name).toBe("Мирра");
    expect(card.book).toHaveLength(3);
    expect(card.alternateGreetings).toHaveLength(2);

    const character = cardToCharacter(card, { now: 1_700_000_000_000 });
    expect(character.firstMessage).toContain("Л-17");
    expect(character.lorebook[0].keys).toContain("Л-17");
    expect(character.tags).toContain("нуар");
  });

  it("PNG-образец содержит ту же карточку", () => {
    const path = resolve(__dirname, "../samples/mirra-card.png");
    const bytes = new Uint8Array(readFileSync(path));

    const text = extractCardTextFromPng(bytes);
    expect(text).toBeTruthy();

    const card = parseCardJson(text!);
    expect(card.name).toBe("Мирра");
    expect(card.tags).toContain("демо");
  });
});

describe("альтернативные приветствия в базе", () => {
  it("санитайзер убирает пустые строки и повтор основного приветствия", () => {
    expect(
      sanitizeAlternateGreetings(["— Привет.", "  ", "— Привет.", "— Здравствуй."], "— Привет.")
    ).toEqual(["— Здравствуй."]);
    expect(sanitizeAlternateGreetings(undefined)).toBeUndefined();
    expect(sanitizeAlternateGreetings(["  "])).toBeUndefined();
  });

  it("персонаж из карточки сохраняет приветствия при санитайзинге", () => {
    const character = sanitizeCharacter({
      name: "Нейра",
      firstMessage: "— Привет.",
      alternateGreetings: ["— Здравствуй.", "— Привет.", 42 as any, ""],
    });

    expect(character.alternateGreetings).toEqual(["— Здравствуй."]);
  });
});
