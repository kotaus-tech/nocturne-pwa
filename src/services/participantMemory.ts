import type {
  ApiConfig,
  Character,
  ChatSession,
  Intention,
  Message,
} from "../types";
import { callLLM } from "./apiClient";
import { safeParseJson } from "./memoryEngine";
import {
  countRelevantMessagesSince,
  getParticipantMemory,
  lastOwnMessageId,
  MAX_PRIVATE_NOTES,
  PERSONAL_MEMORY_DIRTY_THRESHOLD,
  resolveMemoryPointer,
  sanitizeIntention,
  sanitizePrivateNotes,
} from "./groupScene";

/**
 * Персональная память участника сцены (ТЗ §3).
 *
 * У каждого персонажа группы — собственный накопительный внутренний слой:
 * личные заметки и намерение. Экстракция запускается по «грязному флагу»:
 * только когда персонаж накопил достаточно относящихся к нему сообщений.
 * Персонаж, который молчит и никому не интересен, не стоит ни одного
 * дополнительного вызова модели.
 */

export interface ExtractionDueCheck {
  due: boolean;
  /** Актуальный указатель (с учётом безопасности перемотки). */
  pointer: string | null;
  /** Сколько релевантных сообщений накоплено сверх указателя. */
  count: number;
}

/**
 * Проверка грязного флага: пора ли извлекать личную память персонажа.
 * Считает по фактическому положению сообщений в текущей истории —
 * перемотка безопасно обнуляет отсчёт вместо ложного массового срабатывания.
 */
export function isExtractionDue(
  messages: Message[],
  session: Pick<ChatSession, "participantMemory">,
  characterId: string,
  cast?: Character[],
  threshold: number = PERSONAL_MEMORY_DIRTY_THRESHOLD
): ExtractionDueCheck {
  const memory = getParticipantMemory(session, characterId);
  // `null` у новой записи означает «экстракции ещё не было» — считаем
  // историю с начала. Резервная точка нужна только для уже существовавшего,
  // но удалённого перемоткой id.
  const pointer = memory.lastExtractedMessageId
    ? resolveMemoryPointer(
        messages,
        memory.lastExtractedMessageId,
        (list) => lastOwnMessageId(list, characterId)
      )
    : null;

  const count = countRelevantMessagesSince(messages, characterId, pointer, cast);

  return { due: count >= threshold, pointer, count };
}

/**
 * Полный текст промпта плановой экстракции личной памяти (ТЗ §3.2).
 * Консолидация встроена сюда же: каждый вызов получает ВСЕ текущие заметки
 * и обязан вернуть уже укороченный до лимита список — отдельных вызовов
 * на «сжатие» не требуется.
 */
export function buildPersonalExtractionPrompt(params: {
  characterName: string;
  fragment: string;
  privateNotes: string[];
  intentionText?: string | null;
}): string {
  const { characterName, fragment, privateNotes, intentionText } = params;

  const notesText =
    privateNotes.length > 0 ? privateNotes.map((note) => `- ${note}`).join("\n") : "пока пусто";

  return `Ты анализируешь недавние события ролевой сцены с точки зрения ОДНОГО конкретного персонажа —
${characterName}. Ты не рассказчик всей сцены, ты психолог, который восстанавливает внутренний
мир именно этого человека.

ПОСЛЕДНИЕ СОБЫТИЯ СЦЕНЫ (то, что происходило и было сказано):
${fragment}

ТЕКУЩИЕ ЛИЧНЫЕ ЗАМЕТКИ ${characterName} (что она уже думает/помнит/подозревает):
${notesText}

ТЕКУЩЕЕ НАМЕРЕНИЕ ${characterName}:
${intentionText?.trim() ? intentionText.trim() : "нет активного намерения"}

ЗАДАЧА:
1. Определи, узнала ли ${characterName} за это время что-то новое, значимое лично для неё —
   услышанный секрет, чужое признание, повод для подозрения, эмоциональный вывод, изменившееся
   отношение к кому-то. Учитывай ТОЛЬКО то, что персонаж реально мог видеть или слышать по ходу
   истории — не додумывай ей знания, которых у неё быть не может.
2. Если кто-то в присутствии ${characterName} рассказал что-то о третьем лице или о событии,
   которое сама ${characterName} не видела — оформи это как её субъективную, потенциально неполную
   информацию с явной пометкой источника, а не как объективный факт. Формат такой заметки:
   "[От Имени]: содержание услышанного".
3. Обнови список личных заметок: удали то, что потеряло актуальность или было опровергнуто,
   объедини связанные мысли в одну, добавь новые. В ИТОГЕ должно остаться НЕ БОЛЕЕ
   ${MAX_PRIVATE_NOTES} самых важных пунктов, отсортированных по значимости для персонажа
   (важное — выше).
4. Если намерение персонажа было выполнено, отменено или потеряло смысл по ходу этих событий —
   верни null. Если оно всё ещё актуально — оставь как есть. Если возникло новое устойчивое
   намерение — сформулируй его заново.
5. Если ничего значимого лично для ${characterName} не произошло — верни список заметок без
   изменений и намерение без изменений. Не выдумывай внутреннюю жизнь ради активности.

Ответь СТРОГО в формате JSON, без пояснений вне структуры:
{
  "privateNotes": ["...", "..."],
  "intention": { "text": "...", "scope": "location" | "time" | "scene" | "persistent" } | null
}`;
}

