import { describe, expect, it } from "vitest";
import { DEFAULT_STATS } from "../src/types";
import type { Character, ChatSession, Message, ParticipantMemory } from "../src/types";
import {
  buildPersonalTranscriptSince,
  countRelevantMessagesSince,
  emptyParticipantMemory,
  intentionSurvivesShift,
  isRemoteThreadMessage,
  messageVisibleToCharacter,
  notesSignature,
  pendingSpeakers,
  resolveMemoryPointer,
  sanitizeIntention,
  sanitizePrivateNotes,
} from "../src/services/groupScene";
import {
  isExtractionDue,
  parsePersonalExtraction,
  buildPersonalExtractionPrompt,
} from "../src/services/participantMemory";
import {
  buildOffscreenPatch,
  isOffscreenTickDue,
  parseOffscreenTickResult,
  resolveTickInterval,
} from "../src/services/offscreenTick";
import { reduceScenePatches } from "../src/services/sessionPatch";
import { parseMetaBlock } from "../src/services/metaParser";
import { splitLiveSceneReactions } from "../src/services/liveSceneReactions";

const makeCharacter = (id: string, name: string): Character =>
  ({
    id,
    name,
    description: `${name} description`,
    personality: `${name} personality`,
    scenario: "",
    systemPrompt: "",
    firstMessage: "Привет",
    initialStats: { ...DEFAULT_STATS },
    createdAt: 1,
  }) as Character;

const makeMessage = (
  id: string,
  sender: Message["sender"],
  text: string,
  extra: Partial<Message> = {}
): Message => ({
  id,
  sessionId: "s-1",
  sender,
  swipes: [text],
  currentSwipeIndex: 0,
  timestamp: Number(id.replace(/\D/g, "")) || 1,
  ...extra,
});

const makeSession = (
  memory: Record<string, ParticipantMemory> = {}
): ChatSession =>
  ({
    id: "s-1",
    characterId: "c-1",
    isGroup: true,
    characterIds: ["c-2"],
    activeCharacterIds: ["c-1", "c-2"],
    absentReasons: {},
    relations: [],
    participantStats: {},
    participantMemory: memory,
    title: "Группа",
    summary: "",
    directorNotes: "",
    currentStats: { ...DEFAULT_STATS },
    createdAt: 1,
    updatedAt: 1,
  }) as ChatSession;

describe("симметричная память участников", () => {
  it("клампит заметки и намерение по лимитам", () => {
    const notes = sanitizePrivateNotes([
      "  первая мысль  ",
      "первая мысль",
      "x".repeat(500),
      "третья",
      "четвёртая",
      "пятая",
      "шестая",
    ]);

    expect(notes).toHaveLength(5);
    expect(notes[0]).toBe("первая мысль");
    expect(notes[1]).toHaveLength(300);
    expect(
      sanitizeIntention({
        text: "x".repeat(300),
        scope: "persistent",
        createdAtMessageId: "m-4",
      })
    ).toEqual({
      text: "x".repeat(200),
      scope: "persistent",
      createdAtMessageId: "m-4",
    });
  });

  it("считает только релевантные сообщения и игнорирует live-scene echo", () => {
    const cast = [makeCharacter("c-1", "Ая"), makeCharacter("c-2", "Рин")];
    const messages = [
      makeMessage("m-1", "assistant", "обычная реплика Аи", { characterId: "c-1" }),
      makeMessage("m-2", "assistant", "— Рин: эхо", {
        characterId: "c-2",
        isLiveSceneEcho: true,
      }),
      makeMessage("m-3", "user", "Рин, ты здесь?", {
        targetCharacterId: "c-2",
      }),
      makeMessage("m-4", "assistant", "Ая говорит о Рин", {
        characterId: "c-1",
        presentCharacterIds: ["c-1", "c-2"],
      }),
    ];

    expect(countRelevantMessagesSince(messages, "c-2", "m-1", cast)).toBe(2);
  });

  it("грязный флаг не запускает экстракцию до порога", () => {
    const session = makeSession({ c: emptyParticipantMemory("c") });
    const cast = [makeCharacter("c", "Ая")];
    const messages = [
      makeMessage("m-1", "assistant", "раз", { characterId: "c" }),
      makeMessage("m-2", "assistant", "два", { characterId: "c" }),
    ];

    expect(isExtractionDue(messages, session, "c", cast).due).toBe(false);
    expect(
      isExtractionDue(
        [...messages, makeMessage("m-3", "assistant", "три", { characterId: "c" })],
        session,
        "c",
        cast
      ).due
    ).toBe(true);
  });

  it("не даёт отсутствующему персонажу знание из live-scene echo", () => {
    const prompt = buildPersonalExtractionPrompt({
      characterName: "Рин",
      fragment: "Ая: — Рин: эхо",
      privateNotes: [],
    });
    expect(prompt).toContain("реально мог видеть или слышать");

    const parsed = parsePersonalExtraction(
      '{"privateNotes":["[От Ая]: она призналась в секрете"],"intention":null}'
    );
    expect(parsed?.privateNotes[0]).toContain("[От Ая]");
  });
});

