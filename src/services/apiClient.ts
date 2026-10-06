import type { ApiConfig, Message, ThinkingMode } from "../types";
import { parseMetaBlock, type ParsedResponse } from "./metaParser";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GeminiContentPart {
  text?: string;
  thought?: boolean;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiContentPart[];
}

/**
 * Убирает из адреса markdown-обёртку вида
 * "[https://host/path](https://host/path)" — такие значения остались в
 * сохранённых настройках и пресетах и приводили к запросу на собственный
 * домен приложения. Корректные адреса возвращаются без изменений.
 */
export function sanitizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || "").trim();
  if (!raw || !raw.includes("](")) return raw;

  const match = raw.match(/https?:\/\/[^\s)\]`"']+/);
  return match ? match[0] : raw;
}

/** Хост сервиса RU OpenRouter: его API живёт под путём `/v1`. */
const RU_OPENROUTER_HOST = "api.ru-openrouter.ru";

/**
 * RU OpenRouter отвечает 404, если в адресе нет `/v1` (их документация требует
 * `https://api.ru-openrouter.ru/v1/chat/completions`). Если игрок указал только
 * хост, дописываем путь сами — иначе ошибка выглядит как «неверный URL».
 * Корректные адреса возвращаются без изменений.
 */
export function normalizeRuOpenRouterUrl(baseUrl?: string): string {
  const raw = sanitizeBaseUrl(baseUrl);
  if (!raw) return raw;

  try {
    const url = new URL(raw);
    if (url.hostname !== RU_OPENROUTER_HOST) return raw;

    const path = url.pathname.replace(/\/+$/, "");
    if (path && path !== "/") return raw;

    url.pathname = "/v1";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw;
  }
}

export function isLocalEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const lower = baseUrl.toLowerCase();
  return (
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("0.0.0.0") ||
    lower.includes(":11434") ||
    lower.includes(":1234") ||
    lower.includes(":8080") ||
    lower.includes(":5000") ||
    lower.includes("192.168.") ||
    lower.includes("10.0.") ||
    lower.includes("pinggy") ||
    lower.includes("trycloudflare") ||
    lower.includes("loca.lt") ||
    lower.includes("ngrok")
  );
}

export function isOllamaEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const lower = baseUrl.toLowerCase();
  return (
    lower.includes(":11434") ||
    lower.includes("ollama") ||
    lower.includes("pinggy") ||
    lower.includes("trycloudflare") ||
    lower.includes("loca.lt") ||
    lower.includes("ngrok")
  );
}

/**
 * Нативный API DeepSeek: поле `reasoning` ему незнакомо. А вот у агрегаторов
 * (ru-openrouter.ru, polza.ai, OpenRouter) тот же `deepseek/...` — обычная
 * модель, и выключить ей размышления можно и нужно.
 */
export function isNativeDeepSeekEndpoint(config: ApiConfig): boolean {
  return sanitizeBaseUrl(config.baseUrl).toLowerCase().includes("deepseek");
}

/**
 * polza.ai: поле `reasoning` устроено иначе (effort), а `{enabled: false}` там
 * не принимается и приводит к 400 с нулевыми токенами — то есть к запросу,
 * который вообще не доходит до модели. Уже сохранённые настройки менять не
 * нужно: просто не отправляем это поле такому провайдеру.
 */
function isPolzaEndpoint(config: ApiConfig): boolean {
  return sanitizeBaseUrl(config.baseUrl).toLowerCase().includes("polza");
}

/** Можно ли просить провайдера не тратить бюджет на размышления. */
function canToggleReasoningOff(config: ApiConfig): boolean {
  return !isNativeDeepSeekEndpoint(config) && !isPolzaEndpoint(config);
}

export function isDeepSeekEndpoint(config: ApiConfig): boolean {
  const base = sanitizeBaseUrl(config.baseUrl).toLowerCase();
  const model = (config.model || "").toLowerCase();
  return base.includes("deepseek") || model.includes("deepseek") || model.includes("r1");
}

