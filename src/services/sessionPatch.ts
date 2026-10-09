import type {
  Character,
  ChatSession,
  Message,
  ParticipantMemory,
  SceneSessionPatch,
} from "../types";
import {
  emptyParticipantMemory,
  getParticipantMemory,
  intentionSignature,
  intentionSurvivesShift,
  MAX_SCENE_RELATIONS,
  OFFSCREEN_MIN_TICKS_BETWEEN_SIGNIFICANT,
  OFFSCREEN_TICK_INTERVAL_MAX,
  OFFSCREEN_TICK_INTERVAL_MIN,
  mergeSceneRelations,
  notesSignature,
  sanitizeIntention,
  sanitizePrivateNotes,
} from "./groupScene";
import { newId } from "../utils/id";

/**
 * Единая шина изменений состояния групповой ветки (ТЗ §2.6, §10).
 *
 * Ни один код-путь не пишет поля сессии, относящиеся к групповым механикам,
 * напрямую: все изменения собираются в `SceneSessionPatch` и применяются
 * одним редьюсером, который затем записывается в базу одной операцией.
 * Это устраняет гонки между основным ходом, фоновой экстракцией памяти
 * и offscreen-тиками.
 */

export interface ScenePatchContext {
  /** Состав сцены — нужен для сопоставления имён в связях. */
  participants: Character[];
  /** Последнее сообщение истории на момент применения (для указателей отсутствия). */
  lastMessageId?: string | null;
}

export interface ScenePatchResult {
  /** Поля для единственного вызова обновления сессии. */
  update: Partial<ChatSession>;
  /** Побочные сущности: дистанционные сообщения, которые нужно добавить в ленту. */
  remoteMessages: Message[];
}

/** Персонаж за кадром? `undefined` у `activeCharacterIds` = присутствуют все. */
export function isCharacterAbsent(
  session: Pick<ChatSession, "activeCharacterIds">,
  characterId: string
): boolean {
  if (!session.activeCharacterIds) return false;
  return !session.activeCharacterIds.includes(characterId);
}

interface Draft {
  activeCharacterIds: string[] | undefined;
  absentReasons: Record<string, string>;
  characterIds: string[];
  isGroup: boolean;
  relations: NonNullable<ChatSession["relations"]>;
  currentStats: ChatSession["currentStats"];
  participantStats: Record<string, ChatSession["currentStats"]>;
  summary: string;
  participantMemory: Record<string, ParticipantMemory>;
  settings: Pick<ChatSession, "liveScene" | "offscreenLifeEnabled" | "offscreenTickInterval">;
}

function makeDraft(session: ChatSession): Draft {
  return {
    activeCharacterIds: session.activeCharacterIds
      ? [...session.activeCharacterIds]
      : undefined,
    absentReasons: { ...(session.absentReasons ?? {}) },
    characterIds: [...(session.characterIds ?? [])],
    isGroup: Boolean(session.isGroup),
    relations: (session.relations ?? []).map((relation) => ({ ...relation })),
    currentStats: { ...session.currentStats },
    participantStats: Object.fromEntries(
      Object.entries(session.participantStats ?? {}).map(([id, stats]) => [
        id,
        { ...stats },
      ])
    ),
    summary: session.summary ?? "",
    participantMemory: deepCopyMemory(session.participantMemory ?? {}),
    settings: {
      liveScene: session.liveScene,
      offscreenLifeEnabled: session.offscreenLifeEnabled,
      offscreenTickInterval: session.offscreenTickInterval,
    },
  };
}

function deepCopyMemory(
  memory: Record<string, ParticipantMemory>
): Record<string, ParticipantMemory> {
  const copy: Record<string, ParticipantMemory> = {};
  for (const [id, entry] of Object.entries(memory)) {
    copy[id] = {
      ...emptyParticipantMemory(id),
      ...entry,
      characterId: id,
      privateNotes: [...(entry.privateNotes ?? [])],
      intention: entry.intention ? { ...entry.intention } : null,
    };
  }
  return copy;
}

function draftIsAbsent(draft: Draft, characterId: string): boolean {
  if (!draft.activeCharacterIds) return false;
  return !draft.activeCharacterIds.includes(characterId);
}

