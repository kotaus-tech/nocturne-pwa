import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { db, sanitizeCharacter } from "../src/db";
import { DEFAULT_STATS } from "../src/types";

/**
 * Создание персонажа. Регрессия: запись, у которой нет числового createdAt,
 * попадает в базу, но не видна в списке — Dexie пропускает записи без ключа
 * индекса в orderBy("createdAt"). Именно так «созданный персонаж исчезал».
 */

afterEach(async () => {
  await db.characters.clear();
});

describe("персонажи: создание и видимость в списке", () => {
  it("санитайзер всегда проставляет числовой createdAt", () => {
    const fromNothing = sanitizeCharacter({ name: "Новый" });
    const fromBroken = sanitizeCharacter({
      name: "Новый",
      createdAt: Number.NaN,
    } as any);

    expect(Number.isFinite(fromNothing.createdAt)).toBe(true);
    expect(Number.isFinite(fromBroken.createdAt)).toBe(true);
  });

  it("запись без createdAt в базу попадает, но в список не выводится", async () => {
    await db.characters.put({
      id: "c-broken",
      name: "Потерянный",
      avatarUrl: "",
      tagline: "",
      systemPrompt: "",
      firstMessage: "…",
      initialStats: { ...DEFAULT_STATS },
      lorebook: [],
      // createdAt забыли — так запись становится невидимой
    } as any);

    const list = await db.characters.orderBy("createdAt").toArray();
    const direct = await db.characters.get("c-broken");

    expect(list.map((item) => item.id)).not.toContain("c-broken");
    expect(direct?.name).toBe("Потерянный");
  });

  it("персонаж, сохранённый как в редакторе, сразу виден в списке", async () => {
    const draft = sanitizeCharacter({
      id: "c-new",
      name: "Мира",
      firstMessage: "*Задумчиво смотрит в окно.* — Привет.",
      createdAt: 1_700_000_000_000,
    });

    await db.characters.put(draft);

    const list = await db.characters.orderBy("createdAt").toArray();

    expect(list.map((item) => item.name)).toContain("Мира");
  });
});
