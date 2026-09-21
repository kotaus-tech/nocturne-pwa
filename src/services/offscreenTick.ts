import type {
  ApiConfig,
  Character,
  ChatSession,
  Intention,
  Message,
  ParticipantMemory,
  RemoteKind,
  SceneSessionPatch,
  SceneShift,
} from "../types";
import { callLLM } from "./apiClient";
import { safeParseJson } from "./memoryEngine";
import {
  getParticipantMemory,
  intentionSignature,
  MAX_PRIVATE_NOTES,
  notesSignature,
  OFFSCREEN_MIN_TICKS_BETWEEN_SIGNIFICANT,
  OFFSCREEN_TICK_INTERVAL,
  OFFSCREEN_TICK_INTERVAL_MAX,
  OFFSCREEN_TICK_INTERVAL_MIN,
  REMOTE_CONTACT_MIN_TICKS,
  resolveMemoryPointer,
  sanitizePrivateNotes,
  sceneTurnsSince,
} from "./groupScene";

/**
 * Offscreen-тик — внекадровая жизнь персонажа (ТЗ §4).
 *
 * Единственный механизм, который гарантированно даёт отсутствующему персонажу
 * шанс на вычислительное развитие — независимо от того, вспомнит ли о нём
 * модель, отвечающая за кого-то другого. Отсутствие в кадре не означает
 * отсутствие в вычисляемой вселенной.
 */

export type OffscreenTickReason = "interval" | "scene_shift";

const REMOTE_KINDS: RemoteKind[] = ["sms", "call_missed", "social_post", "message"];

/** Интервал тиков с учётом пользовательской настройки и разумных границ. */
export function resolveTickInterval(session: Pick<ChatSession, "offscreenTickInterval">): number {
  const raw = session.offscreenTickInterval;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return OFFSCREEN_TICK_INTERVAL;
  return Math.min(OFFSCREEN_TICK_INTERVAL_MAX, Math.max(OFFSCREEN_TICK_INTERVAL_MIN, Math.round(raw)));
}

export interface OffscreenDueCheck {
  due: boolean;
  reason?: OffscreenTickReason;
  /** Сколько ходов сцены персонаж провёл за кадром. */
  turnsAbsent: number;
}

/**
 * Пора ли запускать тик для отсутствующего персонажа.
 *
 * Два триггера работают как логическое ИЛИ:
 * 1. счётчик ходов сцены с момента ухода за кадр (или прошлого тика)
 *    достиг интервала;
 * 2. только что завершившийся ход сообщил о скачке времени (`sceneShift.time`) —
 *    по сюжету прошло значимое время, и персонажу пора «подумать».
 *
 * Против спама: даже при скачках времени тик не может срабатывать чаще,
 * чем раз в 2 хода сцены.
 */
export function isOffscreenTickDue(params: {
  messages: Message[];
  session: Pick<ChatSession, "activeCharacterIds" | "offscreenLifeEnabled" | "offscreenTickInterval" | "participantMemory">;
  characterId: string;
  sceneShift?: SceneShift | null;
}): OffscreenDueCheck {
  const { messages, session, characterId, sceneShift } = params;

  if (session.offscreenLifeEnabled === false) {
    return { due: false, turnsAbsent: 0 };
  }

  // Присутствует — тик не нужен: персонаж и так живёт в основном потоке.
  if (session.activeCharacterIds
    ? session.activeCharacterIds.includes(characterId)
    : true) {
    return { due: false, turnsAbsent: 0 };
  }

  const memory = getParticipantMemory(session, characterId);
  const interval = resolveTickInterval(session);

  const absentPointer = resolveMemoryPointer(
    messages,
    memory.absentSinceMessageId,
    () => null // указатель утерян перемоткой — отсчёт отсутствия заново
  );
  const turnsAbsent = sceneTurnsSince(messages, absentPointer);

  const sinceTickPointer = resolveMemoryPointer(
    messages,
    memory.lastTickAtMessageId ?? null,
    () => absentPointer
  );
  const turnsSinceTick = sceneTurnsSince(messages, sinceTickPointer);

  if (sceneShift?.time && turnsSinceTick >= 2) {
    return { due: true, reason: "scene_shift", turnsAbsent };
  }

  if (turnsSinceTick >= interval && turnsAbsent >= interval) {
    return { due: true, reason: "interval", turnsAbsent };
  }

  return { due: false, turnsAbsent };
}