/** Состав группы меняется только через этот участок редьюсера. */
function applyCompositionPatch(
  draft: Draft,
  patch: SceneSessionPatch,
  context: ScenePatchContext
): void {
  const composition = patch.compositionPatch;
  if (!composition) return;

  const seen = new Set<string>();
  draft.characterIds = composition.characterIds.filter((id) => {
    const value = id.trim();
    if (!value || value === "" || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
  draft.isGroup = composition.isGroup ?? draft.characterIds.length > 0;

  if (!draft.isGroup && draft.characterIds.length === 0) {
    draft.participantMemory = {};
    draft.participantStats = {};
    draft.relations = [];
    draft.activeCharacterIds = undefined;
    draft.absentReasons = {};
    return;
  }

  const allowed = new Set([
    context.participants[0]?.id ?? "",
    ...draft.characterIds,
  ]);
  for (const id of Object.keys(draft.participantMemory)) {
    if (!allowed.has(id)) delete draft.participantMemory[id];
  }
  for (const id of Object.keys(draft.participantStats)) {
    if (!allowed.has(id)) delete draft.participantStats[id];
  }
  for (const id of Object.keys(draft.absentReasons)) {
    if (!allowed.has(id)) delete draft.absentReasons[id];
  }
  if (draft.activeCharacterIds) {
    draft.activeCharacterIds = draft.activeCharacterIds.filter((id) => allowed.has(id));
    if (draft.activeCharacterIds.length === 0) draft.activeCharacterIds = undefined;
  }
}

/**
 * Применение presence-патча: сами списки заменяются целиком (присутствие —
 * состояние момента, не накопительная структура), но переходы «в сцену /
 * за кадр» автоматически обслуживают указатель `absentSinceMessageId`.
 */
function applyPresencePatch(
  draft: Draft,
  patch: SceneSessionPatch,
  context: ScenePatchContext
): void {
  const presence = patch.presencePatch;
  if (!presence) return;

  const previousIds = draft.activeCharacterIds
    ? new Set(draft.activeCharacterIds)
    : null; // null = присутствовали все

  if (presence.activeCharacterIds !== undefined) {
    draft.activeCharacterIds =
      presence.activeCharacterIds.length > 0
        ? [...presence.activeCharacterIds]
        : undefined;
  }

  if (presence.absentReasons !== undefined) {
    draft.absentReasons = { ...presence.absentReasons };
  }

  // Обслуживание указателей отсутствия по переходам.
  const nextIds = draft.activeCharacterIds
    ? new Set(draft.activeCharacterIds)
    : null; // null = присутствуют все

  const allowedIds = new Set([
    context.participants[0]?.id ?? "",
    ...draft.characterIds,
  ]);
  const knownIds = new Set<string>([
    ...context.participants.map((item) => item.id),
    ...Object.keys(draft.participantMemory),
  ].filter((id) => allowedIds.has(id)));

  for (const id of knownIds) {
    const wasAbsent = previousIds ? !previousIds.has(id) : false;
    const nowAbsent = nextIds ? !nextIds.has(id) : false;

    if (!wasAbsent && nowAbsent) {
      const entry = ensureMemoryEntry(draft, id);
      entry.absentSinceMessageId = context.lastMessageId ?? null;
      // Свежий уход начинает собственный отсчёт: прошлый offscreen-тик
      // из предыдущего появления не должен дать событию произойти сразу.
      entry.ticksSinceLastSignificant = OFFSCREEN_MIN_TICKS_BETWEEN_SIGNIFICANT;
      entry.significantSinceLastContact = 0;
      entry.lastTickAtMessageId = context.lastMessageId ?? null;
    } else if (wasAbsent && !nowAbsent) {
      const entry = ensureMemoryEntry(draft, id);
      entry.absentSinceMessageId = null;
      delete draft.absentReasons[id];
    }
  }
}

function ensureMemoryEntry(draft: Draft, characterId: string): ParticipantMemory {
  if (!draft.participantMemory[characterId]) {
    draft.participantMemory[characterId] = emptyParticipantMemory(characterId);
  }
  return draft.participantMemory[characterId];
}

/**
 * Presence Guard (ТЗ §10.3): пока offscreen-тик считался, персонаж мог
 * вернуться в сцену. Тогда служебные поля, привязанные к отсутствию
 * (намерение офскрин-происхождения, дистанционный контакт), отбрасываются,
 * а пережитый личный опыт (заметки) всё равно применяется.
 */
function offscreenPatchIsStale(
  draft: Draft,
  patch: SceneSessionPatch
): boolean {
  if (patch.sourceKind !== "offscreen_tick") return false;
  if (!patch.offscreenSubjectId) return false;
  const isAbsentNow = draftIsAbsent(draft, patch.offscreenSubjectId);
  if (patch.offscreenWasAbsent !== undefined) {
    return isAbsentNow !== patch.offscreenWasAbsent;
  }
  return !isAbsentNow;
}

function applyMemoryPatch(draft: Draft, patch: SceneSessionPatch): void {
  const memoryPatch = patch.participantMemoryPatch;
  if (!memoryPatch) return;

  const stale = offscreenPatchIsStale(draft, patch);

  for (const [characterId, entry] of Object.entries(memoryPatch)) {
    if (stale && characterId === patch.offscreenSubjectId) {
      // Персонаж успел вернуться: личный опыт валиден, служебные поля — нет.
      if (Array.isArray(entry.privateNotes)) {
        const current = ensureMemoryEntry(draft, characterId);
        if (
          !patch.baseNotesSignature ||
          notesSignature(current.privateNotes) === patch.baseNotesSignature
        ) {
          current.privateNotes = sanitizePrivateNotes(entry.privateNotes);
        }
      }
      continue;
    }

    const current = ensureMemoryEntry(draft, characterId);

    if (Array.isArray(entry.privateNotes)) {
      // Защита от применения устаревшего патча вслепую (§10.2): заметки
      // заменяются только если они консолидированы поверх актуального списка.
      if (
        !patch.baseNotesSignature ||
        notesSignature(current.privateNotes) === patch.baseNotesSignature
      ) {
        current.privateNotes = sanitizePrivateNotes(entry.privateNotes);
      }
    }

    if (entry.intention !== undefined) {
      if (
        !patch.baseIntentionSignature ||
        intentionSignature(current.intention) === patch.baseIntentionSignature
      ) {
        current.intention = sanitizeIntention(entry.intention);
      }
    }

    if (entry.lastExtractedMessageId !== undefined) {
      current.lastExtractedMessageId = entry.lastExtractedMessageId;
    }

    if (entry.absentSinceMessageId !== undefined) {
      current.absentSinceMessageId = entry.absentSinceMessageId;
    }

    if (entry.lastTickAtMessageId !== undefined) {
      current.lastTickAtMessageId = entry.lastTickAtMessageId;
    }

    if (typeof entry.ticksSinceLastSignificant === "number") {
      current.ticksSinceLastSignificant = Math.max(
        0,
        Math.round(entry.ticksSinceLastSignificant)
      );
    }

    if (typeof entry.significantSinceLastContact === "number") {
      current.significantSinceLastContact = Math.max(
        0,
        Math.round(entry.significantSinceLastContact)
      );
    }
  }
}

/** Скачок времени/локации инвалидирует намерения по скоупу (ТЗ §2.2). */
function applySceneShift(draft: Draft, patch: SceneSessionPatch): void {
  const shift = patch.sceneShiftPatch;
  if (!shift) return;

  for (const entry of Object.values(draft.participantMemory)) {
    if (!intentionSurvivesShift(entry.intention, shift)) {
      entry.intention = null;
    }
  }
}

/** Редьюсер одного патча поверх черновика состояния. */
function applyPatchToDraft(
  draft: Draft,
  patch: SceneSessionPatch,
  context: ScenePatchContext,
  remoteMessages: Message[]
): void {
  applyCompositionPatch(draft, patch, context);
  applyPresencePatch(draft, patch, context);

  if (patch.relationsReplace) {
    draft.relations = patch.relationsReplace
      .slice(0, MAX_SCENE_RELATIONS)
      .map((relation) => ({
        ...relation,
        text: relation.text.trim().slice(0, 400),
      }))
      .filter((relation) => relation.from && relation.text);
  }

  if (patch.relationsPatch && patch.relationsPatch.length > 0) {
    draft.relations = mergeSceneRelations(
      draft.relations,
      patch.relationsPatch,
      context.participants
    ).relations;
  }

  if (patch.statsPatch) {
    if (patch.statsPatch.leader) {
      draft.currentStats = { ...patch.statsPatch.leader };
    }
    if (patch.statsPatch.participants) {
      for (const [id, stats] of Object.entries(patch.statsPatch.participants)) {
        draft.participantStats[id] = { ...stats };
      }
    }
  }

  if (patch.summaryPatch !== undefined) {
    draft.summary = patch.summaryPatch;
  }

  applySceneShift(draft, patch);
  applyMemoryPatch(draft, patch);

  if (patch.settingsPatch) {
    if (patch.settingsPatch.liveScene !== undefined) {
      draft.settings.liveScene = patch.settingsPatch.liveScene;
    }
    if (patch.settingsPatch.offscreenLifeEnabled !== undefined) {
      draft.settings.offscreenLifeEnabled = patch.settingsPatch.offscreenLifeEnabled;
    }
    if (
      patch.settingsPatch.offscreenTickInterval !== undefined &&
      Number.isFinite(patch.settingsPatch.offscreenTickInterval)
    ) {
      draft.settings.offscreenTickInterval = Math.min(
        OFFSCREEN_TICK_INTERVAL_MAX,
        Math.max(
          OFFSCREEN_TICK_INTERVAL_MIN,
          Math.round(patch.settingsPatch.offscreenTickInterval)
        )
      );
    }
  }

  // Настройки режиссёра — простые скаляры, но они тоже проходят через
  // единую декларативную шину, чтобы UI и фоновые процессы не перетирали
  // друг друга независимыми update-вызовами.
  // (Применяются ниже при формировании итогового update.)

  // Дистанционный контакт: только пока персонаж действительно за кадром.
  const remote = patch.remoteMessagePatch;
  if (remote && !offscreenPatchIsStale(draft, patch)) {
    const author = context.participants.find(
      (item) => item.id === remote.characterId
    );

    remoteMessages.push({
      id: newId(),
      sessionId: "",
      sender: "assistant",
      characterId: remote.characterId,
      characterName: author?.name,
      swipes: [remote.text],
      currentSwipeIndex: 0,
      presentCharacterIds: [],
      remoteKind: remote.kind,
      timestamp: Date.now(),
    });
  }
}

/**
 * Применяет один или несколько патчей к состоянию сессии и возвращает
 * единый объект обновления для базы + побочные дистанционные сообщения.
 * Порядок применения — поэлементное слияние, а не «последний записавший
 * побеждает»: каждый патч видит результат предыдущего.
 */
export function reduceScenePatches(
  session: ChatSession,
  patches: SceneSessionPatch[],
  context: ScenePatchContext
): ScenePatchResult {
  const draft = makeDraft(session);
  const remoteMessages: Message[] = [];

  for (const patch of patches) {
    applyPatchToDraft(draft, patch, context, remoteMessages);
  }

  for (const message of remoteMessages) {
    message.sessionId = session.id;
  }

  return {
    update: {
      activeCharacterIds: draft.activeCharacterIds,
      absentReasons: draft.absentReasons,
      characterIds: draft.characterIds,
      isGroup: draft.isGroup,
      relations: draft.relations,
      currentStats: draft.currentStats,
      participantStats: draft.participantStats,
      summary: draft.summary,
      participantMemory: draft.participantMemory,
      liveScene: draft.settings.liveScene,
      offscreenLifeEnabled: draft.settings.offscreenLifeEnabled,
      offscreenTickInterval: draft.settings.offscreenTickInterval,
      updatedAt: Date.now(),
    },
    remoteMessages,
  };
}

/** Удобная обёртка для одного патча. */
export function reduceScenePatch(
  session: ChatSession,
  patch: SceneSessionPatch,
  context: ScenePatchContext
): ScenePatchResult {
  return reduceScenePatches(session, [patch], context);
}

/** Текущая память персонажа с учётом записи в ветке (для чтения извне). */
export function readParticipantMemory(
  session: ChatSession,
  characterId: string
): ParticipantMemory {
  return getParticipantMemory(session, characterId);
}