function cleanGeminiModel(modelName?: string): string {
  if (!modelName || !modelName.toLowerCase().includes("gemini")) {
    return "gemini-2.0-flash";
  }
  return modelName.trim().replace(/^models\//, "");
}

export function resolveEndpoints(baseUrl: string): {
  isOllama: boolean;
  primaryUrl: string;
  fallbackUrl: string | null;
} {
  const clean = normalizeRuOpenRouterUrl(baseUrl).replace(/\/+$/, "");

  if (!clean) {
    throw new Error("Base URL не указан в настройках API. Укажите адрес сервера (например, адрес Ollama или провайдера).");
  }

  const isOllama = isOllamaEndpoint(clean);

  if (isOllama) {
    const root = clean.replace(/\/(v1|api)(\/chat(\/completions)?)?$/, "");
    return {
      isOllama: true,
      primaryUrl: `${root}/api/chat`,
      fallbackUrl: `${root}/v1/chat/completions`,
    };
  }

  const isLocal = isLocalEndpoint(clean);
  if (isLocal) {
    const root = clean.replace(/\/(v1|api)(\/chat(\/completions)?)?$/, "");
    return {
      isOllama: false,
      primaryUrl: `${root}/v1/chat/completions`,
      fallbackUrl: `${root}/api/chat`,
    };
  }

  if (clean.endsWith("/chat/completions")) {
    return { isOllama: false, primaryUrl: clean, fallbackUrl: null };
  }

  return {
    isOllama: false,
    primaryUrl: clean.endsWith("/v1") ? `${clean}/chat/completions` : `${clean}/chat/completions`,
    fallbackUrl: null,
  };
}

const geminiSafetySettings = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

export function buildGeminiThinkingConfig(modelName: string, mode: ThinkingMode = "AUTO") {
  if (mode === "AUTO") return undefined;
  const model = modelName.toLowerCase();

  if (model.includes("1.5") || model.includes("1.0")) return undefined;

  if (model.includes("gemini-3")) {
    switch (mode) {
      case "OFF": return { thinkingLevel: "LOW" };
      case "LOW": return { thinkingLevel: "LOW" };
      case "MEDIUM": return { thinkingLevel: "MEDIUM" };
      case "HIGH": return { thinkingLevel: "HIGH" };
      default: return undefined;
    }
  }

  if (model.includes("2.5") || model.includes("thinking")) {
    switch (mode) {
      case "OFF": return { thinkingBudget: 0 };
      case "LOW": return { thinkingBudget: 1024 };
      case "MEDIUM": return { thinkingBudget: 2048 };
      case "HIGH": return { thinkingBudget: -1 };
      default: return undefined;
    }
  }

  return undefined;
}

/**
 * Преобразует сообщения в реплики для API.
 *
 * Для групповых сцен можно передать labelAssistant: он вернёт имя автора для
 * тех реплик персонажей, которые принадлежат не текущему отвечающему. Такие
 * реплики помечаются префиксом «Имя: », чтобы модель понимала, кто что сказал.
 */
export function messagesToTurns(
  messages: Message[],
  labelAssistant?: (message: Message) => string | undefined
): ChatTurn[] {
  return messages
    .filter((m) => m.sender !== "system")
    .map((m) => {
      const content = m.swipes[m.currentSwipeIndex] ?? "";

      if (m.sender === "assistant" && labelAssistant) {
        const label = labelAssistant(m);
        const name = typeof label === "string" ? label.trim() : "";
        if (name) {
          return { role: "assistant" as const, content: `${name}: ${content}` };
        }
      }

      return {
        role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
        content,
      };
    });
}

export function formatApiError(
  err: unknown,
  status?: number,
  rawResponseText?: string,
  baseUrl?: string,
  modelName?: string
): string {
  const isLocal = isLocalEndpoint(baseUrl);

  if (err instanceof TypeError && (err.message.includes("Failed to fetch") || err.message.includes("NetworkError"))) {
    if (isLocal) {
      return "Ошибка сети или блокировка CORS.\n1. Убедитесь, что туннель или сервер запущен на ПК.\n2. Убедитесь, что Ollama запущена с OLLAMA_ORIGINS=*.\n3. Проверьте адрес Base URL в настройках.";
    }
    return "Ошибка сети: нет соединения с сервером. Проверьте подключение к интернету или VPN.";
  }

  let serverMessage = "";
  if (rawResponseText) {
    try {
      const parsed = JSON.parse(rawResponseText);
      serverMessage = parsed?.error?.message || parsed?.error || parsed?.message || rawResponseText;
    } catch {
      serverMessage = rawResponseText;
    }
  }

  const lowerMsg = (serverMessage || (err instanceof Error ? err.message : String(err))).toLowerCase();

  const isModelMissing =
    lowerMsg.includes("model") &&
    (lowerMsg.includes("not found") || lowerMsg.includes("does not exist") || lowerMsg.includes("try pulling"));

  if (isModelMissing) {
    const hint = modelName ? ` «${modelName}»` : "";
    return `Модель${hint} не найдена. Загрузите её через консоль или выберите другую в Настройках.`;
  }

  if (status === 404 || lowerMsg.includes("404 page not found")) {
    return "Эндпоинт API не найден (404). Проверьте URL в Настройках.";
  }

  if (status === 401 || lowerMsg.includes("invalid api key") || lowerMsg.includes("unauthenticated") || lowerMsg.includes("api_key_invalid")) {
    if (isLocal) return "Сервер отклонил запрос. Очистите поле API-ключа в Настройках.";
    return "Недействительный API-ключ. Проверьте ключ в Настройках.";
  }

  if (status === 403 || lowerMsg.includes("permission_denied") || lowerMsg.includes("access denied")) {
    return "Доступ запрещен. Проверьте права ключа.";
  }

  if (status === 429 || lowerMsg.includes("rate limit") || lowerMsg.includes("quota exceeded") || lowerMsg.includes("insufficient_quota") || lowerMsg.includes("credits")) {
    return "Превышен лимит запросов или закончился баланс на аккаунте провайдера.";
  }

  if (lowerMsg.includes("context_length_exceeded") || lowerMsg.includes("maximum context length") || lowerMsg.includes("too many tokens") || lowerMsg.includes("token limit")) {
    return "Диалог превысил лимит контекста. Нажмите «Сжать память» в Режиссёре или уменьшите контекст.";
  }

  if (status && status >= 500) {
    return `Сервер модели сообщил об ошибке (Код ${status}). Повторите попытку через пару секунд.`;
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return serverMessage ? `Ошибка API: ${serverMessage}` : "Неизвестная ошибка при обращении к языковой модели.";
}

function sanitizeGeminiContents(turns: ChatTurn[]): GeminiContent[] {
  const validTurns = turns.filter((t) => typeof t.content === "string" && t.content.trim().length > 0);
  if (validTurns.length === 0) {
    return [{ role: "user", parts: [{ text: "..." }] }];
  }

  const rawContents: GeminiContent[] = validTurns.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.content }],
  }));

  const merged: GeminiContent[] = [];
  for (const item of rawContents) {
    if (merged.length > 0 && merged[merged.length - 1].role === item.role) {
      const prevText = merged[merged.length - 1].parts[0]?.text || "";
      const currentText = item.parts[0]?.text || "";
      merged[merged.length - 1].parts[0] = { text: `${prevText}\n\n${currentText}` };
    } else {
      merged.push({ role: item.role, parts: [{ text: item.parts[0]?.text || "" }] });
    }
  }

  if (merged.length > 0 && merged[0].role === "model") {
    merged.unshift({
      role: "user",
      parts: [{ text: "[Начало истории]" }],
    });
  }

  return merged;
}

/**
 * Собирает текст из содержимого ответа: строка или массив частей
 * (Anthropic/Gemini-стиль: `[{ type: "text", text: "…" }]`).
 */
export function joinResponseParts(value: unknown): { text: string; reasoning: string } {
  // Важно не тримить части: в стриме куски текста приходят с пробелами на
  // стыках («Первая » + «часть»), и обрезка склеивала бы слова.
  if (typeof value === "string") return { text: value, reasoning: "" };
  if (!Array.isArray(value)) return { text: "", reasoning: "" };

  let text = "";
  let reasoning = "";

  for (const part of value) {
    if (typeof part === "string") {
      text += part;
      continue;
    }

    const partText = typeof (part as any)?.text === "string" ? (part as any).text : "";
    if (!partText) continue;

    const type = String((part as any)?.type ?? "").toLowerCase();
    const isReasoning =
      (part as any)?.thought === true || type.includes("reason") || type.includes("think");

    if (isReasoning) reasoning += partText;
    else text += partText;
  }

  return { text, reasoning };
}

/** Поле `reasoning_details` (OpenRouter-стиль): массив строк или частей. */
function readReasoningDetails(value: unknown): string {
  if (!Array.isArray(value)) return "";

  return value
    .map((item) =>
      typeof item === "string"
        ? item
        : typeof (item as any)?.text === "string"
          ? (item as any).text
          : ""
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Режим размышлений для Gemini: служебным задачам (память, дневник, хроника)
 * размышления не нужны — они лишь съедают бюджет ответа. Явный выбор игрока
 * (LOW/MEDIUM/HIGH) уважаем.
 */
function geminiThinkingMode(config: ApiConfig, extras: ChatRequestExtras): ThinkingMode {
  const mode = config.thinkingMode ?? "AUTO";
  if (!extras.reasoningOff) return mode;
  return mode === "HIGH" || mode === "MEDIUM" || mode === "LOW" ? mode : "OFF";
}

/** Снимает обёртки размышлений, если модель завернула ответ в <think>/<thought>. */
function unwrapThinkingTags(raw: string): string {
  let text = raw;

  if (text.includes("</think>")) {
    const reply = text.split("</think>").pop()?.trim() ?? "";
    if (reply.length > 0) text = reply;
  }

  if (text.includes("<think>")) {
    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<think>[\s\S]*$/gi, "")
      .trim();
    if (cleaned.length > 0) text = cleaned;
  }

  return text;
}

export interface ExtractedResponseText {
  /** Лучший текст ответа (а если ответа нет — текст размышлений). */
  text: string;
  /** Откуда он взят: обычный ответ, канал размышлений или ничего. */
  source: "content" | "reasoning" | "none";
  /** Полный текст канала размышлений — для пометки <thought> в чате. */
  reasoning: string;
}

/**
 * Достаёт текст ответа из всех форматов, которые встречаются у провайдеров и
 * агрегаторов (OpenRouter, ru-openrouter.ru, polza.ai, DeepSeek, Ollama, Gemini,
 * Anthropic-совместимые шлюзы).
 *
 * Раньше читался только `choices[0].message.content`, поэтому у «думающих»
 * моделей ответ выглядел пустым: готовый JSON уезжает в отдельное поле
 * (`reasoning`, `reasoning_content`, `thinking`) или приходит массивом частей.
 * Для памяти, дневника и хроники это означало «модель промолчала» и молчаливую
 * потерю данных — особенно на ru-openrouter.ru и polza.ai, где модели с
 * размышлениями включены по умолчанию.
 *
 * `preferJson` используют служебные задачи: тогда выбирается тот канал,
 * в котором действительно лежит JSON-объект.
 */
export function extractResponseText(
  data: any,
  { preferJson = false }: { preferJson?: boolean } = {}
): ExtractedResponseText {
  const messageLike = [
    data?.choices?.[0]?.message,
    data?.choices?.[0]?.delta,
    data?.message,
  ].filter(Boolean);

  const content: string[] = [];
  const reasoning: string[] = [];

  const pushTrimmed = (bucket: string[], value: string) => {
    const trimmed = value.trim();
    if (trimmed) bucket.push(trimmed);
  };

  for (const message of messageLike) {
    const parts = joinResponseParts(message.content);
    pushTrimmed(content, parts.text);
    pushTrimmed(reasoning, parts.reasoning);

    for (const field of [message.reasoning_content, message.reasoning, message.thinking]) {
      if (typeof field === "string" && field.trim()) reasoning.push(field.trim());
    }

    const details = readReasoningDetails(message.reasoning_details);
    if (details) reasoning.push(details);
  }

  // Gemini-подобный формат: ответ приходит частями, размышления помечены `thought`.
  const geminiParts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(geminiParts)) {
    const parts = joinResponseParts(geminiParts);
    pushTrimmed(content, parts.text);
    pushTrimmed(reasoning, parts.reasoning);
  }

  for (const field of [data?.choices?.[0]?.text, data?.response, data?.output_text]) {
    if (typeof field === "string" && field.trim()) content.push(field.trim());
  }

  const candidates: Array<{ text: string; source: "content" | "reasoning" }> = [
    ...content.map((text) => ({ text, source: "content" as const })),
    ...reasoning.map((text) => ({ text, source: "reasoning" as const })),
  ];

  const picked =
    (preferJson ? candidates.find((item) => item.text.includes("{")) : undefined) ??
    candidates.find((item) => item.text.trim().length > 0);

  if (!picked) return { text: "", source: "none", reasoning: "" };

  return {
    text: unwrapThinkingTags(picked.text),
    source: picked.source,
    reasoning: reasoning.join("\n\n").trim(),
  };
}

