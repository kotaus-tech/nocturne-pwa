import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  db,
  sanitizeCharacterIds,
  sanitizeMessage,
  sanitizeParticipantStats,
  sanitizeSession,
} from "../src/db";
import { buildPromptParts } from "../src/services/promptBuilder";
import { messagesToTurns } from "../src/services/apiClient";
import {
  buildAssistantLabeler,
  buildCharacterIndex,
  moveItem,
  pendingSpeakers,
  resolveParticipants,
  resolveSpeaker,
  resolveSpeakerName,
  statsForCharacter,
} from "../src/services/groupScene";
import { deleteCharacterCascade, createSession } from "../src/utils/sessionActions";
import { DEFAULT_STATS } from "../src/types";
import type { Character, ChatSession, Message, UserProfile } from "../src/types";

/** Полный промпт хода для проверок содержимого: префикс + динамический хвост. */
const buildSystemPrompt = (...args: Parameters<typeof buildPromptParts>): string => {
  const parts = buildPromptParts(...args);
  return `${parts.system}\n\n${parts.turnContext}`;
};

/**
 * Групповые сцены: несколько персонажей в одной ветке.
 * Проверяем три вещи: сохранность новых полей (санитайзеры),
 * корректную подпись чужих реплик в контексте и сборку промпта сцены.
 */

