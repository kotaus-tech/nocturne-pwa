import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sanitizeCharacter, sanitizeStats } from "../src/db";
import { parseMetaBlock } from "../src/services/metaParser";
import { DEFAULT_STATS } from "../src/types";
import type { ApiConfig, Character } from "../src/types";
import { validateBlueprint } from "../src/services/v2/schema";
import { buildV2GenerationPrompt, buildV2CorrectionPrompt } from "../src/services/v2/prompt";
import { generateV2Blueprint } from "../src/services/v2/generator";
import { blueprintToCharacter } from "../src/services/v2/toCharacter";
import type { CharacterBlueprintV2, V2Preferences } from "../src/services/v2/v2types";

/**
 * CHARACTER DNA (генератор V2): схема, пайплайн с коррекционным повтором,
 * провайдеры, преобразование в карточку и обратная совместимость хранения.
 */

// ------------------------------------------------------------------
// Фикстуры
// ------------------------------------------------------------------

function validBlueprintRaw(): Record<string, unknown> {
  return {
    identity: {
      gender: "female",
      age: 27,
      name: "Вера",
      culturalContext: "крупный город средней полосы",
      education: "высшее, педагогическое",
      occupationTitle: "администратор фитнес-клуба",
      livingSituation: "снимает однушку рядом с работой",
      financialContext: "копит на переезд",
      relationshipStatus: "не в отношениях",
    },
    tagline: "Спокойная снаружи",
    appearance: {
      summary: "Среднего роста, собранная. Носит тонкое кольцо и крутит его при личных вопросах.",
      distinctiveMarks: ["родинка над бровью"],
      bodyLanguage: ["при волнении поправляет бейдж"],
    },
    psychology: {
      temperament: { introversion: 1, spontaneity: -1, emotionality: 0, optimism: 0, trust: -1, adventurousness: -1 },
      traits: ["собранная", "наблюдательная", "ироничная"],
      socialPersona: "ровно-доброжелательная с клиентами",
      publicSelf: "уверенная, всё под контролем",
      privateSelf: "вечером выключает телефон и смотрит сериалы в тишине",
      vulnerableSelf: "боится потерять человека и начинает писать слишком много",
      strengths: ["надёжность", "внимательность"],
      flaws: ["обидчивость", "контролирующее поведение в мелочах"],
      contradictions: [{ a: "контролирует быт", b: "хаос в собственных чувствах", link: "контроль — способ не сталкиваться с тревогой" }],
      values: ["стабильность", "честность"],
      wants: ["переехать в другой город", "закрыть кредит"],
      fears: ["публичное унижение", "стоматологи"],
      boundaries: ["не терпит ложь", "не терпит давление"],
    },
    life: {
      occupationField: "спорт и фитнес",
      occupationImpact: "сбитый сон из-за ранних смен, профессиональная улыбка",
      home: "однушка с идеальной кухней и коробками от онлайн-заказов",
      hobbies: ["собирает плейлисты под конкретные ситуации"],
      lifestyleDetails: [
        "не засыпает без фонового видео",
        "покупает дорогую технику и экономит на доставке",
        "всегда знает, где в зале лежат ключи",
        "кофе только до полудня",
      ],
      socialCircle: [
        { role: "лучшая подруга", name: "Дина", meaning: "единственный человек, который видел её в слезах" },
        { role: "брат", name: "Костя", meaning: "вечно занимает деньги" },
      ],
      formativeEvents: [{ event: "переезд из маленького города", impact: "научилась всё делать сама" }],
      dramaLevel: "ordinary",
    },
    relationship: {
      dynamic: "постоянный посетитель клуба, где она работает",
      attitude: "ровно-нейтральное с лёгким любопытством",
      attachment: ["медленно доверяет", "ценит постоянство"],
      conflictStyle: "становится чрезмерно вежливой и формальной",
      postConflict: "долго остывает, первой не мирится",
      affectionStyle: ["запоминает мелочи", "помогает с рутиной"],
      jealousy: { intensity: "low", expression: "язвит" },
      romance: { feelingsPace: "медленно", flirtStyle: "подколы", openness: "сдержанная", commitment: "осторожно" },
      pacing: "slow burn",
      stage: "Familiar",
    },
    speech: {
      verbosity: "normal",
      formality: "casual",
      profanity: "rare",
      humor: "dry",
      slang: "light",
      texting: "короткие сообщения без эмодзи",
      verbalTics: ["«ну ок»"],
      contextual: [{ when: "злится", change: "очень короткие холодные ответы" }],
      examples: [
        { mood: "обычно", line: "У тебя сегодня по плану подвиги или как всегда?" },
        { mood: "раздражение", line: "Отлично. Просто отлично." },
      ],
    },
    behaviorRules: [
      "Не рассказывает о прошлом без достаточного доверия.",
      "На искренние комплименты сначала отшучивается.",
      "Если {{user}} явно расстроен, становится менее ироничной.",
      "Во время серьёзного конфликта говорит короче обычного.",
      "Не соглашается сразу, если предложение противоречит её планам.",
    ],
    knowledgeBoundaries: ["не знает, чем {{user}} занимается вне клуба"],
    scenario: {
      context: "знакомы три месяца как посетитель и администратор",
      location: "почти пустой фитнес-клуб вечером",
      reason: "{{user}} задержался после закрытия зала",
      moment: "сломалась кофемашина",
      hook: "впервые им нечем заняться кроме разговора",
      text: "Вечер, клуб почти закрыт. {{user}} задержался после тренировки, и именно в этот момент сломалась кофемашина — единственное, что Вера собиралась сделать перед уходом.",
    },
    secrets: [{ level: "awkward", content: "смотрит романтические реалити-шоу", revealCondition: "очень высокий уровень доверия" }],
    memories: ["переехала в город пять лет назад", "работает в клубе третий год"],
    characterArcs: [{ trigger: "при высоком доверии", change: "перестаёт отшучиваться от серьёзных вопросов" }],
    initialStats: { trust: 35, affection: 20, closeness: 10, tension: 20, conflict: 0, attraction: 25, statusTitle: "Знакомы" },
    firstMessage: "*Вера дёргает ручку кофемашины, потом смотрит на тебя.* — Только не говори, что тебе тоже нужен кофе. Она сегодня объявила забастовку.",
  };
}