function extractResponseContent(data: any): string {
  return extractResponseText(data).text;
}

function cleanStreamTextForUI(fullOutput: string): string {
  let text = fullOutput;

  if (text.includes("</think>")) {
    text = text.split("</think>").pop() || "";
  } else if (text.includes("<think>")) {
    return "";
  }

  if (text.includes("</thought>")) {
    text = text.split("</thought>").pop() || "";
  } else if (text.includes("<thought>")) {
    return "";
  }

  const trimmed = text.trimStart();
  if (trimmed.startsWith("<stats")) {
    const closingIdx = trimmed.indexOf(">");
    if (closingIdx === -1) {
      return "";
    }
    text = trimmed.slice(closingIdx + 1);
  }

  return text.replace(/```(?:meta|json)?[\s\S]*$/i, "").trimStart();
}

/**
 * Дополнительные поля запроса для служебных (фоновых) задач: памяти, дневника,
 * хроники, синопсиса, выбора говорящего.
 *
 *  - `jsonMode` — просим провайдера вернуть строго JSON-объект;
 *  - `reasoningOff` — просим не тратить бюджет на «размышления», иначе у
 *    думающих моделей готовый ответ уезжает в отдельное поле, а `content`
 *    остаётся пустым (штатное поведение ru-openrouter.ru и polza.ai);
 *  - `expectJson` — при разборе ответа выбираем канал, где реально лежит JSON;
 *  - `withoutThoughtPrefix` — не подмешивать размышления в текст ответа: у
 *    служебных задач нет окна чата, им нужен только чистый ответ.
 */
export interface ChatRequestExtras {
  jsonMode?: boolean;
  reasoningOff?: boolean;
  expectJson?: boolean;
  withoutThoughtPrefix?: boolean;
}

async function callOllamaStream(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk: (accumulatedText: string) => void,
  signal?: AbortSignal,
  extras: ChatRequestExtras = {}
): Promise<string> {
  const { primaryUrl } = resolveEndpoints(config.baseUrl);

  const shouldThink =
    config.thinkingMode === "HIGH" ||
    config.thinkingMode === "MEDIUM" ||
    config.thinkingMode === "LOW";

  const effectiveRepeatPenalty =
    typeof config.frequencyPenalty === "number" && config.frequencyPenalty > 0
      ? 1.0 + config.frequencyPenalty * 0.5
      : config.localRepeatPenalty ?? 1.1;

  const bodyPayload: Record<string, any> = {
    model: config.model,
    messages: [{ role: "system", content: systemPrompt }, ...turns],
    stream: true,
    think: shouldThink,
    options: {
      temperature: config.temperature,
      num_ctx: config.localNumCtx ?? 16384,
      num_predict: config.maxTokens ?? 4096,
      top_k: config.topK ?? config.localTopK ?? 40,
      top_p: config.topP ?? config.localTopP ?? 0.9,
      repeat_penalty: effectiveRepeatPenalty,
      presence_penalty: config.presencePenalty ?? config.localPresencePenalty ?? 0.0,
    },
  };

  if (extras.jsonMode) bodyPayload.format = "json";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey && config.apiKey.trim().length > 0) {
    headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;
  }

  let res: Response;
  try {
    res = await fetch(primaryUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
      signal,
    });
  } catch (netErr) {
    if (signal?.aborted || isAbortError(netErr)) throw netErr;
    throw new LLMRequestError(
      formatApiError(netErr, undefined, undefined, config.baseUrl, config.model)
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new LLMRequestError(
      formatApiError(null, res.status, errText, config.baseUrl, config.model),
      res.status
    );
  }

  if (!res.body) throw new LLMRequestError("Ollama не предоставила поток данных.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let fullOutput = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((l) => l.trim().length > 0);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const token: string = parsed?.message?.content || parsed?.response || "";
        if (!token) continue;
        fullOutput += token;
        onChunk(cleanStreamTextForUI(fullOutput));
      } catch {}
    }
  }

  return fullOutput;
}

/**
 * Понятное имя узла для сообщений об ошибке (без query-параметров,
 * чтобы API-ключ не попал в текст на экране).
 */
export function describeEndpoint(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * Читает тело ответа как JSON. Если сервер вернул HTML (обычно это значит,
 * что запрос ушёл не на тот адрес и хостинг отдал index.html), пользователь
 * получит понятный текст вместо «Unexpected token '<'».
 */
export async function readJsonResponse(res: Response, url?: string): Promise<any> {
  const body = await res.text();
  const trimmed = body.trim();
  const host = url ? describeEndpoint(url) : "";
  const where = host ? ` (${host})` : "";

  if (trimmed.startsWith("<")) {
    throw new Error(
      `Сервер вернул HTML вместо JSON${where}. Проверьте адрес API и ключ: запрос, скорее всего, ушёл не туда.`
    );
  }

  // Часть агрегаторов отвечает потоком SSE даже на `stream: false`.
  // Склеиваем такой поток в обычную структуру, а не падаем на разборе.
  const sse = parseSseResponse(trimmed);
  if (sse) return sse;

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Ответ сервера${where} не является JSON: ${trimmed.slice(0, 200) || "(пустой ответ)"}`
    );
  }
}

/**
 * Разбирает SSE-ответ, пришедший на обычный (не стриминговый) запрос:
 * собирает дельты в `choices[0].message`, чтобы дальше работал общий разбор.
 */