/** Оценка прошедшего времени для промпта тика. */
export function estimateElapsedTime(
  turnsAbsent: number,
  shiftTime: SceneShift["time"]
): string {
  if (shiftTime === "days") return "несколько дней";
  if (shiftTime === "day") return "около суток";
  if (shiftTime === "hours") return "несколько часов";
  if (turnsAbsent >= 16) return "около суток";
  if (turnsAbsent >= 8) return "несколько часов";
  return "немного";
}

/** Выжимка отношений для промпта тика: связи и статус шкал героя. */
export function buildOffscreenRelationsDigest(params: {
  character: Character;
  characterName: (id: string) => string;
  relations?: ChatSession["relations"];
  stats?: import("../types").RelationshipStats;
}): string {
  const { character, characterName, relations, stats } = params;

  const lines: string[] = [];

  for (const relation of relations ?? []) {
    if (relation.from !== character.id && relation.to !== character.id) continue;
    const from = relation.from === character.id ? "она" : characterName(relation.from);
    const to = relation.to
      ? relation.to === character.id
        ? "она"
        : characterName(relation.to)
      : "вся группа";
    lines.push(`- ${from} → ${to}: ${relation.text}`);
  }

  if (stats) {
    lines.push(
      `- Отношение к игроку: доверие ${stats.trust}/100, привязанность ${stats.affection}/100, статус «${stats.statusTitle}».`
    );
  }

  return lines.length > 0 ? lines.join("\n") : "без особых зацепок";
}

/** Полный текст промпта offscreen-тика (ТЗ §4.4). */
export function buildOffscreenTickPrompt(params: {
  characterName: string;
  userName: string;
  absentReason?: string;
  privateNotes: string[];
  intentionText?: string | null;
  chronicle: string;
  relationsDigest: string;
  elapsedTime: string;
}): string {
  const {
    characterName,
    userName,
    absentReason,
    privateNotes,
    intentionText,
    chronicle,
    relationsDigest,
    elapsedTime,
  } = params;

  const notesText =
    privateNotes.length > 0
      ? privateNotes.map((note) => `- ${note}`).join("\n")
      : "пусто";

  return `Ты моделируешь внутреннюю жизнь персонажа ${characterName} ЗА КАДРОМ — в то время, пока она
физически отсутствует в основной сцене истории и пользователь её не видит.

ПРИЧИНА ОТСУТСТВИЯ:
${absentReason?.trim() ? absentReason.trim() : "неизвестна"}

ПОСЛЕДНЕЕ ИЗВЕСТНОЕ ЕЙ СОСТОЯНИЕ:
Личные заметки: ${notesText}
Текущее намерение: ${intentionText?.trim() ? intentionText.trim() : "нет"}

ОБЪЕКТИВНАЯ ХРОНИКА СЦЕНЫ ЗА ВРЕМЯ ЕЁ ОТСУТСТВИЯ (то, что происходило БЕЗ неё, и что она сама
знать не может, если только это не объективно наблюдаемо со стороны):
${chronicle.trim() || "ничего не зафиксировано"}

ЕЁ ОТНОШЕНИЯ (насколько известно):
${relationsDigest}

ПРИМЕРНО ПРОШЛО ВРЕМЕНИ: ${elapsedTime}

ЗАДАЧА:
Определи, произошло ли с ${characterName} за это время нечто, что стоит зафиксировать в её
внутреннем состоянии. Она продолжает жить собственной жизнью, а не существует только ради
${userName} и ради текущей сцены — но это не значит, что с ней ОБЯЗАНО что-то произойти.

СТРОГИЕ ПРАВИЛА:
1. Значимое событие НЕ обязательно и не должно происходить каждый раз, когда тебя вызывают.
   Дефолтный, наиболее вероятный ответ — что ничего принципиально нового не произошло, персонаж
   существует, но её текущее состояние не требует изменений. Не создавай драму ради активности.
2. ${characterName} не знает событий, свидетелем которых она не была, и не может внезапно узнать
   секреты, которые ей никто не мог сообщить за это время.
3. Она не обязана немедленно как-либо проявляться — большинство прожитого может остаться
   исключительно её личным опытом, который не отразится на сцене прямо сейчас.
4. Не устраивай для персонажа резких, разрушительных или необратимых решений (уехать навсегда,
   разорвать отношения окончательно, попасть в беду) — только правдоподобное, соразмерное
   развитие внутреннего состояния.
5. Если ты решаешь, что персонаж предпринял конкретное действие с объективным следом в мире
   (написала пост, кому-то позвонила, сделала что-то, что другие люди в принципе могли бы
   заметить или узнать) — заполни worldConsequence. Если действие остаётся исключительно её
   личным опытом (подумала, вспомнила, решила для себя) — worldConsequence не заполняется.
6. Если персонаж решает попытаться выйти на связь с ${userName} дистанционно (написать
   сообщение, позвонить, никак не появляясь физически) — заполни contactAction. Такое решение
   должно быть оправдано её характером и текущим эмоциональным состоянием, а не происходить
   просто потому, что "было бы интересно". Не делай это часто.

Ответь СТРОГО в формате JSON:
{
  "significant": boolean,
  "updatedPrivateNotes": ["..."] | null,
  "intention": { "text": "...", "scope": "location" | "time" | "scene" | "persistent" } | null,
  "worldConsequence": { "text": "...", "reveal": "public" | "private_until_surfaced" } | null,
  "contactAction": { "kind": "sms" | "call_missed" | "social_post" | "message", "text": "..." } | null
}

Если significant равно false — остальные поля должны быть null, а updatedPrivateNotes — null
(заметки остаются без изменений).`;
}

