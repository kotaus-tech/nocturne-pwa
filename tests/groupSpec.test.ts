import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  db,
  sanitizeAbsentReasons,
  sanitizeActiveCharacterIds,
  sanitizeSceneRelations,
} from "../src/db";
import {
  findMentionedCharacter,
  nextSpeaker,
  resolvePresence,
} from "../src/services/groupScene";
import { buildRoutingPrompt, parseRoutingAnswer } from "../src/services/groupRouter";
import {
  GROUP_SIZE_MAX,
  GROUP_SIZE_MIN,
  buildGroupInstruction,
  clampGroupSize,
  normalizeGeneratedCharacter,
  parseGeneratedGroup,
} from "../src/services/characterGenerator";
import { createGroupSession } from "../src/utils/sessionActions";
import { DEFAULT_STATS } from "../src/types";
import type { Character } from "../src/types";

/**
 * Техзаказ по групповым сценам: присутствие в сцене, выбор говорящего,
 * генератор группы 2–4 героев и создание самой ветки.
 */

const character = (
  id: string,
  name: string,
  overrides: Partial<Character> = {}
): Character => ({
  id,
  name,
  avatarUrl: "",
  tagline: "",
  personality: "Сдержанная и внимательная.",
  systemPrompt: "",
  firstMessage: `*Кивает.* — Я ${name}.`,
  initialStats: { ...DEFAULT_STATS },
  lorebook: [],
  createdAt: 1,
  ...overrides,
});

const cast = [
  character("c-1", "Ая"),
  character("c-2", "Рин"),
  character("c-3", "Кай"),
];

afterEach(async () => {
  await db.characters.clear();
  await db.sessions.clear();
  await db.messages.clear();
});

describe("групповая сцена: присутствие", () => {
  it("без activeCharacterIds в сцене остаются все", () => {
    const presence = resolvePresence(
      { characterId: "c-1", characterIds: ["c-2", "c-3"] },
      cast
    );

    expect(presence.present.map((item) => item.name)).toEqual([
      "Ая",
      "Рин",
      "Кай",
    ]);
    expect(presence.absent).toHaveLength(0);
  });

  it("разделяет состав на присутствующих и отсутствующих с причиной", () => {
    const presence = resolvePresence(
      {
        characterId: "c-1",
        characterIds: ["c-2", "c-3"],
        activeCharacterIds: ["c-1", "c-3"],
        absentReasons: { "c-2": "ушла в гараж" },
      },
      cast
    );

    expect(presence.present.map((item) => item.id)).toEqual(["c-1", "c-3"]);
    expect(presence.absent).toEqual([
      { character: cast[1], reason: "ушла в гараж" },
    ]);
  });

  it("не оставляет сцену без единого героя", () => {
    const presence = resolvePresence(
      {
        characterId: "c-1",
        characterIds: ["c-2"],
        activeCharacterIds: ["c-9"],
      },
      cast
    );

    expect(presence.present).toHaveLength(3);
    expect(presence.absent).toHaveLength(0);
  });

  it("список присутствия чистится: чужие id и дубли уходят, лидер допустим", () => {
    expect(
      sanitizeActiveCharacterIds(
        ["c-2", "c-2", "c-1", "чужой", 5, " c-3 "],
        ["c-2", "c-3"],
        "c-1"
      )
    ).toEqual(["c-2", "c-1", "c-3"]);

    expect(sanitizeActiveCharacterIds([], ["c-2"])).toBeUndefined();
    expect(sanitizeActiveCharacterIds("мусор", ["c-2"])).toBeUndefined();
  });

  it("причины отсутствия обрезаются и не терпят пустых значений", () => {
    expect(
      sanitizeAbsentReasons({
        "c-2": "  ушла в гараж  ",
        "c-3": "   ",
        "c-4": 42,
        "c-5": "я".repeat(200),
      })
    ).toEqual({ "c-2": "ушла в гараж", "c-5": "я".repeat(120) });

    expect(sanitizeAbsentReasons(undefined)).toEqual({});
  });

  it("связи в группе сохраняются, а мусор отбрасывается", () => {
    const relations = sanitizeSceneRelations([
      { from: "c-1", to: "c-2", text: "  тайно влюблена  " },
      { from: "c-2", text: "соперничает со всеми" },
      { from: "c-3", text: "   " },
      "мусор",
      null,
    ]);

    expect(relations).toHaveLength(2);
    expect(relations[0]).toMatchObject({
      from: "c-1",
      to: "c-2",
      text: "тайно влюблена",
    });
    expect(relations[0].id).toBeTruthy();
    expect(relations[1].to).toBeUndefined();
  });
});

