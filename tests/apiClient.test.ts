import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeRuOpenRouterUrl,
  readJsonResponse,
  requestRoleplayReply,
  resolveEndpoints,
  sanitizeBaseUrl,
  testConnection,
} from "../src/services/apiClient";
import type { ApiConfig } from "../src/types";

/**
 * Адреса провайдеров и разбор ответов.
 *
 * Здесь ловится ошибка вида «Unexpected token '<'»: она возникала, когда адрес
 * собирался из markdown-ссылки, запрос уходил на собственный домен приложения,
 * а хостинг отдавал index.html вместо JSON.
 */

const calls: string[] = [];
let responder: (request: { url: string }) => Response;

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const htmlResponse = () =>
  new Response("<!doctype html><html><head><title>NOCTURNE</title></head></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

const geminiConfig: ApiConfig = {
  mode: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com",
  apiKey: "TEST-KEY-123",
  model: "gemini-2.5-flash",
  temperature: 0.9,
  contextWindow: 20,
  streamEnabled: false,
};

beforeEach(() => {
  calls.length = 0;
  responder = () => jsonResponse({});
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return responder({ url });
  });
});

describe("sanitizeBaseUrl", () => {
  it("распутывает markdown-обёртку в сохранённых адресах", () => {
    expect(sanitizeBaseUrl("[https://openrouter.ai/api/v1](https://openrouter.ai/api/v1)")).toBe(
      "https://openrouter.ai/api/v1"
    );
    expect(sanitizeBaseUrl("[https://api.deepseek.com](https://api.deepseek.com)")).toBe(
      "https://api.deepseek.com"
    );
  });

  it("не трогает нормальные адреса", () => {
    expect(sanitizeBaseUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1");
    expect(sanitizeBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    expect(sanitizeBaseUrl("  https://api.example.com/v1  ")).toBe("https://api.example.com/v1");
    expect(sanitizeBaseUrl("")).toBe("");
  });

  it("из сохранённого мусора собирается рабочий адрес запроса", () => {
    const { primaryUrl } = resolveEndpoints("[https://openrouter.ai/api/v1](https://openrouter.ai/api/v1)");
    expect(primaryUrl).toBe("https://openrouter.ai/api/v1/chat/completions");

    const local = resolveEndpoints("http://localhost:11434/v1");
    expect(local.primaryUrl).toContain("localhost:11434");
  });
});

describe("RU OpenRouter", () => {
  const ruConfig: ApiConfig = {
    mode: "openai",
    baseUrl: "https://api.ru-openrouter.ru/v1",
    apiKey: "sk_test",
    model: "openai/gpt-4o-mini",
    temperature: 0.8,
    contextWindow: 20,
    streamEnabled: false,
  };

  it("собирает адрес чата из пути /v1", () => {
    expect(resolveEndpoints("https://api.ru-openrouter.ru/v1").primaryUrl).toBe(
      "https://api.ru-openrouter.ru/v1/chat/completions"
    );
    expect(resolveEndpoints("https://api.ru-openrouter.ru/v1/").primaryUrl).toBe(
      "https://api.ru-openrouter.ru/v1/chat/completions"
    );
    expect(resolveEndpoints("https://api.ru-openrouter.ru/v1/chat/completions").primaryUrl).toBe(
      "https://api.ru-openrouter.ru/v1/chat/completions"
    );
  });

  it("дописывает /v1, если указан только хост", () => {
    expect(normalizeRuOpenRouterUrl("https://api.ru-openrouter.ru")).toBe(
      "https://api.ru-openrouter.ru/v1"
    );
    expect(normalizeRuOpenRouterUrl("https://api.ru-openrouter.ru/")).toBe(
      "https://api.ru-openrouter.ru/v1"
    );
    expect(resolveEndpoints("https://api.ru-openrouter.ru").primaryUrl).toBe(
      "https://api.ru-openrouter.ru/v1/chat/completions"
    );
  });

  it("не трогает адреса других провайдеров", () => {
    expect(normalizeRuOpenRouterUrl("https://openrouter.ai/api/v1")).toBe(
      "https://openrouter.ai/api/v1"
    );
    expect(normalizeRuOpenRouterUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com"
    );
    expect(normalizeRuOpenRouterUrl("")).toBe("");
  });

  it("отвечает героем, когда прокси вернул нормальный ответ", async () => {
    responder = ({ url }) =>
      url.startsWith("/api/llm-proxy")
        ? jsonResponse({ choices: [{ message: { content: "Ответ через прокси." } }] })
        : (() => {
            throw new TypeError("Failed to fetch");
          })();

    const reply = await requestRoleplayReply(
      ruConfig,
      "system",
      [{ role: "user", content: "привет" }],
      () => {}
    );

    // RU OpenRouter сразу идёт через same-origin proxy, поэтому браузер не
    // получает даже первой CORS-ошибки от прямого запроса.
    expect(calls[0]).toContain("/api/llm-proxy?target=");
    expect(calls).toHaveLength(1);
    expect(reply.text).toContain("Ответ через прокси.");
  });

  it("объясняет, что прокси на этом домене нет, вместо «проверьте URL»", async () => {
    responder = ({ url }) => {
      if (url.startsWith("/api/llm-proxy")) {
        return new Response("<!doctype html><html><body>Not found</body></html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }
      throw new TypeError("Failed to fetch");
    };

    const error = await requestRoleplayReply(
      ruConfig,
      "system",
      [{ role: "user", content: "привет" }],
      () => {}
    ).catch((cause: Error) => cause);

    expect(String(error)).toContain("api.ru-openrouter.ru");
    expect(String(error)).toContain("/api/llm-proxy");
    expect(String(error)).not.toContain("Эндпоинт API не найден");
  });

  it("отдельно сообщает, когда прокси не смог дойти до провайдера", async () => {
    responder = ({ url }) =>
      url.startsWith("/api/llm-proxy")
        ? new Response(
            JSON.stringify({ error: "Proxy fetch failed", details: "TypeError: fetch failed" }),
            { status: 502, headers: { "content-type": "application/json" } }
          )
        : (() => {
            throw new TypeError("Failed to fetch");
          })();

    await expect(
      requestRoleplayReply(ruConfig, "system", [{ role: "user", content: "привет" }], () => {})
    ).rejects.toThrow(/не смог соединиться/);
  });

  it("в стриминговом режиме ошибка прокси тоже понятная", async () => {
    responder = ({ url }) => {
      if (url.startsWith("/api/llm-proxy")) {
        return new Response("<!doctype html><html>Not found</html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }
      throw new TypeError("Failed to fetch");
    };

    await expect(
      requestRoleplayReply(
        { ...ruConfig, streamEnabled: true },
        "system",
        [{ role: "user", content: "привет" }],
        () => {}
      )
    ).rejects.toThrow(/прокси/i);
  });

  it("ошибку самого провайдера через прокси не подменяет", async () => {
    responder = ({ url }) =>
      url.startsWith("/api/llm-proxy")
        ? new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          })
        : (() => {
            throw new TypeError("Failed to fetch");
          })();

    await expect(
      requestRoleplayReply(ruConfig, "system", [{ role: "user", content: "привет" }], () => {})
    ).rejects.toThrow(/API-ключ/);
  });
});

describe("запросы к Gemini", () => {
  it("идёт на настоящий адрес Gemini и передаёт ключ параметром", async () => {
    responder = () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Ответ героя.\n```meta\n{"stats":{"trust":55}}\n```' }] } }],
      });

    const reply = await requestRoleplayReply(
      geminiConfig,
      "system",
      [{ role: "user", content: "привет" }],
      () => {}
    );

    expect(calls[0]).toMatch(
      /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent\?key=/
    );
    expect(calls[0]).not.toContain("](");
    expect(calls[0]).not.toContain("[");
    expect(reply.text).toContain("Ответ героя.");
    expect(reply.stats?.trust).toBe(55);
  });

  it("в стриминговом режиме адрес тоже корректный", async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Стрим"}]}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    responder = () =>
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });

    await requestRoleplayReply(
      { ...geminiConfig, streamEnabled: true },
      "system",
      [{ role: "user", content: "привет" }],
      () => {}
    );

    expect(calls[0]).toContain(":streamGenerateContent");
  });

  it("HTML вместо JSON превращается в понятное сообщение", async () => {
    responder = htmlResponse;

    await expect(
      requestRoleplayReply(
        { ...geminiConfig, streamEnabled: false },
        "system",
        [{ role: "user", content: "привет" }],
        () => {}
      )
    ).rejects.toThrow(/HTML вместо JSON/);
  });

  it("ключ API не попадает в текст ошибки", async () => {
    responder = htmlResponse;

    const error = await requestRoleplayReply(
      { ...geminiConfig, streamEnabled: false },
      "system",
      [{ role: "user", content: "привет" }],
      () => {}
    ).catch((cause: Error) => cause);

    expect(String(error)).not.toContain("TEST-KEY-123");
  });
});

