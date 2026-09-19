import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/services/promptBuilder";
import { messagesToTurns, type ChatTurn } from "../src/services/apiClient";
import {
  buildAssistantLabeler,
  buildCharacterIndex,
  pendingSpeakers,
  resolveParticipants,
  resolveSpeakerName,
  statsForCharacter,
} from "../src/services/groupScene";
import { DEFAULT_STATS } from "../src/types";
import type {
  Character,
  ChatSession,
  Message,
  RelationshipStats,
  UserProfile,
} from "../src/types";

/**
 * Сквозной контракт группового хода: собираем ровно то, что уходит в модель,
 * для каждого участника по очереди — без React и без сети. Проверяем, что
 * второй участник видит помеченную реплику первого, что свои реплики не
 * подписаны, а шкалы не путаются между персонажами.
 */

const player: UserProfile = {
  name: "Странник",
  avatarUrl: "",
  personaDescription: "гость",
};

const makeCharacter = (id: string, name: string): Character => ({
  id,
  name,
  avatarUrl: "",
  tagline: `${name} на сцене`,
  personality: `${name} держится уверенно.`,
  systemPrompt: "",
  firstMessage: "…",
  initialStats: { ...DEFAULT_STATS },
  lorebook: [],
  createdAt: 1,
});

const aya = makeCharacter("c-1", "Ая");
const mira = makeCharacter("c-2", "Мира");
const yan = makeCharacter("c-3", "Ян");

const session: ChatSession = {
  id: "s-1",
  characterId: aya.id,
  characterIds: [mira.id, yan.id],
  title: "Ветка",
  directorNotes: "",
  currentStats: { ...DEFAULT_STATS, trust: 50 },
  participantStats: { "c-2": { ...DEFAULT_STATS, trust: 20 } },
  createdAt: 1,
  updatedAt: 1,
};

const userMessage: Message = {
  id: "m-1",
  sessionId: "s-1",
  sender: "user",
  swipes: ["— Вы обе чего молчите?"],
  currentSwipeIndex: 0,
  timestamp: 1,
};

/** Модель-заглушка: отвечает от имени того, чей промпт ей передали. */
function fakeModel(
  speaker: Character,
  systemPrompt: string,
  turns: ChatTurn[]
): { parsed: { text: string; stats: RelationshipStats }; turns: ChatTurn[]; prompt: string } {
  const isGroupPrompt = systemPrompt.includes("ГРУППОВАЯ СЦЕНА");
  const othersInPrompt = ["Ая", "Мира", "Ян"].filter(
    (name) => name !== speaker.name && systemPrompt.includes(`- ${name}:`)
  );

  // модель не должна видеть чужого имени в списке присутствующих, только своё
  expect(othersInPrompt).not.toContain(speaker.name);

  const statsBefore = systemPrompt.match(/Доверие: (\d+)\/100/);
  const stats = {
    ...DEFAULT_STATS,
    trust: statsBefore ? Number(statsBefore[1]) : DEFAULT_STATS.trust,
  };

  return {
    parsed: {
      text: isGroupPrompt
        ? `— ${speaker.name} пожимает плечами.`
        : `— ${speaker.name} молчит.`,
      stats,
    },
    turns,
    prompt: systemPrompt,
  };
}

describe("групповой ход: контракт запросов", () => {
  const index = buildCharacterIndex([aya, mira, yan]);

  it("каждый участник получает свой промпт, свои шкалы и подписанный контекст", () => {
    const participants = resolveParticipants(session, aya, index);
    expect(participants.map((item) => item.name)).toEqual(["Ая", "Мира", "Ян"]);

    let context: Message[] = [userMessage];
    const transcript: {
      speaker: string;
      trustInPrompt: number;
      labeledOthers: string[];
      ownUnlabeled: boolean;
    }[] = [];

    for (const speaker of participants) {
      const others = participants.filter((item) => item.id !== speaker.id);
      const speakerStats = statsForCharacter(session, speaker.id, index);

      const prompt = buildSystemPrompt(speaker, session, player, context, false, {
        others,
        currentStats: speakerStats,
      });
      const turns = messagesToTurns(
        context,
        buildAssistantLabeler(speaker.id, aya.id, (message) =>
          resolveSpeakerName(message, aya, index, player.name)
        )
      );

      const result = fakeModel(speaker, prompt, turns);

      transcript.push({
        speaker: speaker.name,
        trustInPrompt: result.parsed.stats.trust,
        labeledOthers: turns
          .filter((turn) => turn.role === "assistant")
          .map((turn) => turn.content.split(":")[0]),
        ownUnlabeled: turns.every(
          (turn) =>
            turn.role !== "assistant" || !turn.content.startsWith(`${speaker.name}:`)
        ),
      });

      context = [
        ...context,
        {
          id: `m-${context.length + 1}`,
          sessionId: session.id,
          sender: "assistant",
          characterId: speaker.id,
          characterName: speaker.name,
          swipes: [result.parsed.text],
          currentSwipeIndex: 0,
          statsSnapshot: result.parsed.stats,
          timestamp: context.length + 1,
        },
      ];
    }

    // 1. Шкалы: у Аи 50 из ветки, у Миры 20 из её записи, у Яна — стартовые
    expect(transcript.map((item) => item.trustInPrompt)).toEqual([50, 20, 50]);

    // 2. Первый говорит в пустом контексте, остальные видят чужие реплики
    expect(transcript[0].labeledOthers).toEqual([]);
    expect(transcript[1].labeledOthers).toEqual(["Ая"]);
    expect(transcript[2].labeledOthers).toEqual(["Ая", "Мира"]);

    // 3. Свои прошлые реплики не подписаны именем
    expect(transcript.every((item) => item.ownUnlabeled)).toBe(true);
  });

  it("если ход оборвался после первого, дожимаются двое", () => {
    const participants = resolveParticipants(session, aya, index);
    const answered: Message[] = [
      userMessage,
      {
        id: "m-2",
        sessionId: "s-1",
        sender: "assistant",
        characterId: aya.id,
        characterName: aya.name,
        swipes: ["— Ая пожимает плечами."],
        currentSwipeIndex: 0,
        timestamp: 2,
      },
    ];

    expect(
      pendingSpeakers(answered, participants, aya.id).map((item) => item.name)
    ).toEqual(["Мира", "Ян"]);

    const retryContext: Message[] = [
      ...answered,
      {
        id: "m-3",
        sessionId: "s-1",
        sender: "assistant",
        characterId: mira.id,
        characterName: mira.name,
        swipes: ["— Мира вздыхает."],
        currentSwipeIndex: 0,
        timestamp: 3,
      },
    ];

    expect(
      pendingSpeakers(retryContext, participants, aya.id).map((item) => item.name)
    ).toEqual(["Ян"]);
  });
});