describe("групповая сцена: выбор говорящего", () => {
  it("находит героя по имени в ответе роутера", () => {
    expect(parseRoutingAnswer("[Отвечает: Рин]", cast)?.id).toBe("c-2");
    expect(parseRoutingAnswer("Отвечает: Кай, потому что он рядом", cast)?.id).toBe(
      "c-3"
    );
    expect(
      parseRoutingAnswer("<speaker>Ая</speaker>", cast)?.id
    ).toBe("c-1");
  });

  it("терпим к свободному ответу и к незнакомым именам", () => {
    expect(parseRoutingAnswer("Думаю, ответит Рин.", cast)?.id).toBe("c-2");
    expect(parseRoutingAnswer("[Отвечает: Незнакомец]", cast)).toBeUndefined();
    expect(parseRoutingAnswer("", cast)).toBeUndefined();
  });

  it("упоминание в реплике игрока выбирает того, к кому обратились", () => {
    expect(findMentionedCharacter("Кай, ты слышал?", cast)?.id).toBe("c-3");
    expect(
      findMentionedCharacter("Рин, а ты что скажешь, Кай?", cast)?.id
    ).toBe("c-2");
    expect(findMentionedCharacter("Никого не зову", cast)).toBeUndefined();
    expect(findMentionedCharacter("Ая", cast)).toBeDefined();
  });

  it("передаёт ход по кругу", () => {
    expect(nextSpeaker(cast, "c-1")?.id).toBe("c-2");
    expect(nextSpeaker(cast, "c-3")?.id).toBe("c-1");
    expect(nextSpeaker(cast)?.id).toBe("c-1");
    expect(nextSpeaker(cast, "нет такого")?.id).toBe("c-1");
    expect(nextSpeaker([], "c-1")).toBeUndefined();
  });

  it("промпт роутера перечисляет героев и требует строгий формат", () => {
    const prompt = buildRoutingPrompt({
      present: cast,
      relations: [
        { id: "r-1", from: "c-1", to: "c-2", text: "соперницы" },
        { id: "r-2", from: "c-2", to: undefined, text: "душа компании" },
      ],
      userName: "Странник",
      lastUserText: "Кай, ты слышал этот шум?",
      lastSpeakerId: "c-1",
      directorNotes: "Ночь, гроза",
    });

    expect(prompt).toContain("Ая");
    expect(prompt).toContain("Кай");
    expect(prompt).toContain("Ая → Рин: соперницы");
    expect(prompt).toContain("Рин → группа: душа компании");
    expect(prompt).toContain("Ночь, гроза");
    expect(prompt).toContain("[Отвечает: Имя]");
  });

  it("в промпт роутера попадает не больше шести связей", () => {
    const relations = Array.from({ length: 9 }, (_, index) => ({
      id: `r-${index}`,
      from: "c-1",
      text: `факт ${index}`,
    }));

    const prompt = buildRoutingPrompt({
      present: cast,
      relations,
      userName: "Странник",
      lastUserText: "Привет",
    });

    expect(prompt).toContain("факт 5");
    expect(prompt).not.toContain("факт 6");
  });
});