const prefs: V2Preferences = {
  gender: "female",
  ageBandId: "age_27_32",
  selections: { field: ["sport"], dynamic: ["regular_customer"] },
  customIdea: "",
  uniqueness: 1,
  adultEnabled: false,
};

const openaiConfig: ApiConfig = {
  mode: "openai",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk_test",
  model: "openai/gpt-4o-mini",
  temperature: 0.9,
  contextWindow: 24,
};

// ------------------------------------------------------------------
// Схема
// ------------------------------------------------------------------

describe("схема V2: строгая валидация", () => {
  it("пропускает полный валидный blueprint", () => {
    const result = validateBlueprint(validBlueprintRaw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.blueprint.identity.age).toBe(27);
      expect(result.blueprint.initialStats.attraction).toBe(25);
    }
  });

  it("не пропускает не-объект", () => {
    expect(validateBlueprint("привет").ok).toBe(false);
    expect(validateBlueprint(null).ok).toBe(false);
  });

  it("требует минимум один настоящий недостаток", () => {
    const raw = validBlueprintRaw();
    (raw.psychology as any).flaws = [];
    const result = validateBlueprint(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("flaws");
  });

  it("требует противоречие, слои личности и цели вне {{user}}", () => {
    const raw = validBlueprintRaw();
    (raw.psychology as any).contradictions = [];
    (raw.psychology as any).vulnerableSelf = "";
    (raw.psychology as any).wants = [];
    const result = validateBlueprint(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.issues.join(" ");
      expect(joined).toContain("contradictions");
      expect(joined).toContain("vulnerableSelf");
      expect(joined).toContain("wants");
    }
  });

  it("запрещает возраст младше 18", () => {
    const raw = validBlueprintRaw();
    (raw.identity as any).age = 17;
    const result = validateBlueprint(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("18");
  });

  it("запрещает взрослый профиль при школьном контексте", () => {
    const raw = validBlueprintRaw();
    (raw.identity as any).occupationTitle = "школьница, 11 класс";
    (raw as any).intimacy = { enabled: true };
    const result = validateBlueprint(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/школьн|взросл/);
    }
  });

  it("ловит неверные перечисления речи", () => {
    const raw = validBlueprintRaw();
    (raw.speech as any).verbosity = "болтливый";
    const result = validateBlueprint(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("verbosity");
  });

  it("нормализует взрослые параметры только из разрешённого набора", () => {
    const raw = validBlueprintRaw();
    (raw as any).intimacy = {
      enabled: true,
      libido: "extreme",
      openness: "private",
      power: "dominant",
    };
    const result = validateBlueprint(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.blueprint.intimacy?.enabled).toBe(true);
      expect(result.blueprint.intimacy?.libido).toBeUndefined();
      expect(result.blueprint.intimacy?.openness).toBe("private");
      expect(result.blueprint.intimacy?.power).toBe("dominant");
    }
  });

  it("зажимает статистики в 0–100", () => {
    const raw = validBlueprintRaw();
    (raw.initialStats as any).trust = 240;
    (raw.initialStats as any).conflict = -12;
    const result = validateBlueprint(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.blueprint.initialStats.trust).toBe(100);
      expect(result.blueprint.initialStats.conflict).toBe(0);
    }
  });
});