function parseSseResponse(text: string): any | null {
  if (!text.includes("data:")) return null;

  let content = "";
  let reasoning = "";
  let lastPayload: any = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") continue;
    lastPayload = parsed;

    const delta = parsed?.choices?.[0]?.delta;
    if (!delta) continue;

    const parts = joinResponseParts(delta.content);
    content += parts.text;
    reasoning += parts.reasoning;
    reasoning += joinResponseParts(delta.reasoning_content ?? delta.reasoning).text;
  }

  if (!content && !reasoning) return lastPayload;

  return {
    ...(lastPayload ?? {}),
    choices: [
      {
        ...(lastPayload?.choices?.[0] ?? {}),
        message: { role: "assistant", content, reasoning_content: reasoning },
      },
    ],
  };
}

/** Same-origin путь прокси: совпадает с Edge Function Netlify (netlify.toml). */
export const LLM_PROXY_PATH = "/api/llm-proxy";

/**
 * Проблема именно на резервном канале, а не на стороне провайдера: браузер
 * заблокировал прямой запрос (CORS), а прокси на этом домене нет или он не
 * смог дойти до API. Раньше такой случай показывался как «Эндпоинт API не
 * найден (404). Проверьте URL» — и уводил в сторону от настоящей причины.
 */
export class ProxyChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyChannelError";
  }
}

/**
 * Ошибка обращения к провайдеру с сохранённым HTTP-кодом.
 *
 * Нужна фоновым задачам: по коду видно, отклонил ли провайдер дополнительные
 * поля запроса (400/422 — повторяем без них) или дело в ключе и лимите
 * (401/403/429 — повторять бессмысленно и дорого).
 */
export class LLMRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LLMRequestError";
    this.status = status;
  }
}

export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function proxyUnavailableMessage(url: string): string {
  return (
    `Браузер заблокировал прямой запрос к ${hostOf(url)} (CORS), а прокси ` +
    `${LLM_PROXY_PATH} на этом домене не отвечает.\n` +
    "Откройте приложение на Netlify-домене (там работает edge-функция) или запустите " +
    "локально: npm run dev поднимает прокси вместе с сервером."
  );
}

function proxyHostBlockedMessage(url: string): string {
  return (
    `Резервный прокси пропускает только api.ru-openrouter.ru, поэтому запрос к ` +
    `${hostOf(url)} заблокирован. Укажите адрес провайдера напрямую или доработайте ` +
    "allow-list прокси."
  );
}

function proxyUpstreamFailedMessage(url: string, status: number, details?: string): string {
  const reason = details?.trim() ? details.trim().slice(0, 160) : `код ${status}`;
  return (
    `Резервный прокси не смог соединиться с ${hostOf(url)}: ${reason}. ` +
    "Проверьте соединение и адрес API в Настройках."
  );
}

function isRuOpenRouterUrl(url: string): boolean {
  try {
    return new URL(url).hostname === RU_OPENROUTER_HOST;
  } catch {
    return false;
  }
}

async function fetchThroughProxy(url: string, options: RequestInit): Promise<Response> {
  const proxied = `${LLM_PROXY_PATH}?target=${encodeURIComponent(url)}`;

  let res: Response;
  try {
    res = await fetch(proxied, options);
  } catch (proxyErr) {
    if (options.signal?.aborted) throw proxyErr;
    throw new ProxyChannelError(proxyUnavailableMessage(url));
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = !res.ok || contentType.includes("text/html")
    ? await res.clone().text().catch(() => "")
    : "";

  // Если вместо Edge Function хостинг отдаёт SPA/404, прямой CORS-запрос
  // не должен быть единственным сообщением, которое видит пользователь.
  if (contentType.includes("text/html")) {
    throw new ProxyChannelError(proxyUnavailableMessage(url));
  }

  if (!res.ok) {
    if (!contentType.includes("json")) {
      throw new ProxyChannelError(proxyUnavailableMessage(url));
    }

    if (body.includes("Host not allowed")) {
      throw new ProxyChannelError(proxyHostBlockedMessage(url));
    }

    if (body.includes("Proxy fetch failed") || body.includes("target parameter")) {
      const details = (() => {
        try {
          return JSON.parse(body)?.details as string | undefined;
        } catch {
          return undefined;
        }
      })();

      throw new ProxyChannelError(proxyUpstreamFailedMessage(url, res.status, details));
    }
  }

  return res;
}

async function resilientFetch(
  url: string,
  options: RequestInit,
  allowProxy: boolean
): Promise<Response> {
  // RU OpenRouter не получает прямой browser-запрос: это исключает CORS до
  // начала запроса и делает Netlify/Vite proxy основным каналом, а не поздним
  // recovery после уже показанной браузером ошибки.
  if (allowProxy && isRuOpenRouterUrl(url)) {
    return fetchThroughProxy(url, options);
  }

  try {
    return await fetch(url, options);
  } catch (err) {
    // Пользователь отменил генерацию — не пытаемся идти через прокси.
    if (options.signal?.aborted) throw err;

    if (allowProxy && err instanceof TypeError) {
      return fetchThroughProxy(url, options);
    }

    throw err;
  }
}

/**
 * Сетевой запрос к провайдеру для тех, кто собирает запрос сам (генераторы
 * персонажа и группы). Для RU OpenRouter использует тот же same-origin proxy,
 * что и обычная генерация, а для остальных внешних провайдеров при CORS
 * повторяет запрос через `/api/llm-proxy`.
 */
export async function fetchFromProvider(
  url: string,
  options: RequestInit,
  config: ApiConfig,
  { useProxy }: { useProxy?: boolean } = {}
): Promise<Response> {
  const allowProxy = useProxy ?? !isLocalEndpoint(config.baseUrl);

  try {
    return await resilientFetch(url, options, allowProxy);
  } catch (cause) {
    throw new Error(
      formatApiError(cause, undefined, undefined, config.baseUrl, config.model)
    );
  }
}

async function callOpenAICompatibleStream(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk: (accumulatedText: string) => void,
  signal?: AbortSignal,
  extras: ChatRequestExtras = {}
): Promise<string> {
  const { primaryUrl, fallbackUrl } = resolveEndpoints(config.baseUrl);
  const isDeepSeek = isDeepSeekEndpoint(config);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey && config.apiKey.trim().length > 0) {
    headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;
  }

  const bodyPayload: Record<string, any> = {
    model: config.model || (isDeepSeek ? "deepseek-chat" : "openai/gpt-4o-mini"),
    messages: [{ role: "system", content: systemPrompt }, ...turns],
    stream: true,
    temperature: config.temperature,
    max_tokens: config.maxTokens ?? (isDeepSeek ? 8192 : 4096),
    top_p: config.topP ?? 0.9,
    presence_penalty: config.presencePenalty ?? 0.0,
    frequency_penalty: config.frequencyPenalty ?? 0.0,
  };

  if (typeof config.topK === "number") {
    bodyPayload.top_k = config.topK;
  }

  if (extras.jsonMode) {
    bodyPayload.response_format = { type: "json_object" };
  }

  if (extras.reasoningOff && canToggleReasoningOff(config)) {
    bodyPayload.reasoning = { enabled: false };
  }

  const allowProxy = !isLocalEndpoint(config.baseUrl);

  let res: Response;
  try {
    res = await resilientFetch(primaryUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
      signal,
    }, allowProxy);

    if (!res.ok && res.status === 404 && fallbackUrl) {
      res = await resilientFetch(fallbackUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
        signal,
      }, allowProxy);
    }
  } catch (netErr) {
    if (signal?.aborted || isAbortError(netErr)) throw netErr;
    throw new LLMRequestError(
      formatApiError(netErr, undefined, undefined, config.baseUrl, config.model)
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new LLMRequestError(
      formatApiError(null, res.status, errText, config.baseUrl, config.model),
      res.status
    );
  }

  if (!res.body) throw new LLMRequestError("Сервер не вернул поток данных (SSE).");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let fullOutput = "";
  let reasoningAccumulator = "";
  let providerErrorText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        const dataStr = line.slice(5).trim();
        if (dataStr === "[DONE]") break;
        try {
          const parsed = JSON.parse(dataStr);

          if (!providerErrorText) {
            const providerError = extractProviderError(parsed);
            if (providerError) providerErrorText = providerError;
          }

          const delta = parsed?.choices?.[0]?.delta;

          // Канал размышлений называется по-разному: reasoning_content,
          // reasoning, thinking. Запоминаем его целиком: если модель так и не
          // выдаст обычный текст, ответ (часто это готовый JSON) лежит здесь.
          const reasoningDelta = joinResponseParts(
            delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking
          ).text;
          if (reasoningDelta) {
            reasoningAccumulator += reasoningDelta;
          }

          const contentParts = joinResponseParts(delta?.content);
          if (contentParts.reasoning) {
            reasoningAccumulator += contentParts.reasoning;
          }

          const token = contentParts.text;
          if (token) {
            fullOutput += token;
            onChunk(cleanStreamTextForUI(fullOutput));
          }
        } catch {}
      }
    }
  }

  if (!fullOutput.trim() && !reasoningAccumulator.trim() && providerErrorText) {
    // Ошибка пришла прямо в потоке, текста нет — показываем причину, а не
    // «модель промолчала».
    throw new LLMRequestError(providerErrorText);
  }

  if (!fullOutput.trim() && reasoningAccumulator.trim()) {
    // «Думающая» модель израсходовала бюджет на размышления и не выдала
    // итоговый текст. Возвращаем размышления: служебные задачи (память,
    // хроника, синопсис) находят в них готовый JSON, а пустая строка раньше
    // молча оставляла разделы памяти без изменений.
    return reasoningAccumulator.trim();
  }

  if (
    reasoningAccumulator &&
    !extras.withoutThoughtPrefix &&
    !fullOutput.includes("```meta") &&
    !fullOutput.includes("<thought>")
  ) {
    const cleanThought = reasoningAccumulator.trim().slice(0, 500).replace(/\s+/g, " ");
    fullOutput = `<thought>${cleanThought}...</thought>\n` + fullOutput;
  }

  return fullOutput;
}