export interface PersonalExtractionResult {
  privateNotes: string[];
  intention: Intention | null;
}

/**
 * Разбор ответа экстрактора: жёсткие клампы на заметки и намерение.
 * Возвращает null, если ответ не разобрался вовсе — вызывающий код
 * сохраняет прежние заметки (лучше пропустить, чем выдумать).
 */
export function parsePersonalExtraction(raw: string): PersonalExtractionResult | null {
  let parsed: Record<string, unknown> | null = null;

  try {
    parsed = safeParseJson(raw);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  if (!Array.isArray(parsed.privateNotes)) return null;

  const intention = parsed.intention === null
    ? null
    : sanitizeIntention({
        ...(parsed.intention as object),
        createdAtMessageId: "",
      });

  return {
    privateNotes: sanitizePrivateNotes(parsed.privateNotes),
    intention,
  };
}

/**
 * Сам вызов персональной экстракции. Недорогой фоновый запрос — аналог
 * существующего принципа глобальной памяти, но per-character и по грязному
 * флагу, а не по таймеру.
 */
export async function requestPersonalExtraction(
  config: ApiConfig,
  characterName: string,
  fragment: string,
  privateNotes: string[],
  intentionText?: string | null,
  signal?: AbortSignal
): Promise<PersonalExtractionResult | null> {
  const systemPrompt = `Ты — психолог, который восстанавливает внутренний мир одного конкретного персонажа ролевой сцены по свежим событиям. Отвечаешь строго в запрошенном JSON-формате.`;

  const prompt = buildPersonalExtractionPrompt({
    characterName,
    fragment,
    privateNotes,
    intentionText,
  });

  const raw = await callLLM(
    config,
    systemPrompt,
    [{ role: "user", content: prompt }],
    undefined,
    signal
  );

  return parsePersonalExtraction(raw);
}

/**
 * Полный текст промпта нейтральной общей хроники (ТЗ §3.3).
 * Хроника — единственная общая структура, доступная всем участникам:
 * объективный взгляд со стороны, без привязки к точке зрения лидера.
 */
export function buildNeutralChroniclePrompt(params: {
  fragment: string;
  currentSummary: string;
}): string {
  const { fragment, currentSummary } = params;

  return `Ты — беспристрастный хроникёр ролевой сцены. Твоя задача — зафиксировать объективные события,
которые произошли за последний фрагмент истории, СО СТОРОНЫ, как их видел бы нейтральный
наблюдатель в комнате.

ПОСЛЕДНИЕ СОБЫТИЯ СЦЕНЫ:
${fragment}

ТЕКУЩАЯ ОБЩАЯ ХРОНИКА (что уже зафиксировано ранее):
${currentSummary.trim() || "пока пусто"}

ПРАВИЛА:
1. Пиши от третьего лица, нейтрально, как будто описываешь произошедшее постороннему человеку,
   который ничего не знает о сцене.
2. Фиксируй ТОЛЬКО объективно наблюдаемые вещи: кто что сказал вслух, кто что сделал физически,
   кто пришёл, кто ушёл, какие объективные факты обсуждались.
3. НЕ включай сюда внутренние переживания, подозрения, недосказанные мысли отдельных персонажей —
   это фиксируется отдельно, в личной памяти каждого персонажа, и здесь не нужно.
4. Обновляй хронику компактно: не пересказывай всё заново, а органично дополни или скорректируй
   существующий текст, сохраняя её как связное, сжатое повествование, а не список пунктов.
5. Если ничего существенного объективно не произошло (пустая болтовня, ничего не изменилось по
   сути) — верни хронику без изменений.

Ответь только обновлённым текстом общей хроники, без пояснений и заголовков.`;
}

/** Вызов нейтрального хроникёра. Возвращает готовый текст хроники. */
export async function requestNeutralChronicle(
  config: ApiConfig,
  fragment: string,
  currentSummary: string,
  signal?: AbortSignal
): Promise<string> {
  const systemPrompt = `Ты — беспристрастный хроникёр ролевой сцены. Фиксируешь только объективно наблюдаемые события от третьего лица.`;

  const prompt = buildNeutralChroniclePrompt({ fragment, currentSummary });

  const raw = await callLLM(
    config,
    systemPrompt,
    [{ role: "user", content: prompt }],
    undefined,
    signal
  );

  return raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .trim();
}