describe("проверка соединения", () => {
  const ruConfig: ApiConfig = {
    mode: "openai",
    baseUrl: "https://api.ru-openrouter.ru/v1",
    apiKey: "sk_test",
    model: "openai/gpt-4o-mini",
    temperature: 0.8,
    contextWindow: 20,
    streamEnabled: true,
  };

  it("показывает ответ модели и время отклика", async () => {
    responder = () =>
      jsonResponse({ choices: [{ message: { content: "Связь есть, всё работает." } }] });

    const result = await testConnection(ruConfig);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Связь есть, всё работает.");
    expect(result.model).toBe("openai/gpt-4o-mini");
    expect(typeof result.ms).toBe("number");
    // Проверка идёт тем же безопасным same-origin proxy-путём, что и генерация.
    expect(calls[0]).toContain("/api/llm-proxy?target=");
    expect(calls).toHaveLength(1);
  });

  it("убирает служебную обвязку из ответа", async () => {
    responder = () =>
      jsonResponse({
        choices: [{ message: { content: "<think>проверяю</think>\n— Да, связь есть.\n```meta\n{}\n```" } }],
      });

    const result = await testConnection(ruConfig);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("— Да, связь есть.");
  });

  it("сообщает об ошибке провайдера как есть", async () => {
    responder = ({ url }) =>
      url.includes("llm-proxy")
        ? new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          })
        : (() => {
            throw new TypeError("Failed to fetch");
          })();

    const result = await testConnection(ruConfig);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/API-ключ/);
    expect(result.model).toBe("openai/gpt-4o-mini");
  });

  it("объясняет, когда нет ни прямого канала, ни прокси", async () => {
    responder = ({ url }) => {
      if (url.includes("llm-proxy")) {
        return new Response("<!doctype html><html>Not found</html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }
      throw new TypeError("Failed to fetch");
    };

    const result = await testConnection(ruConfig);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("/api/llm-proxy");
  });

  it("сообщает о пустом ответе, если модель промолчала", async () => {
    responder = () => jsonResponse({ choices: [{ message: { content: "   " } }] });

    const result = await testConnection(ruConfig);

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/пустой/);
  });

  it("отменяется без ложной ошибки", async () => {
    responder = () => jsonResponse({ choices: [{ message: { content: "поздно" } }] });

    const controller = new AbortController();
    controller.abort();

    const result = await testConnection(ruConfig, controller.signal);

    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.message).toMatch(/отменена/i);
  });
});

describe("readJsonResponse", () => {
  it("указывает узел сервера, но без query-параметров", async () => {
    const error = await readJsonResponse(
      htmlResponse(),
      "https://example.com/v1/chat?key=SECRET"
    ).catch((cause: Error) => cause);

    expect(String(error)).toContain("example.com");
    expect(String(error)).not.toContain("SECRET");
  });

  it("объясняет пустой ответ", async () => {
    await expect(readJsonResponse(new Response("", { status: 200 }))).rejects.toThrow(
      /пустой ответ/
    );
  });

  it("возвращает разобранный JSON", async () => {
    await expect(readJsonResponse(jsonResponse({ ok: true }))).resolves.toEqual({ ok: true });
  });
});