async function callGeminiStream(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk: (accumulatedText: string) => void,
  signal?: AbortSignal,
  extras: ChatRequestExtras = {}
): Promise<string> {
  const model = cleanGeminiModel(config.model);
  const apiKey = (config.apiKey || "").trim();

  if (!apiKey) {
    throw new Error("Укажите API-ключ Gemini в настройках.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const contents = sanitizeGeminiContents(turns);
  const thinkingConfig = buildGeminiThinkingConfig(model, geminiThinkingMode(config, extras));

  const generationConfig: Record<string, any> = {
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens ?? 4096,
    topP: config.topP ?? 0.95,
    ...(typeof config.topK === "number" ? { topK: config.topK } : {}),
    presencePenalty: config.presencePenalty ?? 0.0,
    frequencyPenalty: config.frequencyPenalty ?? 0.0,
    ...(extras.jsonMode ? { responseMimeType: "application/json" } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };

  const bodyPayload = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig,
    safetySettings: geminiSafetySettings,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
      signal,
    });
  } catch (netErr) {
    throw new Error(formatApiError(netErr));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(formatApiError(null, res.status, errText));
  }

  if (!res.body) {
    return callGemini(config, systemPrompt, turns, signal);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let fullOutput = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line || line.startsWith(":")) continue;

      if (line.startsWith("data:")) {
        line = line.slice(5).trim();
      }
      if (line === "[DONE]") break;

      if (line.startsWith("[")) line = line.slice(1).trim();
      if (line.endsWith("]")) line = line.slice(0, -1).trim();
      if (line.startsWith(",")) line = line.slice(1).trim();
      if (line.endsWith(",")) line = line.slice(0, -1).trim();

      if (!line || !line.startsWith("{")) continue;

      try {
        const parsed = JSON.parse(line);
        const candidate = parsed?.candidates?.[0];

        if (candidate?.finishReason === "SAFETY") {
          throw new Error("⚠️ Ответ заблокирован фильтром безопасности Gemini (SAFETY).");
        }

        const parts = candidate?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (p.thought) continue;
            if (typeof p.text === "string" && p.text) {
              fullOutput += p.text;
              onChunk(cleanStreamTextForUI(fullOutput));
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("SAFETY")) throw e;
      }
    }
  }

  if (!fullOutput || !fullOutput.trim()) {
    return callGemini(config, systemPrompt, turns, signal);
  }

  return fullOutput;
}

export async function callLLM(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
  extras: ChatRequestExtras = {}
): Promise<string> {
  const isStreamingEnabled =
    config.streamEnabled !== false &&
    config.localStreamEnabled !== false &&
    typeof onChunk === "function";

  if (config.mode === "gemini") {
    if (isStreamingEnabled && onChunk) {
      return callGeminiStream(config, systemPrompt, turns, onChunk, signal, extras);
    }
    return callGemini(config, systemPrompt, turns, signal, extras);
  }

  const isOllama = isOllamaEndpoint(config.baseUrl);

  if (isStreamingEnabled && onChunk) {
    if (isOllama) {
      return callOllamaStream(config, systemPrompt, turns, onChunk, signal, extras);
    }
    return callOpenAICompatibleStream(config, systemPrompt, turns, onChunk, signal, extras);
  }

  return callOpenAICompatible(config, systemPrompt, turns, signal, extras);
}

/** Ответ провайдера пустой: модель промолчала или ушла в размышления. */
export const EMPTY_ANSWER_MESSAGE =
  "Модель вернула пустой ответ: израсходовала лимит токенов на размышления или промолчала. " +
  "Повторите запрос, увеличьте лимит токенов в настройках или выберите модель без размышлений.";

/**
 * Провайдер может прислать ошибку внутри успешного ответа (HTTP 200): так
 * делают OpenRouter и его клоны, отдавая `choices[0].error` +
 * `finish_reason: "error"`, а отказ модели по фильтрам — полем
 * `message.refusal`. Раньше такой ответ выглядел как «модель промолчала»:
 * текст пустой, причина неизвестна. Теперь причину видно.
 */
function extractProviderError(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  const candidates = [
    data.error,
    choice?.error,
    choice?.message?.error,
    choice?.message?.refusal,
    choice?.refusal,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "object") {
      const message = candidate.message ?? candidate.detail ?? candidate.reason;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  }

  if (choice?.finish_reason === "error") {
    return "Провайдер вернул ошибку в ответе (finish_reason: error).";
  }

  return null;
}

/** Провайдер отклонил дополнительные поля запроса — их нужно убрать и повторить. */
function isParameterRejection(cause: unknown): boolean {
  const status = cause instanceof LLMRequestError ? cause.status : undefined;
  if (status === 400 || status === 422) return true;

  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  return /response_format|reasoning|unsupported|unknown parameter|invalid parameter|не поддерживается/.test(
    message
  );
}

/** Стоит ли повторять запрос другим способом (сеть, 5xx, странный формат ответа). */
function isRetryableRequestError(cause: unknown): boolean {
  if (isAbortError(cause)) return false;

  const status = cause instanceof LLMRequestError ? cause.status : undefined;
  if (status === 401 || status === 403 || status === 429) return false;

  return true;
}