const character = (
  id: string,
  name: string,
  personality = "Спокойная и внимательная."
): Character => ({
  id,
  name,
  avatarUrl: "",
  tagline: "",
  personality,
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

const session: ChatSession = {
  id: "s-1",
  characterId: "c-1",
  characterIds: ["c-2", "c-3"],
  title: "Ветка",
  directorNotes: "",
  currentStats: { ...DEFAULT_STATS },
  createdAt: 1,
  updatedAt: 1,
};

const assistantMessage = (
  id: string,
  characterId: string,
  characterName: string,
  text: string
): Message => ({
  id,
  sessionId: "s-1",
  sender: "assistant",
  characterId,
  characterName,
  swipes: [text],
  currentSwipeIndex: 0,
  timestamp: 1,
});

describe("групповая сцена: санитайзеры", () => {
  it("список участников чистится от пустых, дублей и основного персонажа", () => {
    const ids = sanitizeCharacterIds(
      ["c-2", " c-2 ", "", null, "c-3", "c-1", 42],
      "c-1"
    );

    expect(ids).toEqual(["c-2", "c-3"]);
  });

  it("не-массив превращается в пустой список", () => {
    expect(sanitizeCharacterIds(undefined, "c-1")).toEqual([]);
    expect(sanitizeCharacterIds("c-2" as unknown, "c-1")).toEqual([]);
  });

  it("шкалы участников нормализуются и обрезаются по границам", () => {
    const stats = sanitizeParticipantStats({
      "c-2": { trust: 120, affection: -5, statusTitle: "Друзья" },
      "": { trust: 10 },
    });

    expect(Object.keys(stats)).toEqual(["c-2"]);
    expect(stats["c-2"].trust).toBe(100);
    expect(stats["c-2"].affection).toBe(0);
    expect(stats["c-2"].statusTitle).toBe("Друзья");
  });

  it("сессия сохраняет состав сцены и шкалы участников", () => {
    const sanitized = sanitizeSession({
      ...session,
      characterIds: ["c-2", "c-2", "c-1", "c-3"],
      participantStats: { "c-2": { ...DEFAULT_STATS, trust: 70 } },
    });

    expect(sanitized.characterIds).toEqual(["c-2", "c-3"]);
    expect(sanitized.participantStats?.["c-2"].trust).toBe(70);
  });

  it("сообщение сохраняет автора реплики и снимок имени", () => {
    const kept = sanitizeMessage(
      assistantMessage("m-1", "c-2", "Мира", "— Привет.")
    );
    const main = sanitizeMessage({
      id: "m-2",
      sessionId: "s-1",
      sender: "assistant",
      swipes: ["— Ага."],
    });

    expect(kept.characterId).toBe("c-2");
    expect(kept.characterName).toBe("Мира");
    expect(main.characterId).toBeUndefined();
    expect(main.characterName).toBeUndefined();
  });
});

describe("групповая сцена: контекст запроса", () => {
  const messages: Message[] = [
    {
      id: "m-1",
      sessionId: "s-1",
      sender: "user",
      swipes: ["— Вы чего тут?"],
      currentSwipeIndex: 0,
      timestamp: 1,
    },
    assistantMessage("m-2", "c-2", "Мира", "— Ничего."),
    assistantMessage("m-3", "c-3", "Ян", "— Стоим."),
  ];

  it("без подписи turns остаются прежними", () => {
    const turns = messagesToTurns(messages);

    expect(turns).toEqual([
      { role: "user", content: "— Вы чего тут?" },
      { role: "assistant", content: "— Ничего." },
      { role: "assistant", content: "— Стоим." },
    ]);
  });

  it("чужие реплики подписываются именем, свои — нет", () => {
    const turns = messagesToTurns(messages, (message) =>
      message.characterId === "c-3" ? message.characterName : undefined
    );

    expect(turns[1].content).toBe("— Ничего.");
    expect(turns[2].content).toBe("Ян: — Стоим.");
  });

  it("пустое имя не превращается в подпись", () => {
    const turns = messagesToTurns(messages, () => "   ");

    expect(turns[2].content).toBe("— Стоим.");
  });

  it("промпт участника описывает сцену и запрещает говорить за других", () => {
    const prompt = buildSystemPrompt(
      character("c-1", "Ая"),
      session,
      player,
      messages,
      false,
      { others: [character("c-2", "Мира"), character("c-3", "Ян")] }
    );

    expect(prompt).toContain("ГРУППОВАЯ СЦЕНА");
    expect(prompt).toContain("Ты отыгрываешь ТОЛЬКО Ая");
    expect(prompt).toContain("- Мира: Спокойная и внимательная.");
    expect(prompt).toContain("- Ян: Спокойная и внимательная.");
  });

  it("без сцены блок не добавляется — одиночный промпт не меняется", () => {
    const prompt = buildSystemPrompt(
      character("c-1", "Ая"),
      session,
      player,
      messages,
      false
    );

    expect(prompt).not.toContain("ГРУППОВАЯ СЦЕНА");
    expect(prompt).toContain("Ты отыгрываешь персонажа по имени Ая.");
  });

  it("свой же персонаж не дублируется в списке участников", () => {
    const prompt = buildSystemPrompt(
      character("c-1", "Ая"),
      session,
      player,
      messages,
      false,
      { others: [character("c-1", "Ая"), character("c-2", "Мира")] }
    );

    expect(prompt).toContain("- Мира:");
    expect(prompt).not.toContain("- Ая:");
  });
});

describe("групповая сцена: жизненный цикл в базе", () => {
  afterEach(async () => {
    await db.characters.clear();
    await db.sessions.clear();
    await db.messages.clear();
  });

  it("ветка хранит участников, а удаление персонажа убирает его из сцены", async () => {
    await db.characters.bulkPut([
      character("c-1", "Ая"),
      character("c-2", "Мира"),
      character("c-3", "Ян"),
    ]);

    const created = await createSession(character("c-1", "Ая"));
    await db.sessions.update(created.id, {
      characterIds: ["c-2", "c-3"],
      participantStats: {
        "c-2": { ...DEFAULT_STATS, trust: 80 },
        "c-3": { ...DEFAULT_STATS, trust: 20 },
      },
    });

    await deleteCharacterCascade("c-2");

    const updated = await db.sessions.get(created.id);

    expect(updated?.characterIds).toEqual(["c-3"]);
    expect(updated?.participantStats?.["c-2"]).toBeUndefined();
    expect(updated?.participantStats?.["c-3"].trust).toBe(20);
    expect(await db.characters.get("c-2")).toBeUndefined();
  });
});

describe("групповая сцена: состав и говорящие", () => {
  const main = character("c-1", "Ая");
  const mira = character("c-2", "Мира");
  const yan = character("c-3", "Ян");
  const index = buildCharacterIndex([main, mira, yan]);

  it("участники идут по порядку ветки, основной — первым", () => {
    const list = resolveParticipants(
      { characterId: "c-1", characterIds: ["c-3", "c-2"] },
      main,
      index
    );

    expect(list.map((item) => item.name)).toEqual(["Ая", "Ян", "Мира"]);
  });

  it("удалённый или продублированный участник в состав не попадает", () => {
    const list = resolveParticipants(
      { characterId: "c-1", characterIds: ["c-9", "c-1", "c-2", "c-2"] },
      main,
      index
    );

    expect(list.map((item) => item.id)).toEqual(["c-1", "c-2"]);
  });

  it("без основного персонажа сцена пустая", () => {
    expect(
      resolveParticipants({ characterId: "c-1", characterIds: ["c-2"] }, undefined, index)
    ).toEqual([]);
  });

  it("автор реплики определяется по characterId, иначе — основной", () => {
    const fromMira = resolveSpeaker(
      assistantMessage("m-1", "c-2", "Мира", "— Тихо."),
      main,
      index
    );
    const unknown = resolveSpeaker(
      assistantMessage("m-2", "c-77", "Кто-то", "— Эй."),
      main,
      index
    );
    const legacy = resolveSpeaker(
      {
        id: "m-3",
        sessionId: "s-1",
        sender: "assistant",
        swipes: ["— …"],
        currentSwipeIndex: 0,
        timestamp: 1,
      },
      main,
      index
    );

    expect(fromMira.name).toBe("Мира");
    expect(legacy.name).toBe("Ая");
    // удалённый участник остаётся автором по снимку имени, а не «превращается» в основного
    expect(unknown.name).toBe("Кто-то");
    expect(unknown.id).toBe("c-77");
    expect(unknown.avatarUrl).toBe("");
  });

  it("имя автора берётся из базы, из снимка или из основного персонажа", () => {
    const player = "Странник";

    expect(
      resolveSpeakerName(
        assistantMessage("m-1", "c-2", "Мира", "— Тихо."),
        main,
        index,
        player
      )
    ).toBe("Мира");

    // персонажа удалили — работает снимок имени
    expect(
      resolveSpeakerName(
        assistantMessage("m-2", "c-77", "Гость", "— Эй."),
        main,
        index,
        player
      )
    ).toBe("Гость");

    expect(
      resolveSpeakerName(
        {
          id: "m-3",
          sessionId: "s-1",
          sender: "user",
          swipes: ["— Привет"],
          currentSwipeIndex: 0,
          timestamp: 1,
        },
        main,
        index,
        player
      )
    ).toBe(player);
  });

  it("шкалы участника берутся из ветки, а без них — из карточки персонажа", () => {
    const withStats = {
      characterId: "c-1",
      currentStats: { ...DEFAULT_STATS, trust: 55 },
      participantStats: { "c-2": { ...DEFAULT_STATS, trust: 90 } },
    };

    expect(statsForCharacter(withStats, "c-1", index).trust).toBe(55);
    expect(statsForCharacter(withStats, "c-2", index).trust).toBe(90);
    expect(statsForCharacter(withStats, "c-3", index).trust).toBe(
      DEFAULT_STATS.trust
    );
  });

  it("подпись ставится только на чужие реплики", () => {
    const label = buildAssistantLabeler("c-1", "c-1", (message) =>
      message.characterName || ""
    );

    expect(label(assistantMessage("m-1", "c-1", "Ая", "— Раз."))).toBeUndefined();
    expect(label(assistantMessage("m-2", "c-2", "Мира", "— Два."))).toBe("Мира");
    // старое сообщение без characterId принадлежит основному персонажу
    expect(
      label({
        id: "m-3",
        sessionId: "s-1",
        sender: "assistant",
        swipes: ["— Три."],
        currentSwipeIndex: 0,
        timestamp: 1,
      })
    ).toBeUndefined();
  });

  it("прерванный ход дожимает только тех, кто не ответил", () => {
    const dialog: Message[] = [
      { id: "m-1", sessionId: "s-1", sender: "user", swipes: ["— Привет"], currentSwipeIndex: 0, timestamp: 1 },
      assistantMessage("m-2", "c-1", "Ая", "— Ага."),
    ];

    const pending = pendingSpeakers(dialog, [main, mira, yan], "c-1");

    expect(pending.map((item) => item.id)).toEqual(["c-2", "c-3"]);
  });

  it("если ответили все — дожимать некого", () => {
    const dialog: Message[] = [
      { id: "m-1", sessionId: "s-1", sender: "user", swipes: ["— Привет"], currentSwipeIndex: 0, timestamp: 1 },
      assistantMessage("m-2", "c-1", "Ая", "— Ага."),
      assistantMessage("m-3", "c-2", "Мира", "— Ох."),
      assistantMessage("m-4", "c-3", "Ян", "— Ну."),
    ];

    expect(pendingSpeakers(dialog, [main, mira, yan], "c-1")).toEqual([]);
  });
});

describe("групповая сцена: ход по очереди", () => {
  const main = character("c-1", "Ая");
  const mira = character("c-2", "Мира");
  const yan = character("c-3", "Ян");
  const index = buildCharacterIndex([main, mira, yan]);
  const roster = [main, mira, yan];

  it("второй участник видит помеченную реплику первого", () => {
    const history: Message[] = [
      { id: "m-1", sessionId: "s-1", sender: "user", swipes: ["— Привет всем."], currentSwipeIndex: 0, timestamp: 1 },
      assistantMessage("m-2", "c-1", "Ая", "— Привет."),
    ];

    const label = buildAssistantLabeler("c-2", main.id, (message) =>
      resolveSpeakerName(message, main, index, "Странник")
    );
    const turns = messagesToTurns(history, label);
    const prompt = buildSystemPrompt(mira, session, player, history, false, {
      others: roster.filter((item) => item.id !== mira.id),
    });

    // своя реплика ещё не написана, чужая — подписана
    expect(turns).toEqual([
      { role: "user", content: "— Привет всем." },
      { role: "assistant", content: "Ая: — Привет." },
    ]);
    expect(prompt).toContain("Ты отыгрываешь ТОЛЬКО Мира");
    expect(prompt).toContain("- Ая:");
    expect(prompt).toContain("- Ян:");
    expect(prompt).not.toContain("- Мира:");
  });

  it("после ответа первого второй получает его реплику в контексте запроса", () => {
    const reply = assistantMessage("m-2", "c-1", "Ая", "— Привет.");
    const context: Message[] = [
      { id: "m-1", sessionId: "s-1", sender: "user", swipes: ["— Привет всем."], currentSwipeIndex: 0, timestamp: 1 },
      reply,
    ];

    const turns = messagesToTurns(
      context,
      buildAssistantLabeler("c-2", main.id, (message) =>
        resolveSpeakerName(message, main, index, "Странник")
      )
    );

    expect(turns[turns.length - 1]).toEqual({
      role: "assistant",
      content: "Ая: — Привет.",
    });
  });
});

describe("групповая сцена: порядок участников", () => {
  it("стрелка меняет соседей местами", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("за границами списка ничего не двигается", () => {
    const list = ["a", "b", "c"];

    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 2, 1)).toBe(list);
    expect(moveItem(list, 9, 1)).toBe(list);
  });

  it("перетаскивание сохраняет весь состав", () => {
    const moved = moveItem(["c-2", "c-3", "c-4"], 0, 1);

    expect(moved).toEqual(["c-3", "c-2", "c-4"]);
    expect([...moved].sort()).toEqual(["c-2", "c-3", "c-4"]);
  });
});
