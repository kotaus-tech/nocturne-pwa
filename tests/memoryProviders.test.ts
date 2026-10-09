import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  callBackgroundLLM,
  extractResponseText,
  readJsonResponse,
  type ChatTurn,
} from "../src/services/apiClient";
import {
  extractMemoriesAndDiary,
  directCompressStoryToSummary,
  MemoryExtractionError,
} from "../src/services/memoryEngine";
import {
  buildNeutralChronicleRebuildPrompt,
  requestNeutralChronicle,
  requestNeutralChronicleRebuild,
  requestPersonalExtractionDetailed,
} from "../src/services/participantMemory";
import type { ApiConfig } from "../src/types";

/**
 * Память, дневник, хроника и синопсис на агрегаторах (ru-openrouter.ru,
 * polza.ai) и на обычном OpenRouter.
 *
 * Эти задачи не имеют окна стрима в интерфейсе и раньше уходили
 * «буферизованным» запросом. На агрегаторах это ломалось двумя способами:
 *  1) «думающие» модели отдают готовый JSON в отдельном поле
 *     (`reasoning`/`reasoning_content`), а `content` оставляют пустым;
 *  2) долгий ответ без потока обрывался прокси, и игрок видел только
 *     погасший индикатор.
 *
 * Ниже — оба случая и режимы отказа провайдера (не знает response_format,
 * не умеет SSE).
 */

const baseConfig: ApiConfig = {
  mode: "openai",
  baseUrl: "https://polza.ai/api/v1",
  apiKey: "sk_test",
  model: "anthropic/claude-sonnet-4",
  temperature: 0.7,
  contextWindow: 20,
  streamEnabled: true,
};

const turns: ChatTurn[] = [{ role: "user", content: "Собери память" }];

const sse = (chunks: string[]) =>
  new Response(
    chunks.map((chunk) => `data: ${chunk}`).join("\n\n") + "\n\ndata: [DONE]\n\n",
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );

const sseDelta = (delta: Record<string, unknown>) => sse([JSON.stringify({ choices: [{ delta }] })]);

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

let calls: Array<{ url: string; body: any }> = [];

const stubFetch = (handler: (call: { url: string; body: any; index: number }) => Response) => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const index = calls.length;
    calls.push({ url, body });
    return handler({ url, body, index });
  });
};

beforeEach(() => {
  calls = [];
});

describe("разбор ответа провайдера", () => {
  it("читает обычный content из choices", () => {
    const result = extractResponseText({
      choices: [{ message: { content: "готовый текст" } }],
    });

    expect(result.text).toBe("готовый текст");
    expect(result.source).toBe("content");
  });

  it("склеивает content-массив частей (Anthropic-совместимые шлюзы)", () => {
    const result = extractResponseText({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "Первая часть. " },
              { type: "text", text: "Вторая часть." },
            ],
          },
        },
      ],
    });

    expect(result.text).toBe("Первая часть. Вторая часть.");
  });

  it("берёт JSON из поля reasoning, если content пустой (polza.ai)", () => {
    const payload = { mood: "тепло", summary: "Он вернулся" };
    const data = {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            reasoning: `Ответ: ${JSON.stringify(payload)}`,
          },
          finish_reason: "stop",
        },
      ],
    };

    expect(extractResponseText(data).text).toContain("Он вернулся");
    expect(extractResponseText(data, { preferJson: true }).text).toBe(
      `Ответ: ${JSON.stringify(payload)}`
    );
  });

  it("берёт JSON из reasoning_content, если content пустой (ru-openrouter.ru)", () => {
    const data = {
      choices: [
        {
          message: {
            content: "",
            reasoning_content: '{"episodes": ["Первое знакомство"]}',
          },
        },
      ],
    };

    expect(extractResponseText(data, { preferJson: true }).text).toBe(
      '{"episodes": ["Первое знакомство"]}'
    );
    expect(extractResponseText(data).source).toBe("reasoning");
  });

  it("предпочитает канал с JSON, когда ответ и рассуждения пришли вместе", () => {
    const data = {
      choices: [
        {
          message: {
            content: "Сейчас соберу данные.",
            reasoning_content: '{"mood":"тревога"}',
          },
        },
      ],
    };

    expect(extractResponseText(data, { preferJson: true }).text).toBe('{"mood":"тревога"}');
  });

  it("разбирает reasoning_details (OpenRouter) и Gemini-части", () => {
    const details = extractResponseText({
      choices: [
        {
          message: {
            content: "Ответ.",
            reasoning_details: [{ type: "reasoning.text", text: "ход мыслей" }],
          },
        },
      ],
    });

    expect(details.reasoning).toContain("ход мыслей");

    const gemini = extractResponseText({
      candidates: [
        {
          content: {
            parts: [{ text: "размышление", thought: true }, { text: "итог" }],
          },
        },
      ],
    });

    expect(gemini.text).toBe("итог");
    expect(gemini.reasoning).toContain("размышление");
  });
});