describe("offscreen tick", () => {
  it("ограничивает пользовательский интервал границами 4–20", () => {
    expect(resolveTickInterval({ offscreenTickInterval: undefined })).toBe(6);
    expect(resolveTickInterval({ offscreenTickInterval: 1 })).toBe(4);
    expect(resolveTickInterval({ offscreenTickInterval: 12.6 })).toBe(13);
    expect(resolveTickInterval({ offscreenTickInterval: 99 })).toBe(20);
    expect(resolveTickInterval({ offscreenTickInterval: Number.NaN })).toBe(6);
  });

  it("становится eligible по интервалу или скачку времени, но не для present", () => {
    const absent = emptyParticipantMemory("c-2");
    const messages = Array.from({ length: 6 }, (_, index) =>
      makeMessage(`m-${index + 1}`, "assistant", "ход", { characterId: "c-1" })
    );
    const session = {
      ...makeSession({ "c-2": absent }),
      activeCharacterIds: ["c-1"],
      offscreenLifeEnabled: true,
      offscreenTickInterval: 6,
    };

    expect(isOffscreenTickDue({ messages, session, characterId: "c-2" }).due).toBe(true);
    expect(
      isOffscreenTickDue({
        messages: messages.slice(0, 2),
        session,
        characterId: "c-2",
        sceneShift: { time: "hours", locationChanged: false },
      }).due
    ).toBe(true);
    expect(
      isOffscreenTickDue({
        messages,
        session: { ...session, activeCharacterIds: ["c-1", "c-2"] },
        characterId: "c-2",
      }).due
    ).toBe(false);
  });

  it("по умолчанию ничего не просачивается при significant=false", () => {
    expect(
      parseOffscreenTickResult(
        '{"significant":false,"updatedPrivateNotes":["не надо"],"contactAction":{"kind":"sms","text":"нет"}}'
      )
    ).toEqual({
      significant: false,
      updatedPrivateNotes: null,
      intention: null,
      worldConsequence: null,
      contactAction: null,
    });
  });

  it("жёстко понижает слишком частое significant-событие", () => {
    const memory = {
      ...emptyParticipantMemory("c-2"),
      ticksSinceLastSignificant: 0,
      significantSinceLastContact: 0,
    };
    const session = {
      ...makeSession({ "c-2": memory }),
      activeCharacterIds: ["c-1"],
      offscreenTickInterval: 6,
    };
    const patch = buildOffscreenPatch({
      session,
      character: makeCharacter("c-2", "Рин"),
      memory,
      result: {
        significant: true,
        updatedPrivateNotes: ["слишком рано"],
        intention: null,
        worldConsequence: null,
        contactAction: null,
      },
      turnsAbsent: 6,
      lastMessageId: "m-6",
      summary: "",
    });

    expect(patch.participantMemoryPatch?.["c-2"]?.privateNotes).toBeUndefined();
    expect(patch.participantMemoryPatch?.["c-2"]?.ticksSinceLastSignificant).toBe(1);
  });
});