/**
 * Служебный (фоновый) вызов модели: память, дневник, хроника, синопсис, выбор
 * говорящего, внекадровые тики — всё, у чего нет окна стрима в интерфейсе.
 *
 * Почему отдельный путь. Такой запрос раньше уходил «буферизованным»
 * (`stream: false`) и на агрегаторах вроде ru-openrouter.ru и polza.ai вёл себя
 * иначе, чем чат: ответ приходит только целиком, поэтому долгая генерация
 * обрывается прокси/шлюзом, а у «думающих» моделей готовый JSON вообще уезжает
 * в поле размышлений (`reasoning`/`reasoning_content`), оставляя `content`
 * пустым. Парсер видел пустую строку и молча ничего не сохранял — именно
 * поэтому хроника, дневник и память не собирались, а кнопка «Актуализировать»
 * крутила индикатор и ничего не делала. Чат на тех же провайдерах работал,
 * потому что стримится.
 *
 * Поэтому здесь:
 *  1) тот же стриминговый транспорт, что и у чата, но без вывода в интерфейс;
 *  2) JSON-режим и выключенные размышления, чтобы ответ пришёл в `content`;
 *  3) если провайдер не понял дополнительные поля (400/422) — повтор без них;
 *  4) если провайдер не умеет SSE или канал не подошёл — повтор обычным запросом.
 */
export async function callBackgroundLLM(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  options: { expectJson?: boolean; signal?: AbortSignal } = {}
): Promise<string> {
  const { expectJson = false, signal } = options;

  const supportsStreaming =
    config.streamEnabled !== false && config.localStreamEnabled !== false;

  const base: ChatRequestExtras = { expectJson, withoutThoughtPrefix: true };

  // Лестница дополнительных полей. Провайдеры по-разному относятся к
  // `response_format` и `reasoning`, и заранее это не угадать: кто-то молча
  // игнорирует, кто-то отвечает 400. Поэтому снимаем поля ПО ОДНОМУ, а не всё
  // сразу: JSON-режим заметно повышает шанс получить разборный ответ, и
  // расстаёмся с ним последним.
  const extrasVariants: ChatRequestExtras[] = expectJson
    ? [
        { ...base, jsonMode: true, reasoningOff: true },
        { ...base, jsonMode: true },
        base,
      ]
    : [{ ...base, reasoningOff: true }, base];

  // Первый канал — стриминг (как чат: он работает на всех этих провайдерах),
  // второй — обычный запрос (для тех, кто SSE не умеет). Внутри канала сначала
  // пробуем дополнительные поля, затем — без них.
  const channels = supportsStreaming ? [true, false] : [false, true];
  const MAX_ATTEMPTS = 6;

  let channelIndex = 0;
  let variantIndex = 0;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && channelIndex < channels.length; attempt += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const stream = channels[channelIndex];
    const extras = extrasVariants[Math.min(variantIndex, extrasVariants.length - 1)];

    try {
      const text = await callLLM(
        config,
        systemPrompt,
        turns,
        stream ? () => {} : undefined,
        signal,
        extras
      );

      if (text.trim()) return text;

      // Модель промолчала (или ответ ушёл в канал, которого нет в этом
      // формате) — пробуем другой транспорт.
      lastError = new Error(EMPTY_ANSWER_MESSAGE);
      channelIndex += 1;
    } catch (cause) {
      if (signal?.aborted || isAbortError(cause)) throw cause;

      lastError = cause;
      if (!isRetryableRequestError(cause)) throw cause;

      if (isParameterRejection(cause) && variantIndex < extrasVariants.length - 1) {
        // Провайдер не знает одно из полей — снимаем его и повторяем на том же
        // канале: стриминг и JSON-режим при этом сохраняются.
        variantIndex += 1;
        continue;
      }

      // Канал не подошёл (например, провайдер не умеет SSE): другой транспорт,
      // но с уже понятным набором полей.
      channelIndex += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(EMPTY_ANSWER_MESSAGE);
}

async function callOpenAICompatible(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
  extras: ChatRequestExtras = {}
): Promise<string> {
  const { isOllama, primaryUrl, fallbackUrl } = resolveEndpoints(config.baseUrl);
  const isDeepSeek = isDeepSeekEndpoint(config);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey && config.apiKey.trim().length > 0) {
    headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;
  }

  let bodyPayload: Record<string, any>;

  if (isOllama) {
    const shouldThink =
      config.thinkingMode === "HIGH" ||
      config.thinkingMode === "MEDIUM" ||
      config.thinkingMode === "LOW";

    const effectiveRepeatPenalty =
      typeof config.frequencyPenalty === "number" && config.frequencyPenalty > 0
        ? 1.0 + config.frequencyPenalty * 0.5
        : config.localRepeatPenalty ?? 1.1;

    bodyPayload = {
      model: config.model,
      messages: [{ role: "system", content: systemPrompt }, ...turns],
      stream: false,
      think: shouldThink,
      options: {
        temperature: config.temperature,
        num_ctx: config.localNumCtx ?? 16384,
        num_predict: config.maxTokens ?? 4096,
        top_k: config.topK ?? config.localTopK ?? 40,
        top_p: config.topP ?? config.localTopP ?? 0.9,
        repeat_penalty: effectiveRepeatPenalty,
        presence_penalty: config.presencePenalty ?? config.localPresencePenalty ?? 0.0,
      },
    };

    if (extras.jsonMode) bodyPayload.format = "json";
  } else {
    bodyPayload = {
      model: config.model || (isDeepSeek ? "deepseek-chat" : "openai/gpt-4o-mini"),
      messages: [{ role: "system", content: systemPrompt }, ...turns],
      stream: false,
      temperature: config.temperature,
      max_tokens: config.maxTokens ?? (isDeepSeek ? 8192 : 4096),
      top_p: config.topP ?? 0.9,
      presence_penalty: config.presencePenalty ?? 0.0,
      frequency_penalty: config.frequencyPenalty ?? 0.0,
    };

    if (typeof config.topK === "number") {
      bodyPayload.top_k = config.topK;
    }

    if (extras.jsonMode) {
      bodyPayload.response_format = { type: "json_object" };
    }

    if (extras.reasoningOff && canToggleReasoningOff(config)) {
      bodyPayload.reasoning = { enabled: false };
    }
  }

  const allowProxy = !isLocalEndpoint(config.baseUrl);

  let res: Response;
  try {
    res = await resilientFetch(primaryUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
      signal,
    }, allowProxy);

    if (!res.ok && res.status === 404 && fallbackUrl) {
      res = await resilientFetch(fallbackUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
        signal,
      }, allowProxy);
    }
  } catch (netErr) {
    if (signal?.aborted || isAbortError(netErr)) throw netErr;
    throw new LLMRequestError(
      formatApiError(netErr, undefined, undefined, config.baseUrl, config.model)
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new LLMRequestError(
      formatApiError(null, res.status, errText, config.baseUrl, config.model),
      res.status
    );
  }

  const data = await readJsonResponse(res);
  const extracted = extractResponseText(data, { preferJson: Boolean(extras.expectJson) });
  let content = extracted.text;

  // Провайдер ответил 200, но внутри — ошибка (OpenRouter-семейство отдаёт
  // `choices[0].error` с finish_reason: "error"). Без этой проверки причина
  // терялась, и разделы памяти просто оставались пустыми.
  if (!content.trim()) {
    const providerError = extractProviderError(data);
    if (providerError) throw new LLMRequestError(providerError);
  }

  // Показываем «мысли» модели в чате, но не подменяем ими сам ответ.
  if (
    content &&
    extracted.source === "content" &&
    extracted.reasoning &&
    !extras.withoutThoughtPrefix &&
    !content.includes("```meta") &&
    !content.includes("<thought>")
  ) {
    const cleanThought = extracted.reasoning.slice(0, 500).replace(/\s+/g, " ");
    content = `<thought>${cleanThought}...</thought>\n` + content;
  }

  if (!content) throw new LLMRequestError(EMPTY_ANSWER_MESSAGE);
  return content;
}

