// =============================================================
// CHARACTER DNA (V2) — СЛОЙ ЗАПРОСОВ К ПРОВАЙДЕРАМ
//
// Собственный путь V2 до модели: тот же набор низкоуровневых примитивов
// (fetchFromProvider, resolveEndpoints, readJsonResponse, formatApiError),
// что и у V1, но без зависимости от внутренних функций V1-генератора.
//
// Поддержаны все три класса провайдеров:
//  - Gemini (responseMimeType: application/json);
//  - OpenAI-совместимые (response_format: json_object);
//  - Ollama/локальные (format: "json", think: false).
// =============================================================

import type { ApiConfig } from "../../types";
import {
  fetchFromProvider,
  formatApiError,
  readJsonResponse,
  resolveEndpoints,
} from "../apiClient";
import { extractJsonBlock } from "../jsonRepair";

export type V2JsonErrorKind =
  | "empty"
  | "no_json"
  | "invalid_json"
  | "incomplete_json"
  | "output_limit";

export interface V2UsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Метаданные завершения, которые провайдеры возвращают вместе с текстом. */
export interface V2ResponseMetadata {
  provider: "gemini" | "openai-compatible";
  finishReason?: string;
  usage?: V2UsageMetadata;
  rawTextLength: number;
  /** JSON-блок не закрылся в полученном тексте. */
  incompleteJson?: boolean;
}

/** Ответ модели не удалось разобрать в JSON. */
export class V2JsonError extends Error {
  readonly kind: V2JsonErrorKind;
  readonly metadata?: V2ResponseMetadata;
  /** Используется только для компактного correction; не показывается в UI/логах. */
  readonly rawText?: string;

  constructor(
    message: string,
    kind: V2JsonErrorKind = "invalid_json",
    metadata?: V2ResponseMetadata,
    rawText?: string
  ) {
    super(message);
    this.name = "V2JsonError";
    this.kind = kind;
    this.metadata = metadata;
    this.rawText = rawText;
  }
}

/** Провайдер сообщил, что генерация упёрлась в лимит output-токенов. */
export class V2OutputLimitError extends V2JsonError {
  constructor(message: string, metadata?: V2ResponseMetadata) {
    super(message, "output_limit", metadata);
    this.name = "V2OutputLimitError";
  }
}

/** Ответ HTTP 200 содержит отказ/ошибку провайдера вместо результата модели. */
export class V2ProviderError extends Error {
  readonly metadata?: V2ResponseMetadata;

  constructor(message: string, metadata?: V2ResponseMetadata) {
    super(message);
    this.name = "V2ProviderError";
    this.metadata = metadata;
  }
}

export interface V2Turn {
  role: "user" | "assistant" | "model";
  content: string;
}

export interface V2JsonResult<T = any> {
  value: T;
  rawText: string;
  metadata: V2ResponseMetadata;
}

/**
 * Достаёт текст из форматов разных провайдеров (части Gemini,
 * choices OpenAI, message Ollama, включая «думающие» модели).
 */
function extractModelText(data: any): string {
  if (!data || typeof data !== "object") return "";

  const geminiParts = data.candidates?.[0]?.content?.parts;
  if (Array.isArray(geminiParts)) {
    const textOf = (onlyAnswer: boolean) =>
      geminiParts
        .filter((part: any) => (onlyAnswer ? !part?.thought : true))
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim();

    const answer = textOf(true);
    if (answer) return answer;

    const everything = textOf(false);
    if (everything) return everything;
  }

  const candidates = [
    data.choices?.[0]?.message?.content,
    data.choices?.[0]?.text,
    data.message?.content,
    data.response,
    data.output_text,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const joined = value
        .map((part: any) =>
          typeof part === "string"
            ? part
            : typeof part?.text === "string"
            ? part.text
            : ""
        )
        .join("")
        .trim();
      if (joined) return joined;
    }
  }

  const reasoning =
    data.choices?.[0]?.message?.reasoning_content ??
    data.choices?.[0]?.message?.reasoning;
  if (typeof reasoning === "string" && reasoning.includes("{")) return reasoning;

  return "";
}