describe("патчи и границы состояния", () => {
  it("применяет sceneShift, presence, настройки и связи одним редьюсером", () => {
    const first = emptyParticipantMemory("c-1");
    first.intention = {
      text: "остаться здесь",
      scope: "location",
      createdAtMessageId: "m-1",
    };
    const session = makeSession({ "c-1": first });
    const participants = [makeCharacter("c-1", "Ая"), makeCharacter("c-2", "Рин")];

    const result = reduceScenePatches(
      session,
      [
        {
          presencePatch: {
            activeCharacterIds: ["c-1"],
            absentReasons: { "c-2": "ушёл за кофе" },
          },
          relationsPatch: [{ from: "Ая", to: "Рин", text: "насторожилась" }],
          settingsPatch: { offscreenLifeEnabled: false, offscreenTickInterval: 18 },
          sceneShiftPatch: { time: "hours", locationChanged: true },
          sourceKind: "user_turn",
          sourceSnapshotAt: 1,
        },
      ],
      { participants, lastMessageId: "m-2" }
    );

    expect(result.update.activeCharacterIds).toEqual(["c-1"]);
    expect(result.update.absentReasons?.["c-2"]).toBe("ушёл за кофе");
    expect(result.update.relations).toHaveLength(1);
    expect(result.update.offscreenLifeEnabled).toBe(false);
    expect(result.update.offscreenTickInterval).toBe(18);
    expect(result.update.participantMemory?.["c-1"]?.intention).toBeNull();
    expect(result.update.participantMemory?.["c-2"]?.absentSinceMessageId).toBe("m-2");
  });

  it("устаревший offscreen-патч сохраняет заметки, но не возвращает намерение", () => {
    const session = makeSession({ "c-2": emptyParticipantMemory("c-2") });
    session.activeCharacterIds = ["c-1", "c-2"];
    const result = reduceScenePatches(
      session,
      [
        {
          participantMemoryPatch: {
            "c-2": {
              privateNotes: ["пережитый опыт"],
              intention: {
                text: "план из прошлого кадра",
                scope: "persistent",
                createdAtMessageId: "m-1",
                origin: "offscreen",
              },
            },
          },
          baseNotesSignature: notesSignature([]),
          offscreenSubjectId: "c-2",
          sourceKind: "offscreen_tick",
          sourceSnapshotAt: 1,
        },
      ],
      { participants: [makeCharacter("c-1", "Ая"), makeCharacter("c-2", "Рин")] }
    );

    expect(result.update.participantMemory?.["c-2"]?.privateNotes).toEqual([
      "пережитый опыт",
    ]);
    expect(result.update.participantMemory?.["c-2"]?.intention).toBeNull();
  });

  it("инвалидирует намерение только по его скоупу", () => {
    expect(
      intentionSurvivesShift(
        { text: "план", scope: "persistent", createdAtMessageId: "m" },
        { time: "day", locationChanged: true }
      )
    ).toBe(true);
    expect(
      intentionSurvivesShift(
        { text: "план", scope: "time", createdAtMessageId: "m" },
        { time: "day", locationChanged: false }
      )
    ).toBe(false);
  });
});