describe("ответ потоком на обычный запрос", () => {
  it("склеивает SSE-дельты, если провайдер стримит даже при stream: false", async () => {
    const res = new Response(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Первая " } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "часть" } }] })}`,
        "data: [DONE]",
      ].join("\n"),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );

    const data = await readJsonResponse(res);

    expect(data.choices[0].message.content).toBe("Первая часть");
  });

  it("обычный JSON по-прежнему разбирается", async () => {
    await expect(readJsonResponse(jsonResponse({ ok: true }))).resolves.toEqual({ ok: true });
  });
});

describe("фоновый вызов (память, дневник, хроника, синопсис)", () => {
  it("идёт стриминговым каналом и просит JSON, не навязывая polza.ai чужих полей", async () => {
    stubFetch(() => sseDelta({ content: '{"mood":"тепло"}' }));

    const text = await callBackgroundLLM(baseConfig, "system", turns, { expectJson: true });

    expect(text).toBe('{"mood":"тепло"}');
    expect(calls).toHaveLength(1);
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
    // polza.ai принимает `reasoning` в другом виде, а `{enabled:false}` отбивает
    // ошибкой 400 с нулевыми токенами — то есть запрос не доходит до модели.
    expect(calls[0].body.reasoning).toBeUndefined();
  });

  it("просит отключить размышления у провайдера, который это понимает (OpenRouter)", async () => {
    const openRouterConfig: ApiConfig = {
      ...baseConfig,
      baseUrl: "https://openrouter.ai/api/v1",
    };

    stubFetch(() => sseDelta({ content: '{"mood":"тепло"}' }));

    await callBackgroundLLM(openRouterConfig, "system", turns, { expectJson: true });

    expect(calls[0].body.reasoning).toEqual({ enabled: false });
  });

  it("возвращает JSON из поля размышлений, когда content пустой", async () => {
    stubFetch(() =>
      sse([
        JSON.stringify({ choices: [{ delta: { reasoning: "думаю над фактами" } }] }),
        JSON.stringify({ choices: [{ delta: { reasoning: '{"summary":"Он вернулся"}' } }] }),
      ])
    );

    const text = await callBackgroundLLM(baseConfig, "system", turns, { expectJson: true });

    expect(text).toContain("Он вернулся");
  });

  it("снимает дополнительные поля по одному, а не все сразу", async () => {
    stubFetch(({ body }) =>
      body.response_format
        ? jsonResponse({ error: { message: "Unsupported parameter: response_format" } }, 400)
        : sseDelta({ content: '{"mood":"спокойствие"}' })
    );

    const text = await callBackgroundLLM(baseConfig, "system", turns, { expectJson: true });

    expect(text).toBe('{"mood":"спокойствие"}');
    expect(calls).toHaveLength(3);
    // Вторая попытка продолжает идти стримом: снимаем только виновника, а
    // JSON-режим (он повышает шанс разборного ответа) держим до последнего.
    expect(calls[1].body.stream).toBe(true);
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
    expect(calls[2].body.response_format).toBeUndefined();
    expect(calls[2].body.reasoning).toBeUndefined();
    expect(calls[2].body.stream).toBe(true);
  });

  it("при отказе от reasoning сохраняет JSON-режим и стрим", async () => {
    const openRouterConfig: ApiConfig = {
      ...baseConfig,
      baseUrl: "https://openrouter.ai/api/v1",
    };

    stubFetch(({ body }) =>
      body.reasoning
        ? jsonResponse({ error: { message: "Unsupported parameter: reasoning" } }, 400)
        : sseDelta({ content: '{"mood":"ровно"}' })
    );

    const text = await callBackgroundLLM(openRouterConfig, "system", turns, { expectJson: true });

    expect(text).toBe('{"mood":"ровно"}');
    expect(calls).toHaveLength(2);
    expect(calls[1].body.reasoning).toBeUndefined();
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
    expect(calls[1].body.stream).toBe(true);
  });

  it("показывает ошибку, которую провайдер прислал внутри ответа 200", async () => {
    stubFetch(() =>
      sse([
        JSON.stringify({
          error: { message: "Provider returned error: upstream is overloaded" },
          choices: [{ finish_reason: "error", delta: {} }],
        }),
      ])
    );

    await expect(
      callBackgroundLLM(baseConfig, "system", turns, { expectJson: true })
    ).rejects.toThrow(/upstream is overloaded/);
  });

  it("уходит на обычный запрос, если провайдер не умеет SSE", async () => {
    stubFetch(({ body }) =>
      body.stream
        ? new Response("SSE не поддерживается", { status: 500 })
        : jsonResponse({ choices: [{ message: { content: '{"summary":"Обычный канал"}' } }] })
    );

    const text = await callBackgroundLLM(baseConfig, "system", turns, { expectJson: true });

    expect(text).toBe('{"summary":"Обычный канал"}');
    expect(calls.map((call) => call.body.stream)).toEqual([true, false]);
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
  });

  it("не подмешивает размышления в текст ответа (хроника и синопсис)", async () => {
    stubFetch(() =>
      sse([
        JSON.stringify({ choices: [{ delta: { reasoning: "долго думаю" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "Готовый текст хроники." } }] }),
      ])
    );

    const text = await callBackgroundLLM(baseConfig, "system", turns);

    expect(text).toBe("Готовый текст хроники.");
    expect(text).not.toContain("<thought>");
  });

  it("не повторяет запрос при неверном ключе и объясняет причину", async () => {
    stubFetch(() => jsonResponse({ error: { message: "Invalid API key" } }, 401));

    await expect(
      callBackgroundLLM(baseConfig, "system", turns, { expectJson: true })
    ).rejects.toThrow(/API-ключ/);
    expect(calls).toHaveLength(1);
  });

  it("падает понятной ошибкой, если модель молчит во всех каналах", async () => {
    stubFetch(({ body }) =>
      body.stream ? sse([]) : jsonResponse({ choices: [{ message: { content: "   " } }] })
    );

    await expect(
      callBackgroundLLM(baseConfig, "system", turns, { expectJson: true })
    ).rejects.toThrow(/пустой ответ/i);
  });
});

