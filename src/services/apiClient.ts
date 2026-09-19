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

export function isDeepSeekEndpoint(config: ApiConfig): boolean {
  const base = (config.baseUrl || "").toLowerCase();
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
  const clean = (baseUrl || "").trim().replace(/\/+$/, "");

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

export function messagesToTurns(messages: Message[]): ChatTurn[] {
  return messages
    .filter((m) => m.sender !== "system")
    .map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.swipes[m.currentSwipeIndex] ?? "",
    }));
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

function extractResponseContent(data: any): string {
  const choiceMsg = data?.choices?.[0]?.message;
  const directMsg = data?.message;

  let raw = "";

  if (choiceMsg && typeof choiceMsg.content === "string" && choiceMsg.content.trim().length > 0) {
    raw = choiceMsg.content.trim();
  } else if (directMsg && typeof directMsg.content === "string" && directMsg.content.trim().length > 0) {
    raw = directMsg.content.trim();
  } else if (typeof data?.response === "string" && data.response.trim().length > 0) {
    raw = data.response.trim();
  }

  if (!raw) {
    if (choiceMsg && typeof choiceMsg.reasoning_content === "string" && choiceMsg.reasoning_content.trim().length > 0) {
      raw = choiceMsg.reasoning_content.trim();
    } else if (directMsg && typeof directMsg.reasoning_content === "string" && directMsg.reasoning_content.trim().length > 0) {
      raw = directMsg.reasoning_content.trim();
    }
  }

  if (!raw) return "";

  if (raw.includes("</think>")) {
    const parts = raw.split("</think>");
    const reply = parts[parts.length - 1].trim();
    if (reply.length > 0) return reply;
  }

  if (raw.includes("<think>")) {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/gi, "").trim();
    if (cleaned.length > 0) return cleaned;
  }

  return raw;
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

async function callOllamaStream(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk: (accumulatedText: string) => void
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

  const bodyPayload = {
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

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey && config.apiKey.trim().length > 0) {
    headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;
  }

  const res = await fetch(primaryUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(formatApiError(null, res.status, errText, config.baseUrl, config.model));
  }

  if (!res.body) throw new Error("Ollama не предоставила поток данных.");

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

async function resilientFetch(
  url: string,
  options: RequestInit,
  allowProxy: boolean
): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (allowProxy && err instanceof TypeError) {
      const proxied = `/api/llm-proxy?target=${encodeURIComponent(url)}`;
      return await fetch(proxied, options);
    }
    throw err;
  }
}

async function callOpenAICompatibleStream(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk: (accumulatedText: string) => void
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

  const allowProxy = !isLocalEndpoint(config.baseUrl);

  let res: Response;
  try {
    res = await resilientFetch(primaryUrl, {
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
  } catch (netErr) {
    throw new Error(formatApiError(netErr, undefined, undefined, config.baseUrl, config.model));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(formatApiError(null, res.status, errText, config.baseUrl, config.model));
  }

  if (!res.body) throw new Error("Сервер не вернул поток данных (SSE).");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let fullOutput = "";
  let reasoningAccumulator = "";
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
          const delta = parsed?.choices?.[0]?.delta;

          if (delta?.reasoning_content) {
            reasoningAccumulator += delta.reasoning_content;
            continue;
          }

          const token = delta?.content || "";
          if (token) {
            fullOutput += token;
            onChunk(cleanStreamTextForUI(fullOutput));
          }
        } catch {}
      }
    }
  }

  if (reasoningAccumulator && !fullOutput.includes("```meta") && !fullOutput.includes("<thought>")) {
    const cleanThought = reasoningAccumulator.trim().slice(0, 500).replace(/\s+/g, " ");
    fullOutput = `<thought>${cleanThought}...</thought>\n` + fullOutput;
  }

  return fullOutput;
}

async function callGeminiStream(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk: (accumulatedText: string) => void
): Promise<string> {
  const model = cleanGeminiModel(config.model);
  const apiKey = (config.apiKey || "").trim();

  if (!apiKey) {
    throw new Error("Укажите API-ключ Gemini в настройках.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const contents = sanitizeGeminiContents(turns);
  const thinkingConfig = buildGeminiThinkingConfig(model, config.thinkingMode);

  const generationConfig: Record<string, any> = {
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens ?? 4096,
    topP: config.topP ?? 0.95,
    ...(typeof config.topK === "number" ? { topK: config.topK } : {}),
    presencePenalty: config.presencePenalty ?? 0.0,
    frequencyPenalty: config.frequencyPenalty ?? 0.0,
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
    });
  } catch (netErr) {
    throw new Error(formatApiError(netErr));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(formatApiError(null, res.status, errText));
  }

  if (!res.body) {
    return callGemini(config, systemPrompt, turns);
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
    return callGemini(config, systemPrompt, turns);
  }

  return fullOutput;
}