describe("границы личного контекста и rewind safety", () => {
  it("строит личную выборку только из того, что персонаж реально видел", () => {
    const messages = [
      makeMessage("m-1", "assistant", "Ая говорит при Рин", {
        characterId: "c-1",
        presentCharacterIds: ["c-1", "c-2"],
      }),
      makeMessage("m-2", "assistant", "Ая говорит без Рин", {
        characterId: "c-1",
        presentCharacterIds: ["c-1"],
      }),
      makeMessage("m-3", "user", "Рин, ответь мне", {
        targetCharacterId: "c-2",
      }),
      makeMessage("m-4", "assistant", "Рин отвечает", {
        characterId: "c-2",
        presentCharacterIds: ["c-1"],
      }),
    ];

    const transcript = buildPersonalTranscriptSince(
      messages,
      "c-2",
      null,
      (message) => message.characterName ?? message.characterId ?? message.sender
    );

    expect(transcript).toContain("Ая говорит при Рин");
    expect(transcript).not.toContain("Ая говорит без Рин");
    expect(transcript).toContain("Рин, ответь мне");
    expect(transcript).toContain("Рин отвечает");
  });

  it("после перемотки заменяет устаревший указатель безопасным fallback", () => {
    const messages = [
      makeMessage("m-1", "assistant", "первый", { characterId: "c-1" }),
      makeMessage("m-2", "assistant", "последний", { characterId: "c-1" }),
    ];

    expect(
      resolveMemoryPointer(messages, "deleted-message", (list) =>
        list[list.length - 1]?.id ?? null
      )
    ).toBe("m-2");
    expect(
      resolveMemoryPointer(messages, "m-1", (list) => list[1]?.id ?? null)
    ).toBe("m-1");
  });

  it("не считает live-scene echo и remote-контакт полноценными ответами", () => {
    const participants = [makeCharacter("c-1", "Ая"), makeCharacter("c-2", "Рин")];
    const messages = [
      makeMessage("m-1", "user", "Ответьте обе"),
      makeMessage("m-2", "assistant", "Ая отвечает", { characterId: "c-1" }),
      makeMessage("m-3", "assistant", "эхо Рин", {
        characterId: "c-2",
        isLiveSceneEcho: true,
      }),
      makeMessage("m-4", "assistant", "сообщение Рин из-за кадра", {
        characterId: "c-2",
        remoteKind: "sms",
      }),
    ];

    expect(pendingSpeakers(messages, participants, "c-1").map((item) => item.id)).toEqual([
      "c-2",
    ]);
  });

  it("находит старый user remote-thread без remoteKind по target и presence", () => {
    const participants = [makeCharacter("c-1", "Ая"), makeCharacter("c-2", "Рин")];
    const oldRemoteUser = makeMessage("m-1", "user", "Рин, ответь", {
      targetCharacterId: "c-2",
      presentCharacterIds: ["c-1"],
    });

    expect(isRemoteThreadMessage(oldRemoteUser, participants, [participants[0]])).toBe(true);
    // Snapshot сохраняет приватность даже после возвращения адресата в сцену.
    expect(isRemoteThreadMessage(oldRemoteUser, participants, participants)).toBe(true);
    expect(
      isRemoteThreadMessage(
        { ...oldRemoteUser, presentCharacterIds: undefined },
        participants,
        participants
      )
    ).toBe(false);
    expect(messageVisibleToCharacter(oldRemoteUser, "c-1")).toBe(false);
    expect(messageVisibleToCharacter(oldRemoteUser, "c-2")).toBe(true);
    expect(
      isRemoteThreadMessage(
        {
          id: "old-remote-reply",
          sessionId: "s-1",
          sender: "assistant",
          characterId: "c-2",
          swipes: ["Я получила сообщение."],
          currentSwipeIndex: 0,
          presentCharacterIds: [],
          timestamp: 3,
        },
        participants,
        participants
      )
    ).toBe(true);
  });
});

describe("мета-протокол и live scene", () => {
  it("разбирает sceneShift и intention из облачного JSON и локальных тегов", () => {
    const cloud = parseMetaBlock(
      'Реплика\n```meta\n{"sceneShift":{"time":"hours","locationChanged":true},"intention":{"text":"поговорить позже","scope":"persistent"}}\n```'
    );
    expect(cloud.sceneShift).toEqual({ time: "hours", locationChanged: true });
    expect(cloud.intention?.scope).toBe("persistent");

    const local = parseMetaBlock(
      '<sceneShift time="day" location="true" /><intention scope="scene">вернуться к разговору</intention><resolvedIntention/>Реплика'
    );
    expect(local.sceneShift).toEqual({ time: "day", locationChanged: true });
    expect(local.intention?.text).toBe("вернуться к разговору");
    expect(local.resolvedIntention).toBe(true);
  });

  it("разделяет live-scene echo, не теряя основной текст", () => {
    const result = splitLiveSceneReactions(
      "— **Ая:** Основная реплика.\n— **Рин:** Ну да.\n— **Кай:** хмыкает",
      [makeCharacter("c-2", "Рин"), makeCharacter("c-3", "Кай")],
      "c-1"
    );
    expect(result.mainText).toContain("Основная реплика");
    expect(result.reactions.map((item) => item.character?.id)).toEqual(["c-2", "c-3"]);
  });
});