describe("ручная актуализация (панель режиссёра и групповая сцена)", () => {
  it("промпт пересборки требует собрать хронику заново, а не подтвердить старую", () => {
    const rebuild = buildNeutralChronicleRebuildPrompt({
      history: "Игрок: привет\nМира: привет",
      currentSummary: "Они поздоровались.",
    });

    expect(rebuild).toContain("ПЕРЕСОБРАТЬ ЗАНОВО");
    expect(rebuild).toContain("Игрок: привет");
    expect(rebuild).toContain("Не возвращай прежний текст без изменений");
    // Плановое правило «ничего не произошло — верни как было» здесь вредно:
    // именно из-за него ручная кнопка выглядела как «нажал и ничего».
    expect(rebuild).not.toContain("верни хронику без изменений");
  });

  it("ручная пересборка отдаёт новый текст хроники", async () => {
    stubFetch(() =>
      sseDelta({
        content: "<thought>прикидываю</thought>Они познакомились в метро и договорились встретиться снова.",
      })
    );

    const text = await requestNeutralChronicleRebuild(
      baseConfig,
      "Игрок: привет",
      "Они поздоровались."
    );

    expect(text).toBe("Они познакомились в метро и договорились встретиться снова.");
    expect(text).not.toContain("<thought>");
    expect(calls[0].body.messages[1].content).toContain("ПЕРЕСОБРАТЬ ЗАНОВО");
  });

  it("плановая хроника по-прежнему просит не выдумывать изменений", async () => {
    stubFetch(() => sseDelta({ content: "Они поздоровались." }));

    await requestNeutralChronicle(baseConfig, "Игрок: привет", "Они поздоровались.");

    expect(calls[0].body.messages[1].content).toContain("верни хронику без изменений");
  });

  it("личная память групповой сцены возвращает сырой ответ, если JSON не разобрался", async () => {
    stubFetch(() => sseDelta({ content: "Мира задумалась о нём." }));

    const { result, raw } = await requestPersonalExtractionDetailed(
      baseConfig,
      "Мира",
      "Игрок: привет",
      []
    );

    expect(result).toBeNull();
    expect(raw).toContain("Мира задумалась");
  });
});

