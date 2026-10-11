import { describe, expect, it } from "vitest";
import {
  characterView,
  narratorView,
  insertSecretMarker,
  journalEntriesFromMessage,
  resolveRevealedAliases,
  removeJournalEntries,
  removeEntriesForMessage,
  pruneOrphanEntries,
  publishedTextOf,
  cleanNarration,
} from "../src/services/secretChannel";
import type { Message } from "../src/types";

function msg(partial: Partial<Message> & { id: string; text: string }): Message {
  const { text, ...rest } = partial;
  return {
    sessionId: "s1",
    sender: "user",
    swipes: [text],
    currentSwipeIndex: 0,
    timestamp: 1,
    ...rest,
  } as Message;
}

describe("characterView", () => {
  it("оставляет персонажам только открытую часть", () => {
    const view = characterView([
      msg({ id: "a", text: "Я киваю. [[тайно: кладу письмо в карман]]" }),
    ]);
    expect(view).toHaveLength(1);
    expect(view[0].swipes[0]).toBe("Я киваю.");
    expect(JSON.stringify(view)).not.toContain("письмо");
  });

  it("убирает сообщения, которые целиком тайные; OOC остаётся для персонажей", () => {
    const view = characterView([
      msg({ id: "a", text: "Тайная записка", channel: "secret" }),
      msg({ id: "b", text: "[OOC: а что там?]" }),
      msg({ id: "c", text: "[[тайно: только секрет]]" }),
      msg({ id: "d", text: "Открытая реплика" }),
    ]);
    expect(view.map((m) => m.id)).toEqual(["b", "d"]);
  });

  it("не отдаёт секреты ни в каком виде", () => {
    const view = characterView([
      msg({ id: "a", text: "Привет [[тайно: у меня нож]] всем" }),
      msg({ id: "b", text: "Ответ", sender: "assistant" }),
    ]);
    expect(JSON.stringify(view)).not.toContain("нож");
  });
});

describe("narratorView", () => {
  it("видит тайное и помечает его", () => {
    const view = narratorView([
      msg({ id: "a", text: "Открыто [[тайно: нож]]" }),
      msg({ id: "b", text: "Ход рассказчика", channel: "secret" }),
    ]);
    expect(view[0].swipes[0]).toBe("Открыто [тайно: нож]");
    expect(view[1].swipes[0]).toBe("[тайно: Ход рассказчика]");
  });
});

describe("журнал", () => {
  it("создаёт записи из маркеров и из тайного хода рассказчика", () => {
    const fromMarker = journalEntriesFromMessage(
      msg({ id: "a", text: "Кивок [[тайно: нож в рукаве]] и [[тайно: ключ]]" })
    );
    expect(fromMarker.map((e) => e.text)).toEqual(["нож в рукаве", "ключ"]);
    expect(fromMarker.every((e) => e.sourceMessageId === "a")).toBe(true);

    const fromNarrator = journalEntriesFromMessage(
      msg({ id: "b", text: "Я нашёл письмо", channel: "secret" })
    );
    expect(fromNarrator).toHaveLength(1);
    expect(journalEntriesFromMessage(msg({ id: "c", text: "Обычный текст" }))).toEqual([]);
  });

  it("раскрытие по псевдонимам T1..Tn удаляет нужные записи", () => {
    const journal = [
      { id: "x", text: "один", createdAt: 1 },
      { id: "y", text: "два", createdAt: 2 },
    ];
    const ids = resolveRevealedAliases(journal, ["t2", "T9"]);
    expect(ids).toEqual(["y"]);
    expect(removeJournalEntries(journal, ids).map((e) => e.id)).toEqual(["x"]);
  });

  it("удаляет записи при публикации и при откате", () => {
    const journal = [
      { id: "x", text: "один", sourceMessageId: "m1", createdAt: 1 },
      { id: "y", text: "два", sourceMessageId: "m2", createdAt: 2 },
      { id: "z", text: "ручная", createdAt: 3 },
    ];
    expect(removeEntriesForMessage(journal, "m1").map((e) => e.id)).toEqual(["y", "z"]);
    expect(pruneOrphanEntries(journal, new Set(["m1"])).map((e) => e.id)).toEqual(["x", "z"]);
  });
});

describe("ввод и текст", () => {
  it("вставляет маркер с курсором внутри", () => {
    const { value, caret } = insertSecretMarker("Привет", 6, 6);
    expect(value).toBe("Привет[[тайно: ]]");
    expect(value.slice(0, caret)).toBe("Привет[[тайно: ");
  });

  it("публикация убирает маркеры и оставляет текст", () => {
    expect(publishedTextOf("Я киваю. [[тайно: нож]]")).toBe("Я киваю. нож");
  });

  it("чистит ответ рассказчика", () => {
    expect(cleanNarration("<thought>мысли</thought>Текст хода")).toBe("Текст хода");
  });
});