function usageMetadata(data: any): V2UsageMetadata | undefined {
  const raw = data?.usage ?? data?.usageMetadata;
  if (!raw || typeof raw !== "object") return undefined;

  const inputTokens =
    raw.prompt_tokens ??
    raw.promptTokenCount ??
    raw.input_tokens ??
    raw.inputTokenCount ??
    raw.prompt_eval_count;
  const outputTokens =
    raw.completion_tokens ??
    raw.candidatesTokenCount ??
    raw.output_tokens ??
    raw.outputTokenCount ??
    raw.eval_count;
  const totalTokens =
    raw.total_tokens ??
    raw.totalTokenCount ??
    (typeof raw.prompt_eval_count === "number" && typeof raw.eval_count === "number"
      ? raw.prompt_eval_count + raw.eval_count
      : undefined);

  const result: V2UsageMetadata = {};
  if (typeof inputTokens === "number" && Number.isFinite(inputTokens)) {
    result.inputTokens = inputTokens;
  }
  if (typeof outputTokens === "number" && Number.isFinite(outputTokens)) {
    result.outputTokens = outputTokens;
  }
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
    result.totalTokens = totalTokens;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function responseMetadata(
  data: any,
  rawText: string,
  provider: V2ResponseMetadata["provider"]
): V2ResponseMetadata {
  const choice = data?.choices?.[0];
  const candidate = data?.candidates?.[0];
  const message = data?.message;
  const finishReason =
    choice?.finish_reason ??
    choice?.finishReason ??
    choice?.stop_reason ??
    candidate?.finishReason ??
    candidate?.finish_reason ??
    candidate?.stopReason ??
    candidate?.stop_reason ??
    message?.done_reason ??
    message?.doneReason ??
    data?.done_reason ??
    data?.doneReason ??
    data?.finish_reason ??
    data?.stop_reason;

  return {
    provider,
    ...(typeof finishReason === "string" && finishReason.trim()
      ? { finishReason: finishReason.trim() }
      : {}),
    usage: usageMetadata(data),
    rawTextLength: rawText.length,
  };
}

function isOutputLimitReason(reason?: string): boolean {
  if (!reason) return false;
  return /^(length|max_tokens|max_tokens_reached|maximum_tokens|token_limit)$/i.test(
    reason.trim()
  );
}

function isNormalFinishReason(reason?: string): boolean {
  if (!reason) return true;
  return /^(stop|end_turn|completed|complete)$/i.test(reason.trim());
}

function providerErrorMessage(data: any): string | null {
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
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 240);
    }
    if (typeof candidate === "object") {
      const message = candidate.message ?? candidate.detail ?? candidate.reason;
      if (typeof message === "string" && message.trim()) {
        return message.trim().slice(0, 240);
      }
    }
  }

  if (choice?.finish_reason === "error") {
    return "Провайдер вернул ошибку в ответе (finish_reason: error).";
  }

  const blockReason =
    data.promptFeedback?.blockReason ??
    data.prompt_feedback?.block_reason ??
    data.blockReason ??
    data.block_reason;
  if (typeof blockReason === "string" && blockReason.trim()) {
    return `Провайдер заблокировал ответ (${blockReason.trim().slice(0, 120)}).`;
  }

  return null;
}

/** Терпимый разбор, сохранённый для старых V2/Group DNA вызовов. */
export function parseV2Json(raw: string): any {
  const text = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const extracted = extractJsonBlock(text);

  if (!extracted) {
    throw new V2JsonError(
      text
        ? `Модель ответила текстом вместо JSON: «${text.slice(0, 160)}».`
        : "Модель вернула пустой ответ.",
      text ? "no_json" : "empty"
    );
  }

  try {
    return JSON.parse(extracted.block);
  } catch {
    if (extracted.closers) {
      try {
        return JSON.parse(extracted.block + extracted.closers);
      } catch {
        // уходим в ошибку ниже
      }
    }
    throw new V2JsonError("Модель вернула некорректный JSON.", "invalid_json");
  }
}

function parseV2JsonStrict(
  raw: string,
  metadata: V2ResponseMetadata
): any {
  const text = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  // Проверяем finish_reason до попытки угадать структуру: при MAX_TOKENS
  // даже случайно разобравшийся префикс нельзя считать полным ответом.
  if (isOutputLimitReason(metadata.finishReason)) {
    throw new V2OutputLimitError(
      `Генерация остановлена провайдером по лимиту вывода (${metadata.finishReason}).`,
      metadata
    );
  }

  if (!text) {
    throw new V2JsonError("Модель вернула пустой ответ.", "empty", metadata, text);
  }

  const extracted = extractJsonBlock(text);
  if (!extracted) {
    throw new V2JsonError("Модель ответила текстом вместо JSON.", "no_json", metadata, text);
  }

  if (extracted.closers) {
    throw new V2JsonError(
      "JSON-ответ не закрыт; вероятно, вывод оборван.",
      "incomplete_json",
      { ...metadata, incompleteJson: true },
      text
    );
  }

  try {
    return JSON.parse(extracted.block);
  } catch {
    throw new V2JsonError("Модель вернула некорректный JSON.", "invalid_json", metadata, text);
  }
}

interface RawV2Response {
  rawText: string;
  metadata: V2ResponseMetadata;
  data: any;
}