describe("RU OpenRouter и память", () => {
  it("фоновый вызов идёт через same-origin прокси и стримится, как чат", async () => {
    const ruConfig: ApiConfig = {
      ...baseConfig,
      baseUrl: "https://api.ru-openrouter.ru/v1",
      model: "openai/gpt-4o-mini",
    };

    stubFetch(() => sseDelta({ content: '{"summary":"Хроника"}' }));

    const text = await callBackgroundLLM(ruConfig, "system", turns, { expectJson: true });

    expect(text).toBe('{"summary":"Хроника"}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/llm-proxy?target=");
    expect(calls[0].url).toContain(
      encodeURIComponent("https://api.ru-openrouter.ru/v1/chat/completions")
    );
    expect(calls[0].body.stream).toBe(true);
  });
});

describe("память и синопсис на агрегаторе", () => {
  it("дневник, якоря и событие собираются, когда JSON пришёл в reasoning", async () => {
    const payload = {
      diaryThought: "Он снова рядом, и я не знаю, как это назвать.",
      mood: "Тепло",
      activeFacts: [{ keys: ["прогулка"], content: "Мы гуляли у реки" }],
      summary: "Они гуляли у реки и говорили о будущем.",
    };

    stubFetch(() => sseDelta({ reasoning: JSON.stringify(payload) }));

    const result = await extractMemoriesAndDiary(
      baseConfig,
      "Мира",
      "Игрок",
      "Игрок: Пойдём к реке\nМира: Идём."
    );

    expect(result.diaryThought).toContain("Он снова рядом");
    expect(result.mood).toBe("Тепло");
    expect(result.activeFacts).toHaveLength(1);
    expect(result.summary).toContain("гуляли");
  });

  it("повторяет запрос, если модель ответила монологом без JSON", async () => {
    stubFetch(({ index }) =>
      index === 0
        ? sseDelta({ content: "Сейчас подумаю... видимо, стоит записать, что они гуляли." })
        : sseDelta({
            content: JSON.stringify({
              diaryThought: "Он снова рядом.",
              mood: "Тепло",
              activeFacts: [{ keys: ["прогулка"], content: "Гуляли у реки" }],
              summary: "Гуляли у реки.",
            }),
          })
    );

    const result = await extractMemoriesAndDiary(baseConfig, "Мира", "Игрок", "Игрок: привет");

    expect(calls).toHaveLength(2);
    expect(calls[1].body.messages.at(-1).content).toMatch(/СТРОГО одним JSON-объектом/);
    expect(result.mood).toBe("Тепло");
    expect(result.activeFacts).toHaveLength(1);
  });

  it("повторяет запрос, если JSON пришёл, но не по схеме памяти", async () => {
    stubFetch(({ index }) =>
      index === 0
        ? sseDelta({ content: '{"analysis": "диалог про прогулку"}' })
        : sseDelta({
            content: JSON.stringify({
              diaryThought: "Он снова рядом.",
              mood: "Тепло",
              activeFacts: [{ keys: ["прогулка"], content: "Гуляли у реки" }],
              summary: "Гуляли у реки.",
            }),
          })
    );

    const result = await extractMemoriesAndDiary(baseConfig, "Мира", "Игрок", "Игрок: привет");

    expect(calls).toHaveLength(2);
    expect(result.mood).toBe("Тепло");
    expect(result.activeFacts).toHaveLength(1);
  });

  it("несёт сырой ответ модели в ошибке (для показа в интерфейсе)", async () => {
    stubFetch(() => sseDelta({ content: "Извини, сейчас не могу помочь." }));

    const failure = await extractMemoriesAndDiary(baseConfig, "Мира", "Игрок", "Игрок: привет").catch(
      (cause) => cause
    );

    expect(failure).toBeInstanceOf(MemoryExtractionError);
    expect((failure as MemoryExtractionError).rawAnswer).toContain("не могу помочь");
  });

  it("в ошибке формата видно, что именно ответила модель", async () => {
    stubFetch(() => sseDelta({ content: "Извини, сейчас не могу помочь." }));
    // повтор на монолог тоже вернёт монолог — сработает защита от тишины

    await expect(
      extractMemoriesAndDiary(baseConfig, "Мира", "Игрок", "Игрок: привет")
    ).rejects.toThrow(/не в формате JSON.*Ответ модели/s);
  });

  it("синопсис объясняет пустой ответ вместо тихого «ничего не произошло»", async () => {
    stubFetch(({ body }) =>
      body.stream ? sse([]) : jsonResponse({ choices: [{ message: { content: "" } }] })
    );

    await expect(
      directCompressStoryToSummary(baseConfig, "Мира", "Игрок", "История")
    ).rejects.toThrow(/пустой ответ|размышлен/i);
  });
});