// ------------------------------------------------------------------
// Промпт
// ------------------------------------------------------------------

describe("промпт V2", () => {
  it("содержит жёсткие ограничения и семантику выбранных опций", () => {
    const prompt = buildV2GenerationPrompt(prefs, []);

    expect(prompt).toContain("взрослый человек");
    expect(prompt).toContain("Современный реалистичный мир");
    expect(prompt).toContain("один валидный JSON");
    // Разрешение id → семантика, а не голый список имён
    expect(prompt).toContain("спорт и фитнес");
    expect(prompt).toContain("регулярно приходит туда, где работает другой");
    // Анти-клише и самопроверка
    expect(prompt).toContain("САМОПРОВЕРКА");
    expect(prompt).toContain("ухмыльнулась");
  });

  it("две выбранные сферы промпт просит совместить в одно занятие", () => {
    const prompt = buildV2GenerationPrompt(
      { ...prefs, selections: { field: ["design", "photo"] } },
      []
    );
    expect(prompt).toContain("Совмести эти сферы в одно целостное занятие");
  });

  it("custom idea передаётся с высоким приоритетом", () => {
    const prompt = buildV2GenerationPrompt(
      { ...prefs, customIdea: "девушка из кофейни напротив" },
      []
    );
    expect(prompt).toContain("девушка из кофейни напротив");
    expect(prompt).toContain("высокий приоритет");
  });

  it("взрослый профиль добавляет инварианты 18+ и контекстность", () => {
    const prompt = buildV2GenerationPrompt({ ...prefs, adultEnabled: true }, []);
    expect(prompt).toContain("совершеннолетние");
    expect(prompt).toContain("НЕ переводит всё в сексуальный контекст");

    const without = buildV2GenerationPrompt(prefs, []);
    expect(without).toContain("Взрослый профиль НЕ запрошен");
  });

  it("память разнообразия запрещает повторять недавних персонажей", () => {
    const prompt = buildV2GenerationPrompt(prefs, [
      { g: "female", a: "27-32", o: "IT", d: "Коллеги", t: "саркастичная", s: "casual/dry", ts: 1 },
    ]);
    expect(prompt).toContain("ПАМЯТЬ РАЗНООБРАЗИЯ");
    expect(prompt).toContain("IT");
  });

  it("коррекционный промпт перечисляет проблемы валидации", () => {
    const correction = buildV2CorrectionPrompt("ОРИГИНАЛ", "{}", [
      "psychology.flaws: нужен минимум 1 настоящий недостаток",
    ]);
    expect(correction).toContain("ОРИГИНАЛ");
    expect(correction).toContain("валидацию");
    expect(correction).toContain("flaws");
    expect(correction).toContain("ИСПРАВЛЕННЫЙ ПОЛНЫЙ JSON");
  });
});

