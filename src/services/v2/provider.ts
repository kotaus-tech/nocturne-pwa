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

/** Ответ модели не удалось разобрать в JSON. */
export class V2JsonError extends Error {}

interface V2Turn {
  role: "user" | "assistant" | "model";
  content: string;
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

/** Терпимый разбор ответа в JSON-объект: терпит обёртки и обрыв ответа. */
export function parseV2Json(raw: string): any {
  const text = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const extracted = extractJsonBlock(text);

  if (!extracted) {
    throw new V2JsonError(
      text
        ? `Модель ответила текстом вместо JSON: «${text.slice(0, 160)}».`
        : "Модель вернула пустой ответ."
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
    throw new V2JsonError("Модель вернула некорректный JSON.");
  }
}

/**
 * Запрос диалога в JSON-режиме. `turns` — последовательность ролей,
 * где для коррекционного повтора можно передать [инструкция, битый ответ,
 * задание исправить].
 */
export async function requestV2Json(
  apiConfig: ApiConfig,
  turns: V2Turn[],
  maxTokens = 4600
): Promise<any> {
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
    return parseV2Json(extractModelText(data));
  }

  // OpenAI-совместимые и Ollama
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
      num_ctx: apiConfig.localNumCtx ?? 8192,
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
  return parseV2Json(extractModelText(data));
}