describe("групповая сцена: генератор группы", () => {
  it("размер группы зажат в диапазон 2–4", () => {
    expect(clampGroupSize(1)).toBe(GROUP_SIZE_MIN);
    expect(clampGroupSize(3)).toBe(3);
    expect(clampGroupSize(99)).toBe(GROUP_SIZE_MAX);
    expect(clampGroupSize(Number.NaN)).toBe(GROUP_SIZE_MIN);
    expect(clampGroupSize(3.4)).toBe(3);
  });

  it("инструкция требует и персонажей, и общий опенинг", () => {
    const instruction = buildGroupInstruction(
      "any",
      ["Современность"],
      "общежитие",
      3
    );

    expect(instruction).toContain("СЦЕНУ из 3 персонажей");
    expect(instruction).toContain("общежитие");
    expect(instruction).toContain('"opening"');
    expect(instruction).toContain('"characters"');
    expect(instruction).toContain("ВАЛИДНОГО JSON");
  });

  it("карточка персонажа получает безопасные значения по умолчанию", () => {
    const draft = normalizeGeneratedCharacter(
      {
        name: "  Мира  ",
        initialStats: { trust: 80 },
        lorebook: [{ content: "боится воды" }, { keys: "строка", content: "" }],
      },
      ["Современность"]
    );

    expect(draft.name).toBe("Мира");
    expect(draft.firstMessage).toBe("*Смотрит на тебя в тишине...*");
    expect(draft.initialStats?.trust).toBe(80);
    expect(draft.initialStats?.affection).toBe(DEFAULT_STATS.affection);
    expect(draft.tags).toEqual(["Современность"]);
    expect(draft.lorebook).toHaveLength(2);
    expect(draft.lorebook?.[0].keys).toEqual(["память"]);
    expect(draft.lorebook?.[0].id).toBeTruthy();
  });

  it("разбор ответа модели терпим к форме", () => {
    const group = parseGeneratedGroup(
      {
        opening: "  *Дождь.* — Ну и вечер.  ",
        characters: [
          { name: "Ая", firstMessage: "— Привет." },
          { name: "Рин" },
          null,
          { name: "Кай" },
          { name: "Лишний" },
          { name: "Ещё лишний" },
        ],
      },
      []
    );

    expect(group.opening).toBe("*Дождь.* — Ну и вечер.");
    expect(group.characters.map((item) => item.name)).toEqual([
      "Ая",
      "Рин",
      "Кай",
      "Лишний",
    ]);
  });

  it("без опенинга сцена открывается репликой первого героя", () => {
    const group = parseGeneratedGroup(
      [{ name: "Ая", firstMessage: "— Я первая." }],
      []
    );

    expect(group.opening).toBe("— Я первая.");
  });
});

describe("групповая сцена: создание ветки", () => {
  it("ветка хранит состав, шкалы участников и их стартовые реплики", async () => {
    const session = await createGroupSession(cast[0], [cast[1], cast[2]]);

    expect(session.isGroup).toBe(true);
    expect(session.characterId).toBe("c-1");
    expect(session.characterIds).toEqual(["c-2", "c-3"]);
    expect(session.currentStats).toEqual(cast[0].initialStats);
    expect(Object.keys(session.participantStats ?? {}).sort()).toEqual([
      "c-2",
      "c-3",
    ]);

    const messages = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");

    expect(messages).toHaveLength(3);
    expect(messages.map((item) => item.characterId)).toEqual([
      "c-1",
      "c-2",
      "c-3",
    ]);
    expect(messages.map((item) => item.characterName)).toEqual([
      "Ая",
      "Рин",
      "Кай",
    ]);
    expect(messages[0].swipes[0]).toContain("Я Ая.");
  });

  it("общий опенинг становится первым сообщением сцены", async () => {
    const session = await createGroupSession(cast[0], [cast[1]], {
      opening: "*Ночь. Все трое в мастерской.*",
    });

    const messages = await db.messages.where("sessionId").equals(session.id).toArray();

    expect(messages).toHaveLength(1);
    expect(messages[0].characterId).toBe("c-1");
    expect(messages[0].swipes[0]).toBe("*Ночь. Все трое в мастерской.*");
  });

  it("лидер не дублируется, если его передали в списке участников", async () => {
    const session = await createGroupSession(cast[0], [cast[0], cast[1], cast[1]]);

    expect(session.characterIds).toEqual(["c-2"]);
    expect(Object.keys(session.participantStats ?? {})).toEqual(["c-2"]);
  });

  it("персонажи сцены лежат в базе и находятся по составу ветки", async () => {
    await db.characters.bulkAdd(cast);
    const session = await createGroupSession(cast[0], [cast[1], cast[2]]);

    const stored = await db.sessions.get(session.id);
    expect(stored?.characterIds).toEqual(["c-2", "c-3"]);

    const participants = await db.characters
      .where("id")
      .anyOf([stored!.characterId, ...(stored?.characterIds ?? [])])
      .toArray();

    expect(participants.map((item) => item.name).sort()).toEqual([
      "Ая",
      "Кай",
      "Рин",
    ]);
  });
});
