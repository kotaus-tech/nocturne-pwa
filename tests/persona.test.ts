import "fake-indexeddb/auto";
import { liveQuery } from "dexie";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createPersona,
  db,
  deletePersona,
  ensurePersonas,
  getActivePersonaId,
  getPersonaState,
  getUserProfile,
  resolvePersonaForChat,
  setActivePersona,
  setSetting,
  updatePersona,
} from "../src/db";
import type { Persona } from "../src/types";

/**
 * Свои личности: перенос старого профиля, переключение и — главное —
 * реактивность. Именно здесь ломалось обновление интерфейса: liveQuery
 * подписывается только на чтения из самой функции запроса, поэтому
 * getPersonaState() читает ключи KV напрямую.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const persona = (id: string, name: string): Persona => ({
  id,
  name,
  avatarUrl: "",
  personaDescription: "",
  createdAt: 0,
});

beforeAll(async () => {
  await db.kv.clear();
  await db.characters.clear();
  await db.sessions.clear();
  await db.messages.clear();
});

afterEach(async () => {
  await db.kv.clear();
});

describe("перенос старого профиля", () => {
  it("одиночный профиль становится первой персоной", async () => {
    await setSetting("userProfile", {
      name: "Странник",
      avatarUrl: "",
      personaDescription: "Загадочный гость",
    });

    await ensurePersonas();
    const state = await getPersonaState();

    expect(state.personas).toHaveLength(1);
    expect(state.personas[0].name).toBe("Странник");
    expect(state.activePersona?.id).toBe(state.personas[0].id);
  });

  it("повторный вызов не создаёт вторую персону", async () => {
    await ensurePersonas();
    await ensurePersonas();

    expect((await getPersonaState()).personas).toHaveLength(1);
  });
});

describe("реактивность интерфейса", () => {
  it("подписчики обновляются сразу после переключения", async () => {
    await ensurePersonas();
    const first = (await getPersonaState()).personas[0];
    const second = await createPersona({ name: "Второй" });

    let profileName = "";
    let profileUpdates = 0;
    const profileSub = liveQuery(() => getUserProfile()).subscribe((profile) => {
      profileUpdates += 1;
      profileName = profile.name;
    });

    let stateUpdates = 0;
    const stateSub = liveQuery(() => getPersonaState()).subscribe(() => {
      stateUpdates += 1;
    });

    let activeUpdates = 0;
    const activeSub = liveQuery(() => getActivePersonaId()).subscribe(() => {
      activeUpdates += 1;
    });

    await sleep(80);
    const profileBase = profileUpdates;
    const stateBase = stateUpdates;
    const activeBase = activeUpdates;

    await setActivePersona(second.id);
    await sleep(80);

    expect(profileUpdates).toBeGreaterThan(profileBase);
    expect(profileName).toBe("Второй");
    expect(stateUpdates).toBeGreaterThan(stateBase);
    expect(activeUpdates).toBeGreaterThan(activeBase);

    // Правка активной персоны видна без перезахода
    await updatePersona(second.id, { name: "Второй-Бис" });
    await sleep(80);
    expect(profileName).toBe("Второй-Бис");

    // Удаление возвращает к оставшейся
    await deletePersona(second.id);
    await sleep(80);
    expect(profileName).toBe(first.name);
    expect((await getPersonaState()).personas).toHaveLength(1);

    profileSub.unsubscribe();
    stateSub.unsubscribe();
    activeSub.unsubscribe();
  });
});

describe("правила работы с персонами", () => {
  it("переключение на несуществующую персону отклоняется", async () => {
    await ensurePersonas();
    await expect(setActivePersona("нет-такой")).rejects.toThrow(/не найдена/i);
  });

  it("последнюю персону удалить нельзя", async () => {
    await ensurePersonas();
    const state = await getPersonaState();

    await expect(deletePersona(state.personas[0].id)).rejects.toThrow(/хотя бы одна/i);
  });

  it("имена персон не остаются пустыми", async () => {
    await ensurePersonas();
    const created = await createPersona({ name: "   " });

    expect(created.name.trim().length).toBeGreaterThan(0);
    await deletePersona(created.id);
  });
});

describe("resolvePersonaForChat", () => {
  const list = [persona("a", "Аня"), persona("b", "Борис"), persona("c", "Вера")];
  const state = { personas: list, activePersona: list[1] };

  it("выбор ветки важнее остальных", () => {
    expect(resolvePersonaForChat(state, ["c", "a"])?.name).toBe("Вера");
  });

  it("иначе берётся персонаж", () => {
    expect(resolvePersonaForChat(state, [undefined, "a"])?.name).toBe("Аня");
  });

  it("иначе — активная персона", () => {
    expect(resolvePersonaForChat(state, [undefined, undefined])?.name).toBe("Борис");
  });

  it("пустые значения пропускаются", () => {
    expect(resolvePersonaForChat(state, ["", null, "c"])?.name).toBe("Вера");
  });

  it("удалённые персоны пропускаются", () => {
    expect(resolvePersonaForChat(state, ["dead-id", "also-dead"])?.name).toBe("Борис");
    expect(resolvePersonaForChat(state, ["dead-id", "c"])?.name).toBe("Вера");
  });

  it("без персон возвращает null", () => {
    expect(resolvePersonaForChat({ personas: [], activePersona: null }, ["a"])).toBeNull();
  });
});