export async function callLLM(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[],
  onChunk?: (text: string) => void
): Promise<string> {
  const isStreamingEnabled =
    config.streamEnabled !== false &&
    config.localStreamEnabled !== false &&
    typeof onChunk === "function";

  if (config.mode === "gemini") {
    if (isStreamingEnabled && onChunk) {
      return callGeminiStream(config, systemPrompt, turns, onChunk);
    }
    return callGemini(config, systemPrompt, turns);
  }

  const isLocal = isLocalEndpoint(config.baseUrl);
  const isOllama = isOllamaEndpoint(config.baseUrl);

  if (isStreamingEnabled && onChunk) {
    if (isOllama) {
      return callOllamaStream(config, systemPrompt, turns, onChunk);
    }
    return callOpenAICompatibleStream(config, systemPrompt, turns, onChunk);
  }

  return callOpenAICompatible(config, systemPrompt, turns);
}

async function callOpenAICompatible(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[]
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
  }

  const allowProxy = !isLocalEndpoint(config.baseUrl);

  let res: Response;
  try {
    res = await resilientFetch(primaryUrl, {
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
  } catch (netErr) {
    throw new Error(formatApiError(netErr, undefined, undefined, config.baseUrl, config.model));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(formatApiError(null, res.status, errText, config.baseUrl, config.model));
  }

  const data = await res.json();
  const choice = data?.choices?.[0]?.message;
  let content = extractResponseContent(data);

  if (choice?.reasoning_content && !content.includes("```meta") && !content.includes("<thought>")) {
    const cleanThought = choice.reasoning_content.trim().slice(0, 500).replace(/\s+/g, " ");
    content = `<thought>${cleanThought}...</thought>\n` + content;
  }

  if (!content) throw new Error("Модель вернула пустой ответ.");
  return content;
}

async function callGemini(
  config: ApiConfig,
  systemPrompt: string,
  turns: ChatTurn[]
): Promise<string> {
  const model = cleanGeminiModel(config.model);
  const apiKey = (config.apiKey || "").trim();

  if (!apiKey) {
    throw new Error("Укажите API-ключ Gemini в настройках.");
  }

  const url = `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){model}:generateContent?key=${apiKey}`;
  const contents = sanitizeGeminiContents(turns);
  const thinkingConfig = buildGeminiThinkingConfig(model, config.thinkingMode);

  const generationConfig: Record<string, any> = {
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens ?? 4096,
    topP: config.topP ?? 0.95,
    ...(typeof config.topK === "number" ? { topK: config.topK } : {}),
    presencePenalty: config.presencePenalty ?? 0.0,
    frequencyPenalty: config.frequencyPenalty ?? 0.0,
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
    });
  } catch (netErr) {
    throw new Error(formatApiError(netErr));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(formatApiError(null, res.status, errText));
  }

  const data = await res.json();
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
  baseStats?: import("../types").RelationshipStats
): Promise<ParsedResponse> {
  const raw = await callLLM(config, systemPrompt, turns, onChunk);
  return parseMetaBlock(raw, baseStats);
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
      const url = `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){model}:generateContent?key=${apiKey}`;
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
      const data = await res.json();
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
      const data = await res.json();
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
      const url = `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){model}:generateContent?key=${apiKey}`;
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
      const data = await res.json();
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
      const data = await res.json();
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
      const url = `[https://generativelanguage.googleapis.com/v1beta/models?key=$](https://generativelanguage.googleapis.com/v1beta/models?key=$){apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(formatApiError(null, res.status, errText));
      }
      const data = await res.json();
      const models: string[] = (data.models || [])
        .map((m: { name?: string }) => (m.name ? m.name.replace(/^models\//, "") : ""))
        .filter((name: string) => name.includes("gemini") || name.includes("flash") || name.includes("pro"));
      return models.length > 0 ? models : ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    } else {
      if (!apiConfig.baseUrl) throw new Error("Сначала укажите Base URL в настройках.");
      const cleanUrl = apiConfig.baseUrl.trim().replace(/\/+$/, "");

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
          const ollamaData = await ollamaRes.json();
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
          const data = await res.json();
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