// ------------------------------------------------------------------
// Пайплайн с моками сети
// ------------------------------------------------------------------

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("пайплайн генерации V2", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("принимает валидный ответ с первого запроса", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(validBlueprintRaw())
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateV2Blueprint(openaiConfig, prefs);

    expect(result.corrected).toBe(false);
    expect(result.blueprint.identity.name).toBe("Вера");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.stream).toBe(false);
  });

  it("делает один коррекционный повтор при ошибке схемы", async () => {
    const broken = validBlueprintRaw();
    (broken.psychology as any).flaws = [];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(broken))
      .mockResolvedValueOnce(jsonResponse(validBlueprintRaw()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateV2Blueprint(openaiConfig, prefs);

    expect(result.corrected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const secondTurns = JSON.stringify(secondBody.messages);
    expect(secondTurns).toContain("flaws");
    expect(secondTurns).toContain("ИСПРАВЛЕННЫЙ ПОЛНЫЙ JSON");
  });

  it("не зацикливается: после двух неудач — понятная ошибка", async () => {
    const broken = validBlueprintRaw();
    (broken.psychology as any).flaws = [];

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(broken)
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateV2Blueprint(openaiConfig, prefs)).rejects.toThrow(/ошибками|валидацию/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("текст вместо JSON тоже получает один шанс на исправление", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Хорошо, вот персонаж: Вера — администратор…" } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(jsonResponse(validBlueprintRaw()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateV2Blueprint(openaiConfig, prefs);
    expect(result.corrected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ходит в Gemini с JSON-режимом", async () => {
    const geminiConfig: ApiConfig = { ...openaiConfig, mode: "gemini", model: "gemini-2.0-flash" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("gemini-2.0-flash");
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(validBlueprintRaw()) }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateV2Blueprint(geminiConfig, prefs);
    expect(result.blueprint.identity.name).toBe("Вера");

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("для Ollama выключает размышления и требует JSON-формат, с 404-фолбэком", async () => {
    const ollamaConfig: ApiConfig = {
      ...openaiConfig,
      baseUrl: "http://127.0.0.1:11434",
      apiKey: "",
      model: "llama3.1",
    };

    const calls: { url: string; body: any }[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, body: JSON.parse(String(init?.body)) });

      if (url.endsWith("/api/chat")) {
        return new Response("404 page not found", { status: 404 });
      }
      return jsonResponse(validBlueprintRaw());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateV2Blueprint(ollamaConfig, prefs);
    expect(result.blueprint.identity.name).toBe("Вера");

    expect(calls[0].url).toContain("/api/chat");
    expect(calls[0].body.format).toBe("json");
    expect(calls[0].body.think).toBe(false);
    expect(calls[1].url).toContain("/v1/chat/completions");
  });
});

// ------------------------------------------------------------------
// Blueprint → Character
// ------------------------------------------------------------------

describe("blueprint → character", () => {
  const blueprint = ((): CharacterBlueprintV2 => {
    const result = validateBlueprint(validBlueprintRaw());
    if (!result.ok) throw new Error(result.issues.join("; "));
    return result.blueprint;
  })();

  it("собирает карточку, совместимую с существующей системой", () => {
    const character = blueprintToCharacter(blueprint, {
      preferenceNames: ["Спорт и фитнес"],
      now: 123456,
    });

    expect(character.name).toBe("Вера");
    expect(character.age).toBe("27");
    expect(character.tagline).toBe("Спокойная снаружи");
    expect(character.genre).toBe("Современность");
    expect(character.originTag).toBe("CHARACTER DNA");
    expect(character.generatorVersion).toBe(2);
    expect(character.blueprintV2?.version).toBe(2);
    expect(character.tags).toContain("Character DNA");
    expect(character.tags).toContain("Спорт и фитнес");

    // Все обязательные поля карточки заполнены
    expect((character.description ?? "").trim().length).toBeGreaterThan(20);
    expect((character.personality ?? "").trim().length).toBeGreaterThan(20);
    expect((character.scenario ?? "").trim().length).toBeGreaterThan(20);
    expect(character.firstMessage.trim().length).toBeGreaterThan(10);

    // Статистики: базовые + независимое влечение
    expect(character.initialStats.trust).toBe(35);
    expect(character.initialStats.attraction).toBe(25);
    expect(character.initialStats.statusTitle).toBe("Знакомы");

    // Lorebook: люди, секреты, место — совместимый формат
    expect(character.lorebook.length).toBeGreaterThan(2);
    for (const entry of character.lorebook) {
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.content.trim().length).toBeGreaterThan(0);
      expect(entry.isActive).toBe(true);
    }
    const secretEntry = character.lorebook.find((entry) => entry.content.includes("НЕ раскрывать"));
    expect(secretEntry).toBeTruthy();
  });

  it("компилирует рантайм-промпт с правилами, слоями и автономией", () => {
    const character = blueprintToCharacter(blueprint);

    expect(character.systemPrompt).toContain("Вера");
    expect(character.systemPrompt).toContain("На людях");
    expect(character.systemPrompt).toContain("В уязвимости");
    // Реальные недостатки — в поведение
    expect(character.systemPrompt).toContain("обидчивость");
    // Анти-сикофантский блок
    expect(character.systemPrompt).toContain("не обязан соглашаться");
    expect(character.systemPrompt).toContain("не знает");
    // Секреты с условием раскрытия
    expect(character.systemPrompt).toContain("СЕКРЕТЫ");
    // Без взрослого профиля — никакого 18+ блока
    expect(character.systemPrompt).not.toContain("ВЗРОСЛЫЙ ПРОФИЛЬ");
  });

  it("взрослый профиль попадает в рантайм как контекстный блок", () => {
    const raw = validBlueprintRaw();
    (raw as any).intimacy = {
      enabled: true,
      libido: "high",
      openness: "reserved",
      feelingsVsSex: "prefers_connection",
      aftercare: "affectionate",
    };
    const result = validateBlueprint(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const character = blueprintToCharacter(result.blueprint);
    expect(character.systemPrompt).toContain("ВЗРОСЛЫЙ ПРОФИЛЬ (18+, КОНТЕКСТНЫЙ)");
    expect(character.systemPrompt).toContain("не сексуализируй диалог");
    // Ключевой принцип: высокое либидо + закрытость — независимые параметры
    expect(character.systemPrompt).toContain("либидо: high");
    expect(character.systemPrompt).toContain("открытость: reserved");
  });
});

// ------------------------------------------------------------------
// Хранение и обратная совместимость
// ------------------------------------------------------------------

describe("хранение V2 и обратная совместимость", () => {
  afterEach(async () => {
    await db.characters.clear();
  });

  const blueprint = ((): CharacterBlueprintV2 => {
    const result = validateBlueprint(validBlueprintRaw());
    if (!result.ok) throw new Error(result.issues.join("; "));
    return result.blueprint;
  })();

  it("sanitizeCharacter сохраняет blueprint и версию генератора", () => {
    const character = blueprintToCharacter(blueprint);
    const sanitized = sanitizeCharacter(character);

    expect(sanitized.generatorVersion).toBe(2);
    expect(sanitized.blueprintV2?.identity.name).toBe("Вера");
    expect(sanitized.initialStats.attraction).toBe(25);
  });

  it("V1-персонаж без blueprint проходит сквозь санитайзер без изменений", () => {
    const v1: Partial<Character> = {
      name: "Мира",
      tagline: "Ведьма",
      description: "Живёт у башни.",
      personality: "Резкая.",
      scenario: "Ночь, гроза.",
      systemPrompt: "Говори кратко.",
      firstMessage: "*Открывает дверь.* — Чего надо?",
      initialStats: { trust: 30, affection: 20, closeness: 15, tension: 25, conflict: 0, statusTitle: "Первая встреча" },
      lorebook: [{ id: "l1", keys: ["башня"], content: "Живёт у северной башни.", isActive: true }],
    };

    const sanitized = sanitizeCharacter(v1);

    expect(sanitized.name).toBe("Мира");
    expect(sanitized.blueprintV2).toBeUndefined();
    expect(sanitized.generatorVersion).toBeUndefined();
    expect(sanitized.initialStats.attraction).toBeUndefined();
  });

  it("мусорный blueprint отбрасывается, карточка остаётся рабочей", () => {
    const sanitized = sanitizeCharacter({
      name: "Сломанный",
      firstMessage: "Привет",
      blueprintV2: { version: 2 }, // нет обязательных секций
    } as any);

    expect(sanitized.name).toBe("Сломанный");
    expect(sanitized.blueprintV2).toBeUndefined();
  });

  it("сохранённый в базу V2-персонаж переживает чтение как есть", async () => {
    const character = blueprintToCharacter(blueprint);
    await db.characters.put(sanitizeCharacter(character));

    const loaded = await db.characters.get(character.id);
    expect(loaded?.blueprintV2?.psychology.flaws.length).toBeGreaterThan(0);
    expect(loaded?.systemPrompt).toContain("Вера");
  });

  it("sanitizeStats хранит влечение опционально и независимо", () => {
    const withAttraction = sanitizeStats({ trust: 10, affection: 5, attraction: 80, statusTitle: "Знакомы" } as any);
    expect(withAttraction.attraction).toBe(80);
    expect(withAttraction.affection).toBe(5);

    const withoutAttraction = sanitizeStats({ trust: 10, statusTitle: "Знакомы" } as any);
    expect(withoutAttraction.attraction).toBeUndefined();
  });

  it("мета-протокол переносит влечение сквозь обновления шкал", () => {
    const withAttraction = { ...DEFAULT_STATS, attraction: 40, statusTitle: "Знакомы" };

    // Модель поменяла доверие — влечение обязано пережить обновление
    const updated = parseMetaBlock(
      'Реплика.\n```meta\n{"stats":{"trust":45}}\n```',
      withAttraction
    );
    expect(updated.stats?.trust).toBe(45);
    expect(updated.stats?.attraction).toBe(40);

    // Модель явно меняет влечение дельтой
    const bumped = parseMetaBlock(
      'Реплика.\n```meta\n{"stats":{"attraction":"+3"}}\n```',
      withAttraction
    );
    expect(bumped.stats?.attraction).toBe(43);

    // У V1-персонажей влечение не появляется из ниоткуда
    const v1 = parseMetaBlock('Реплика.\n```meta\n{"stats":{"trust":45}}\n```', DEFAULT_STATS);
    expect(v1.stats?.attraction).toBeUndefined();
  });
});