export interface OffscreenTickResult {
  significant: boolean;
  updatedPrivateNotes: string[] | null;
  intention: Intention | null;
  worldConsequence: { text: string; reveal: "public" | "private_until_surfaced" } | null;
  contactAction: { kind: RemoteKind; text: string } | null;
}

/** Разбор ответа тика с жёсткой нормализацией. */
export function parseOffscreenTickResult(raw: string): OffscreenTickResult | null {
  let parsed: Record<string, unknown> | null = null;

  try {
    parsed = safeParseJson(raw);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const significant = parsed.significant === true;

  if (!significant) {
    // Не значимо — и никакие поля не должны «просочиться» вопреки ответу.
    return {
      significant: false,
      updatedPrivateNotes: null,
      intention: null,
      worldConsequence: null,
      contactAction: null,
    };
  }

  const updatedPrivateNotes = Array.isArray(parsed.updatedPrivateNotes)
    ? sanitizePrivateNotes(parsed.updatedPrivateNotes)
    : null;

  let intention: Intention | null = null;
  if (parsed.intention && typeof parsed.intention === "object") {
    const candidate = parsed.intention as Record<string, unknown>;
    const text = typeof candidate.text === "string" ? candidate.text.trim().slice(0, 200) : "";
    if (text) {
      const scope =
        candidate.scope === "location" ||
        candidate.scope === "time" ||
        candidate.scope === "persistent"
          ? candidate.scope
          : "scene";
      intention = {
        text,
        scope: scope as Intention["scope"],
        createdAtMessageId: "",
        origin: "offscreen",
      };
    }
  }

  let worldConsequence: OffscreenTickResult["worldConsequence"] = null;
  if (parsed.worldConsequence && typeof parsed.worldConsequence === "object") {
    const candidate = parsed.worldConsequence as Record<string, unknown>;
    const text = typeof candidate.text === "string" ? candidate.text.trim().slice(0, 300) : "";
    const reveal = candidate.reveal;
    if (text && (reveal === "public" || reveal === "private_until_surfaced")) {
      worldConsequence = { text, reveal };
    }
  }

  let contactAction: OffscreenTickResult["contactAction"] = null;
  if (parsed.contactAction && typeof parsed.contactAction === "object") {
    const candidate = parsed.contactAction as Record<string, unknown>;
    const text = typeof candidate.text === "string" ? candidate.text.trim().slice(0, 500) : "";
    const kind = candidate.kind;
    if (text && REMOTE_KINDS.includes(kind as RemoteKind)) {
      contactAction = { kind: kind as RemoteKind, text };
    }
  }

  return {
    significant: true,
    updatedPrivateNotes,
    intention,
    worldConsequence,
    contactAction,
  };
}

/** Сам вызов тика. Ошибки не критичны — вернём null, тик просто пропустится. */
export async function requestOffscreenTick(
  config: ApiConfig,
  prompt: string,
  signal?: AbortSignal
): Promise<OffscreenTickResult | null> {
  const systemPrompt = `Ты моделируешь внутреннюю жизнь персонажа, который сейчас за кадром ролевой сцены. Отвечаешь строго в запрошенном JSON-формате. Дефолтный ответ — ничего принципиально нового не произошло.`;

  const raw = await callLLM(
    config,
    systemPrompt,
    [{ role: "user", content: prompt }],
    undefined,
    signal
  );

  return parseOffscreenTickResult(raw);
}

export interface OffscreenPatchInput {
  session: ChatSession;
  character: Character;
  memory: ParticipantMemory;
  result: OffscreenTickResult;
  turnsAbsent: number;
  lastMessageId: string | null;
  /** Текущая общая хроника — для дополнения публичным следом. */
  summary: string;
}

/**
 * Формирует патч по итогам тика, применяя жёсткие кулдауны НА УРОВНЕ КОДА,
 * независимо от того, что вернула модель (ТЗ §4.6, §6.4).
 */
export function buildOffscreenPatch(input: OffscreenPatchInput): SceneSessionPatch {
  const { session, character, memory, turnsAbsent, lastMessageId, summary } = input;
  let { result } = input;

  const interval = resolveTickInterval(session);
  const patchMemory: Partial<ParticipantMemory> = {
    lastTickAtMessageId: lastMessageId,
  };

  // Кулдаун значимости: даже если модель хочет событий — не чаще, чем
  // раз в OFFSCREEN_MIN_TICKS_BETWEEN_SIGNIFICANT тиков подряд.
  if (result.significant && memory.ticksSinceLastSignificant < OFFSCREEN_MIN_TICKS_BETWEEN_SIGNIFICANT) {
    result = {
      significant: false,
      updatedPrivateNotes: null,
      intention: null,
      worldConsequence: null,
      contactAction: null,
    };
  }

  if (!result.significant) {
    patchMemory.ticksSinceLastSignificant = memory.ticksSinceLastSignificant + 1;
    return {
      participantMemoryPatch: { [character.id]: patchMemory },
      offscreenSubjectId: character.id,
      offscreenWasAbsent: true,
      sourceKind: "offscreen_tick",
      sourceSnapshotAt: Date.now(),
    };
  }

  // ── Значимое событие ────────────────────────────────────────────────
  patchMemory.ticksSinceLastSignificant = 0;
  patchMemory.significantSinceLastContact = memory.significantSinceLastContact + 1;

  const patch: SceneSessionPatch = {
    participantMemoryPatch: { [character.id]: patchMemory },
    offscreenSubjectId: character.id,
    offscreenWasAbsent: true,
    sourceKind: "offscreen_tick",
    sourceSnapshotAt: Date.now(),
  };

  const baseNotes = sanitizePrivateNotes(memory.privateNotes);
  patch.baseNotesSignature = notesSignature(baseNotes);
  patch.baseIntentionSignature = intentionSignature(memory.intention);

  // Заметки: обновлённые моделью либо прежние — в любом случае фиксируем
  // поверх актуального списка (см. подпись в патче).
  patchMemory.privateNotes = result.updatedPrivateNotes ?? baseNotes;

  // В значимом тике `null` означает, что активного плана больше нет;
  // не сохраняем старое намерение бесконечно после его разрешения. Для
  // фонового опыта точкой происхождения служит последний видимый id шага.
  patchMemory.intention = result.intention
    ? { ...result.intention, createdAtMessageId: lastMessageId ?? "" }
    : null;

  if (result.worldConsequence) {
    if (result.worldConsequence.reveal === "public") {
      // Объективный след в мире — сразу в общую хронику, доступную всем.
      patch.summaryPatch = `${summary.trim()}\n${result.worldConsequence.text}`.trim();
    } else {
      // Личный опыт — только в личный слой совершившего.
      const noteText = result.worldConsequence.text;
      if (!patchMemory.privateNotes!.some((note) => note === noteText)) {
        patchMemory.privateNotes = sanitizePrivateNotes([
          noteText,
          ...patchMemory.privateNotes!,
        ]).slice(0, MAX_PRIVATE_NOTES);
      }
    }
  }

  // Дистанционный контакт: минимум один полный интервал отсутствия и не чаще
  // раза в REMOTE_CONTACT_MIN_TICKS значимых событий.
  if (result.contactAction) {
    const enoughAbsence = turnsAbsent >= interval;
    const enoughSignificance =
      memory.significantSinceLastContact + 1 >= REMOTE_CONTACT_MIN_TICKS;

    if (enoughAbsence && enoughSignificance) {
      patch.remoteMessagePatch = {
        characterId: character.id,
        text: result.contactAction.text,
        kind: result.contactAction.kind,
      };
      patchMemory.significantSinceLastContact = 0;
    }
    // Если гейты не прошли — контакт молча не случается: модель «передумала».
  }

  return patch;
}
