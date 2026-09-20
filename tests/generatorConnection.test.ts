import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiCharacter, generateAiGroup } from "../src/services/characterGenerator";
import type { ApiConfig } from "../src/types";

/**
 * AI-генератор персонажей и групп ходит в сеть своим запросом, поэтому у него
 * был отдельный путь до провайдера — без резервного прокси. На Netlify это
 * выглядело так: браузер блокирует прямой CORS-запрос, и генерация падала с
 * сырым «Failed to fetch», хотя обычный чат в той же ветке работал.
 *
 * Здесь проверяем, что генератор ведёт себя как чат: повторяет запрос через
 * /api/llm-proxy и объясняет ошибку человеческим текстом.
 */

const ruConfig: ApiConfig = {
  mode: "openai",
  baseUrl: "https://api.ru-openrouter.ru/v1",
  apiKey: "sk_test",
  model: "openai/gpt-4o-mini",
  temperature: 0.85,
  contextWindow: 20,
  streamEnabled: false,
};

const characterCard = {
  name: "Мира",
  tagline: "Ведьма с зелёными глазами",
  description: "Живёт у северной башни.",
  personality: "Резкая, но справедливая.",
  scenario: "Ночь, гроза, ты стучишь в дверь.",
  firstMessage: "*Она открывает дверь.* — Чего надо?",
  initialStats: {
    trust: 30,
    affection: 20,
    closeness: 15,
    tension: 25,
    conflict: 0,
    statusTitle: "Первая встреча",
  },
};

const groupPayload = {
  characters: [
    characterCard,
    { ...characterCard, name: "Кай", tagline: "Вор", personality: "Наглый." },
  ],
  opening: "*Двое переглянулись.* — Кто это к нам пришёл?",
};

const calls: string[] = [];

/** Прямой запрос к провайдеру заблокирован браузером (CORS), прокси — работает. */
const blockDirectAllowProxy = (payload: unknown) => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);

    if (url.startsWith("/api/llm-proxy")) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new TypeError("Failed to fetch");
  });
};

beforeEach(() => {
  calls.length = 0;
});

describe("генератор персонажа: путь через резервный прокси", () => {
  it("герой создаётся, когда прямой запрос блокирует браузер", async () => {
    blockDirectAllowProxy(characterCard);

    const character = await generateAiCharacter(ruConfig, "any", ["Фэнтези"], "");

    expect(calls[0]).toBe("https://api.ru-openrouter.ru/v1/chat/completions");
    expect(calls[1]).toContain("/api/llm-proxy?target=");
    expect(character.name).toBe("Мира");
    expect(character.firstMessage).toContain("Чего надо");
  });

  it("группа собирается тем же путём и приносит опенинг", async () => {
    blockDirectAllowProxy(groupPayload);

    const group = await generateAiGroup(ruConfig, "any", ["Фэнтези"], "", 2);

    expect(group.characters).toHaveLength(2);
    expect(group.opening).toContain("Кто это к нам пришёл");
    expect(calls.some((url) => url.includes("/api/llm-proxy?target="))).toBe(true);
  });

  it("без прямого канала и без прокси объясняет причину, а не «Failed to fetch»", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);

      if (url.startsWith("/api/llm-proxy")) {
        return new Response("<!doctype html><html>Not found</html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }

      throw new TypeError("Failed to fetch");
    });

    const error = await generateAiCharacter(ruConfig, "any", ["Фэнтези"], "").catch(
      (cause: Error) => cause
    );

    expect(String(error)).toContain("/api/llm-proxy");
    expect(String(error)).not.toContain("Failed to fetch");
  });

  it("ошибку провайдера показывает его текстом", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);

      if (url.startsWith("/api/llm-proxy")) {
        return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      throw new TypeError("Failed to fetch");
    });

    await expect(
      generateAiCharacter(ruConfig, "any", ["Фэнтези"], "")
    ).rejects.toThrow(/API-ключ/);
  });

  it("локальный адрес не уходит через прокси", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);

      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(characterCard) } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    await generateAiCharacter(
      { ...ruConfig, baseUrl: "http://localhost:1234/v1", apiKey: "" },
      "any",
      ["Фэнтези"],
      ""
    );

    expect(calls[0]).toContain("localhost:1234");
    expect(calls.some((url) => url.includes("llm-proxy"))).toBe(false);
  });
});