async function callGemini(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
  extras: ChatRequestExtras = {}
): Promise<string> {
  const model = cleanGeminiModel(config.model);
  const apiKey = (config.apiKey || "").trim();

  if (!apiKey) {
    throw new Error("Укажите API-ключ Gemini в настройках.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const contents = sanitizeGeminiContents(turns);
  const thinkingConfig = buildGeminiThinkingConfig(model, geminiThinkingMode(config, extras));

  const generationConfig: Record<string, any> = {
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens ?? 4096,
    topP: config.topP ?? 0.95,
    ...(typeof config.topK === "number" ? { topK: config.topK } : {}),
    presencePenalty: config.presencePenalty ?? 0.0,
    frequencyPenalty: config.frequencyPenalty ?? 0.0,
    ...(extras.jsonMode ? { responseMimeType: "application/json" } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };

  const bodyPayload = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig,
    safetySettings: geminiSafetySettings,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
      signal,
    });
  } catch (netErr) {
    if (signal?.aborted || isAbortError(netErr)) throw netErr;
    throw new LLMRequestError(formatApiError(netErr));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new LLMRequestError(formatApiError(null, res.status, errText), res.status);
  }

  const data = await readJsonResponse(res, url);
  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const blockReason = data?.promptFeedback?.blockReason;

  if (finishReason === "SAFETY" || blockReason === "SAFETY") {
    throw new Error("⚠️ Ответ заблокирован цензором безопасности Gemini (SAFETY).");
  }

  if (finishReason && finishReason !== "STOP") {
    throw new Error(`Ответ остановлен Gemini с кодом: ${finishReason}.`);
  }

  const parts = candidate?.content?.parts;
  let text = "";
  if (Array.isArray(parts)) {
    text = parts
      .filter((p: any) => !p.thought)
      .map((p: any) => p.text ?? "")
      .join("")
      .trim();
  }

  if (typeof text !== "string" || !text) throw new Error("Gemini вернул пустой ответ.");
  return text;
}

export async function requestRoleplayReply(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk?: (streamedText: string) => void,
  baseStats?: import("../types").RelationshipStats,
  signal?: AbortSignal
): Promise<ParsedResponse> {
  const raw = await callLLM(config, systemPrompt, turns, onChunk, signal);
  return parseMetaBlock(raw, baseStats);
}

export interface ConnectionTestResult {
  /** Соединение и ключ в порядке, модель ответила. */
  ok: boolean;
  /** Короткий ответ модели либо понятное объяснение ошибки. */
  message: string;
  /** Сколько миллисекунд занял запрос — видно, насколько провайдер близко. */
  ms: number;
  /** Модель, к которой обращались (из настроек). */
  model: string;
  /** Тест отменён игроком, а не провалился. */
  cancelled?: boolean;
}

/** Насколько длинный ответ модели показываем в отчёте. */
const CONNECTION_TEST_ANSWER_LIMIT = 200;

const CONNECTION_TEST_PROMPT =
  "Ты — служебная проверка соединения. Ответь одной короткой фразой, что связь есть. Без мета-блоков, тегов и пояснений.";

/**
 * Короткий запрос к модели, чтобы игрок сразу видел: соединение, ключ и
 * выбранная модель рабочие. Идёт ровно тем же путём, что и обычная генерация
 * (включая резервный прокси), но без стриминга и без истории.
 */
export async function testConnection(
  config: ApiConfig,
  signal?: AbortSignal
): Promise<ConnectionTestResult> {
  const startedAt = Date.now();
  const model = (config.model || "").trim();

  const finish = (
    ok: boolean,
    message: string,
    extra: { cancelled?: boolean } = {}
  ): ConnectionTestResult => ({
    ok,
    message,
    ms: Date.now() - startedAt,
    model: model || "—",
    ...extra,
  });

  try {
    const answer = await callLLM(
      { ...config, streamEnabled: false },
      CONNECTION_TEST_PROMPT,
      [{ role: "user", content: "Проверка связи. Ответь одной короткой фразой." }],
      undefined,
      signal
    );

    const clean = answer
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
      .replace(/```[\s\S]*?```/g, "")
      .trim()
      .slice(0, CONNECTION_TEST_ANSWER_LIMIT);

    if (!clean) {
      return finish(true, "Провайдер ответил, но текст ответа пустой.");
    }

    return finish(true, clean);
  } catch (cause) {
    if (signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) {
      return finish(false, "Проверка отменена.", { cancelled: true });
    }

    // Провайдер ответил, но модель промолчала: сам канал рабочий, и это важно
    // не путать с обрывом связи — иначе игрок пойдёт чинить настройки.
    if (cause instanceof Error && /пустой ответ/i.test(cause.message)) {
      return finish(true, "Провайдер ответил, но модель вернула пустой текст.");
    }

    return finish(
      false,
      cause instanceof Error && cause.message
        ? cause.message
        : "Не удалось получить ответ от модели."
    );
  }
}

export async function requestSummary(
  config: ApiConfig,
  characterName: string,
  oldTurnsText: string
): Promise<string> {
  const systemPrompt = `Ты — литературный редактор. Тебе дана расшифровка диалога с персонажем "${characterName}". Сформируй сжатую сводку ключевых событий, тайн и эмоциональных сдвигов в 3-4 предложениях на русском языке.`;
  const turns: ChatTurn[] = [{ role: "user", content: oldTurnsText }];
  const raw = await callLLM(config, systemPrompt, turns);
  return raw.trim();
}

export async function requestSuggestedReplies(
  apiConfig: ApiConfig,
  characterName: string,
  userName: string,
  transcript: string,
  naturalSpeech: boolean = false,
  directorNotes?: string
): Promise<string[]> {
  const naturalSpeechInstruction = naturalSpeech
    ? `\n- СТИЛЬ РЕЧИ: Естественная разговорная речь реального человека или СМС в мессенджере.`
    : "";

  const directorContext = directorNotes?.trim()
    ? `\nРЕЖИССЁРСКИЙ КОНТЕКСТ:\n«${directorNotes.trim()}»\n`
    : "";

  const prompt = `Ты — нарративный помощник в ролевой игре.
На основе событий между ${characterName} и игроком (${userName}) предложи ровно 3 коротких варианта действия/ответа для игрока (${userName}).
${directorContext}
${naturalSpeechInstruction}
ПРЕДЫДУЩИЙ ДИАЛОГ:
${transcript}

ФОРМАТ ОТВЕТА СТРОГО В ВИДЕ JSON:
{
  "suggestions": [
    "вариант 1",
    "вариант 2",
    "вариант 3"
  ]
}`;

  let raw = "";

  try {
    if (apiConfig.mode === "gemini") {
      const model = cleanGeminiModel(apiConfig.model);
      const apiKey = (apiConfig.apiKey || "").trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
          safetySettings: geminiSafetySettings,
        }),
      });
      if (!res.ok) return [];
      const data = await readJsonResponse(res, url);
      raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else {
      const { isOllama, primaryUrl, fallbackUrl } = resolveEndpoints(apiConfig.baseUrl);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiConfig.apiKey && apiConfig.apiKey.trim().length > 0) {
        headers["Authorization"] = `Bearer ${apiConfig.apiKey.trim()}`;
      }

      const bodyPayload: Record<string, any> = {
        model: apiConfig.model || "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        stream: false,
      };

      if (isOllama) {
        bodyPayload.think = false;
        bodyPayload.options = { num_ctx: 8192 };
      } else {
        bodyPayload.response_format = { type: "json_object" };
      }

      const allowProxy = !isLocalEndpoint(apiConfig.baseUrl);

      let res = await resilientFetch(primaryUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
      }, allowProxy);

      if (!res.ok && res.status === 404 && fallbackUrl) {
        res = await resilientFetch(fallbackUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyPayload),
        }, allowProxy);
      }

      if (!res.ok) return [];
      const data = await readJsonResponse(res);
      raw = extractResponseContent(data);
    }

    return parseSuggestionsFromRaw(raw);
  } catch (err) {
    console.error("Ошибка при получении подсказок:", err);
    return [];
  }
}

