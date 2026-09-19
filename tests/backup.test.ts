import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPersona,
  db,
  ensurePersonas,
  exportBackup,
  getPersonaState,
  importBackup,
  sanitizeCharacter,
  sanitizeSession,
  setActivePersona,
  setSetting,
} from "../src/db";
import { DEFAULT_STATS } from "../src/types";
import type { Character, ChatSession } from "../src/types";

/**
 * Сохранность данных: новые поля персон должны переживать санитайзеры и
 * резервную копию, иначе при импорте настройки «кем играете» потеряются.
 */

const character: Character = {
  id: "char-1",
  name: "Ая",
  defaultPersonaId: "persona-2",
  avatarUrl: "",
  tagline: "Тихая",
  systemPrompt: "",
  firstMessage: "Привет.",
  initialStats: { ...DEFAULT_STATS },
  lorebook: [],
  createdAt: 1,
};

const session: ChatSession = {
  id: "session-1",
  characterId: "char-1",
  personaId: "persona-2",
  title: "Ветка",
  directorNotes: "",
  currentStats: { ...DEFAULT_STATS },
  createdAt: 1,
  updatedAt: 1,
};

afterEach(async () => {
  await db.characters.clear();
  await db.sessions.clear();
  await db.messages.clear();
  await db.kv.clear();
});

describe("санитайзеры", () => {
  it("сохраняют персону персонажа и ветки", () => {
    expect(sanitizeCharacter(character).defaultPersonaId).toBe("persona-2");
    expect(sanitizeSession(session).personaId).toBe("persona-2");
  });

  it("не выдумывают персону, если её не было", () => {
    const { defaultPersonaId, ...withoutPersona } = character;
    void defaultPersonaId;

    expect(sanitizeCharacter(withoutPersona).defaultPersonaId).toBeUndefined();
    expect(sanitizeSession({ ...session, personaId: undefined }).personaId).toBeUndefined();
  });
});

describe("резервная копия", () => {
  it("переносит персон и привязки между базами", async () => {
    await setSetting("userProfile", {
      name: "Странник",
      avatarUrl: "",
      personaDescription: "Гость",
    });
    await ensurePersonas();

    const second = await createPersona({ name: "Второй", personaDescription: "Тест" });
    await setActivePersona(second.id);

    await db.characters.add(character);
    await db.sessions.add(session);

    const bundle = await exportBackup();
    expect(bundle.kv.some((record) => record.key === "personas")).toBe(true);
    expect(bundle.characters[0].defaultPersonaId).toBe("persona-2");
    expect(bundle.sessions[0].personaId).toBe("persona-2");

    // Имитируем переустановку: чистим базу и восстанавливаем из бэкапа
    await db.characters.clear();
    await db.sessions.clear();
    await db.kv.clear();

    await importBackup(JSON.parse(JSON.stringify(bundle)));

    const restored = await getPersonaState();
    expect(restored.personas).toHaveLength(2);
    expect(restored.activePersona?.name).toBe("Второй");
    expect((await db.characters.get("char-1"))?.defaultPersonaId).toBe("persona-2");
    expect((await db.sessions.get("session-1"))?.personaId).toBe("persona-2");
  });

  it("отклоняет повреждённый файл", async () => {
    await expect(importBackup({ characters: [] })).rejects.toThrow(/повреждён/i);
    await expect(importBackup(null)).rejects.toThrow(/Некорректный формат/i);
  });
});