async function requestV2Raw(
  apiConfig: ApiConfig,
  turns: V2Turn[],
  maxTokens: number
): Promise<RawV2Response> {
  // Локальным моделям нужна разумная температура и выключенные размышления.
  const temperature = 0.9;

  if (apiConfig.mode === "gemini") {
    const model = apiConfig.model || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiConfig.apiKey}`;

    const contents = turns.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    }));

    const res = await fetchFromProvider(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json",
          },
        }),
      },
      apiConfig,
      { useProxy: false }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        formatApiError(null, res.status, errText, apiConfig.baseUrl, apiConfig.model)
      );
    }

    const data = await readJsonResponse(res);
    const rawText = extractModelText(data);
    const metadata = responseMetadata(data, rawText, "gemini");
    if (
      metadata.finishReason &&
      !isOutputLimitReason(metadata.finishReason) &&
      !isNormalFinishReason(metadata.finishReason)
    ) {
      throw new V2ProviderError(
        `Провайдер остановил генерацию с кодом ${metadata.finishReason}.`,
        metadata
      );
    }
    const providerError = providerErrorMessage(data);
    if (providerError) throw new V2ProviderError(providerError, metadata);
    return { rawText, metadata, data };
  }

  // OpenAI-совместимые и Ollama.
  const { isOllama, primaryUrl, fallbackUrl } = resolveEndpoints(apiConfig.baseUrl);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiConfig.apiKey && apiConfig.apiKey.trim().length > 0) {
    headers["Authorization"] = `Bearer ${apiConfig.apiKey.trim()}`;
  }

  const messages = turns.map((turn) => ({
    role: turn.role === "assistant" ? "assistant" : "user",
    content: turn.content,
  }));

  const bodyPayload: Record<string, any> = {
    model: apiConfig.model || (isOllama ? "llama3.1" : "openai/gpt-4o-mini"),
    messages,
    temperature,
    stream: false,
  };

  if (isOllama) {
    bodyPayload.think = false;
    bodyPayload.format = "json";
    bodyPayload.options = {
      temperature,
      num_ctx: apiConfig.localNumCtx ?? 16_384,
      num_predict: maxTokens,
    };
  } else {
    bodyPayload.max_tokens = maxTokens;
    bodyPayload.response_format = { type: "json_object" };
  }

  const requestOptions = {
    method: "POST",
    headers,
    body: JSON.stringify(bodyPayload),
  };

  let res = await fetchFromProvider(primaryUrl, requestOptions, apiConfig);

  // Тот же 404-фолбэк, что у V1 (Ollama /api/chat ↔ /v1/chat/completions).
  if (!res.ok && res.status === 404 && fallbackUrl) {
    const fallbackRes = await fetchFromProvider(fallbackUrl, requestOptions, apiConfig);
    if (fallbackRes.ok) res = fallbackRes;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      formatApiError(null, res.status, errText, apiConfig.baseUrl, apiConfig.model)
    );
  }

  const data = await readJsonResponse(res);
  const rawText = extractModelText(data);
  const metadata = responseMetadata(data, rawText, "openai-compatible");
  if (
    metadata.finishReason &&
    !isOutputLimitReason(metadata.finishReason) &&
    !isNormalFinishReason(metadata.finishReason)
  ) {
    throw new V2ProviderError(
      `Провайдер остановил генерацию с кодом ${metadata.finishReason}.`,
      metadata
    );
  }
  const providerError = providerErrorMessage(data);
  if (providerError) throw new V2ProviderError(providerError, metadata);
  return { rawText, metadata, data };
}

/** Strict JSON request used by Text DNA; it preserves finish_reason and usage. */
export async function requestV2JsonDetailed(
  apiConfig: ApiConfig,
  turns: V2Turn[],
  maxTokens = 4600
): Promise<V2JsonResult> {
  const response = await requestV2Raw(apiConfig, turns, maxTokens);
  const value = parseV2JsonStrict(response.rawText, response.metadata);
  return { value, rawText: response.rawText, metadata: response.metadata };
}

/**
 * Backward-compatible V2 request. Existing Character DNA and Group DNA keep
 * their tolerant JSON repair behavior; Text DNA uses requestV2JsonDetailed.
 */
export async function requestV2Json(
  apiConfig: ApiConfig,
  turns: V2Turn[],
  maxTokens = 4600
): Promise<any> {
  try {
    const response = await requestV2Raw(apiConfig, turns, maxTokens);
    return parseV2Json(response.rawText);
  } catch (cause) {
    // Старые Character DNA/Group DNA ветки ожидают V2JsonError и сами
    // выполняют свой прежний correction-протокол. Подробный Text DNA путь
    // использует requestV2JsonDetailed и получает V2ProviderError напрямую.
    if (cause instanceof V2ProviderError) {
      throw new V2JsonError(
        "Провайдер вернул отказ вместо JSON.",
        "no_json",
        cause.metadata
      );
    }
    throw cause;
  }
}