function parseSuggestionsFromRaw(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  let cleaned = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```$/m, "").trim();

  const firstBrace = cleaned.search(/[\{\[]/);
  const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map(String).slice(0, 3);
    if (parsed.suggestions && Array.isArray(parsed.suggestions)) return parsed.suggestions.map(String).slice(0, 3);
    if (parsed.replies && Array.isArray(parsed.replies)) return parsed.replies.map(String).slice(0, 3);
    if (parsed.options && Array.isArray(parsed.options)) return parsed.options.map(String).slice(0, 3);
  } catch {}

  const extracted: string[] = [];
  const lineMatches = raw.match(/(?:^|\n)\s*(?:\d+[\.\)]|\-|\*)\s*(.+)/g);
  if (lineMatches && lineMatches.length > 0) {
    for (const m of lineMatches) {
      const cleanLine = m.replace(/(?:^|\n)\s*(?:\d+[\.\)]|\-|\*)\s*/, "").replace(/^["'`]|["'`]$/g, "").trim();
      if (cleanLine && cleanLine.length > 2) extracted.push(cleanLine);
    }
  }

  return extracted.slice(0, 3);
}

export async function requestImagePrompt(
  apiConfig: ApiConfig,
  character: { name: string; description?: string; personality?: string; tagline?: string },
  style: string,
  type: "avatar" | "wallpaper"
): Promise<string> {
  const typeInstruction =
    type === "avatar"
      ? "Create a close-up portrait focusing on beautiful facial features, expressive eyes, hair, and soft flattering light."
      : "Create an aesthetic atmospheric lifestyle scene photo featuring the character in a cozy environment.";

  const systemInstruction = `You are a master AI Art Prompt Engineer. Generate a single prompt in ENGLISH for an attractive image.
SELECTED STYLE: ${style}
FRAME TYPE: ${typeInstruction}
OUTPUT ONLY THE RAW PROMPT STRING.`;

  const userContext = `Name: ${character.name}\nTagline: ${character.tagline || ""}\nDescription: ${character.description || ""}`;
  let raw = "";

  try {
    if (apiConfig.mode === "gemini") {
      const model = cleanGeminiModel(apiConfig.model);
      const apiKey = (apiConfig.apiKey || "").trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${systemInstruction}\n\n${userContext}` }] }],
          generationConfig: { temperature: 0.7 },
          safetySettings: geminiSafetySettings,
        }),
      });
      if (!res.ok) throw new Error("Gemini Prompt Error");
      const data = await readJsonResponse(res, url);
      raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else {
      const { isOllama, primaryUrl, fallbackUrl } = resolveEndpoints(apiConfig.baseUrl);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiConfig.apiKey && apiConfig.apiKey.trim().length > 0) {
        headers["Authorization"] = `Bearer ${apiConfig.apiKey.trim()}`;
      }

      const bodyPayload: Record<string, any> = {
        model: apiConfig.model || "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userContext },
        ],
        stream: false,
        temperature: 0.7,
      };

      if (isOllama) {
        bodyPayload.think = false;
        bodyPayload.options = { num_ctx: 4096 };
      }

      const allowProxy = !isLocalEndpoint(apiConfig.baseUrl);

      let res = await resilientFetch(primaryUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
      }, allowProxy);

      if (!res.ok && res.status === 404 && fallbackUrl) {
        res = await resilientFetch(fallbackUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyPayload),
        }, allowProxy);
      }

      if (!res.ok) throw new Error("API Prompt Error");
      const data = await readJsonResponse(res);
      raw = extractResponseContent(data);
    }
  } catch (err) {
    throw new Error(formatApiError(err, undefined, undefined, apiConfig.baseUrl, apiConfig.model));
  }

  return raw.replace(/^["'`]+|["'`]+$/g, "").trim();
}

export async function fetchAvailableModels(apiConfig: ApiConfig): Promise<string[]> {
  try {
    if (apiConfig.mode === "gemini") {
      const apiKey = (apiConfig.apiKey || "").trim();
      if (!apiKey) throw new Error("Сначала укажите API-ключ Gemini в настройках.");
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(formatApiError(null, res.status, errText));
      }
      const data = await readJsonResponse(res, url);
      const models: string[] = (data.models || [])
        .map((m: { name?: string }) => (m.name ? m.name.replace(/^models\//, "") : ""))
        .filter((name: string) => name.includes("gemini") || name.includes("flash") || name.includes("pro"));
      return models.length > 0 ? models : ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    } else {
      if (!apiConfig.baseUrl) throw new Error("Сначала укажите Base URL в настройках.");
      const cleanUrl = normalizeRuOpenRouterUrl(apiConfig.baseUrl).replace(/\/+$/, "");

      const headers: Record<string, string> = {};
      if (apiConfig.apiKey && apiConfig.apiKey.trim().length > 0) {
        headers["Authorization"] = `Bearer ${apiConfig.apiKey.trim()}`;
      }

      const allowProxy = !isLocalEndpoint(apiConfig.baseUrl);
      let lastError: unknown = null;

      const rootUrl = cleanUrl.replace(/\/(v1|api)(\/.*)?$/, "");
      try {
        const reqHeaders = Object.keys(headers).length > 0 ? headers : undefined;
        const ollamaRes = await resilientFetch(`${rootUrl}/api/tags`, { headers: reqHeaders }, allowProxy);
        if (ollamaRes.ok) {
          const ollamaData = await readJsonResponse(ollamaRes);
          if (Array.isArray(ollamaData.models) && ollamaData.models.length > 0) {
            return ollamaData.models
              .map((m: { name?: string; model?: string }) => m.name || m.model)
              .filter((name: unknown): name is string => typeof name === "string" && name.length > 0);
          }
        }
      } catch (err) {
        lastError = err;
      }

      const standardModelsUrl = cleanUrl.endsWith("/models")
        ? cleanUrl
        : cleanUrl.endsWith("/v1")
          ? `${cleanUrl}/models`
          : `${cleanUrl}/v1/models`;

      try {
        const reqHeaders = Object.keys(headers).length > 0 ? headers : undefined;
        const res = await resilientFetch(standardModelsUrl, { headers: reqHeaders }, allowProxy);
        if (res.ok) {
          const data = await readJsonResponse(res);
          if (Array.isArray(data.data) && data.data.length > 0) {
            return data.data
              .map((m: { id?: string }) => m.id)
              .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
          } else if (Array.isArray(data) && data.length > 0) {
            return data
              .map((m: { id?: string; name?: string }) => m.id || m.name)
              .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
          }
        }
      } catch (err) {
        lastError = err;
      }

      if (lastError) {
        throw new Error(formatApiError(lastError, undefined, undefined, apiConfig.baseUrl));
      }

      return [];
    }
  } catch (err) {
    throw new Error(formatApiError(err, undefined, undefined, apiConfig.baseUrl, apiConfig.model));
  }
}