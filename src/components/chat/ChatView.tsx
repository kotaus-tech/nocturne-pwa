import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  MessagesSquare,
  RotateCcw,
  Loader2,
  AlertCircle,
  Users,
  X,
} from "lucide-react";
import { db, getApiConfig, getPersonaState, resolvePersonaForChat } from "../../db";
import { newId } from "../../utils/id";
import type {
  ApiConfig,
  Message,
  UserProfile,
  RelationshipStats,
  RelationshipDelta,
  StoryLogEntry,
  Character,
  Intention,
  SceneSessionPatch,
  SceneShift,
  ThoughtMode,
} from "../../types";
import { computeStatsDelta } from "../../services/metaParser";
import { buildSystemPrompt } from "../../services/promptBuilder";
import {
  buildAssistantLabeler,
  buildCharacterIndex,
  buildPersonalTranscriptSince,
  buildTranscriptSince,
  getParticipantMemory,
  intentionSignature,
  isRemoteThreadMessage,
  matchLeftCharacters,
  mergeSceneRelations,
  matchReturnedCharacters,
  nextSpeaker,
  notesSignature,
  pendingSpeakers,
  resolveParticipants,
  resolvePresence,
  resolveSpeaker,
  resolveSpeakerName,
  statsForCharacter,
} from "../../services/groupScene";
import { chooseSpeaker } from "../../services/groupRouter";
import { reduceScenePatch } from "../../services/sessionPatch";
import {
  isExtractionDue,
  requestPersonalExtraction,
  requestNeutralChronicle,
} from "../../services/participantMemory";
import {
  buildOffscreenPatch,
  buildOffscreenRelationsDigest,
  buildOffscreenTickPrompt,
  estimateElapsedTime,
  isOffscreenTickDue,
  requestOffscreenTick,
} from "../../services/offscreenTick";
import { splitLiveSceneReactions } from "../../services/liveSceneReactions";
import {
  isLocalEndpoint,
  messagesToTurns,
  requestRoleplayReply,
  requestSuggestedReplies,
} from "../../services/apiClient";
import { rewindToMessage } from "../../utils/sessionActions";
import { formatDateDivider } from "../../utils/date";
import { Avatar } from "../common/Avatar";
import { StatsBadge } from "./StatsBar";
import { StatsPanel } from "./StatsPanel";
import { DirectorPanel } from "./DirectorPanel";
import { ThoughtModal } from "./ThoughtModal";
import { InputBar } from "./InputBar";
import { MessageBubble } from "./MessageBubble";
import { NovelReader } from "./NovelReader";
import { CharacterProfileModal } from "./CharacterProfileModal";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { ScenePresenceBar } from "./ScenePresenceBar";
import { PromptDialog } from "../common/PromptDialog";
import { PromptInspectorModal } from "./PromptInspectorModal";
import {
  RelationshipToast,
  type ToastData,
} from "./RelationshipToast";
import {
  extractMemoriesAndDiary,
  directCompressStoryToSummary,
  extractFullChronicleFromChat,
} from "../../services/memoryEngine";
import { renderRoleplayText } from "../../utils/textRenderer";
import { cn } from "../../utils/cn";

/** Реплик в ветке, после которых фоновый экстрактор памяти делает запись. */
const MEMORY_EXTRACT_INTERVAL = 8;
/** Сколько новых реплик должно накопиться, чтобы дожать память при выходе. */
const MEMORY_FLUSH_MIN_MESSAGES = 4;
const INITIAL_PAGE_SIZE = 35;
const PAGE_STEP = 25;

interface ReadingAnchor {
  sessionId: string;
  messageId: string;
  offset: number;
  progress: number;
}

interface PendingReadingPosition {
  mode: "chat" | "novel";
  anchor: ReadingAnchor | null;
  fallbackScrollTop: number;
}

function getSliceForContext(
  allContextMessages: Message[],
  windowSize: number,
  steppedEnabled: boolean
): Message[] {
  if (!steppedEnabled || allContextMessages.length <= windowSize) {
    return allContextMessages.slice(-windowSize);
  }

  const step = 10;
  const overflow = allContextMessages.length - windowSize;
  const steppedStart = Math.floor(overflow / step) * step;
  return allContextMessages.slice(steppedStart);
}

function TypingBubble({
  character,
  streamedText,
}: {
  character: Character;
  streamedText?: string;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      layout
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -6 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex w-full min-w-0 flex-row gap-3.5 scroll-mt-24"
    >
      <Avatar
        src={character.avatarUrl}
        name={character.name}
        size={36}
        className="mt-0.5 ring-1 ring-white/10"
      />

      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 max-w-[92%] sm:max-w-[85%]">
        <div className="flex max-w-full items-baseline gap-2 px-1 text-xs">
          <span className="font-semibold text-zinc-200">{character.name}</span>
          <span className="text-[11px] font-medium text-accent animate-pulse">
            {streamedText ? "говорит…" : "печатает…"}
          </span>
        </div>

        <div className="relative flex flex-col items-start gap-2 rounded-2xl rounded-tl-xs border border-white/[0.08] bg-[#121622]/90 px-4.5 py-3 shadow-lg backdrop-blur-xl">
          {streamedText ? (
            <div className="rp-text text-sm leading-relaxed text-zinc-100 sm:text-[15px]">
              {renderRoleplayText(streamedText)}
              <span className="ml-1 inline-block h-3.5 w-1 translate-y-0.5 rounded-full bg-accent animate-pulse" />
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1 py-0.5">
                <span
                  className="typing-dot h-2 w-2 rounded-full bg-accent"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="typing-dot h-2 w-2 rounded-full bg-accent"
                  style={{ animationDelay: "200ms" }}
                />
                <span
                  className="typing-dot h-2 w-2 rounded-full bg-accent"
                  style={{ animationDelay: "400ms" }}
                />
              </div>
              <span className="text-xs italic text-content-muted">
                подбирает слова…
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ErrorBubble({
  character,
  error,
  onRetry,
  onDismiss,
}: {
  character: Character;
  error: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      className="flex w-full min-w-0 flex-row gap-3.5 scroll-mt-24"
    >
      <Avatar
        src={character.avatarUrl}
        name={character.name}
        size={36}
        className="mt-0.5 ring-1 ring-danger/30"
      />

      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 max-w-[92%] sm:max-w-[85%]">
        <div className="flex max-w-full items-baseline gap-2 px-1 text-xs">
          <span className="font-semibold text-zinc-200">{character.name}</span>
          <span className="text-[11px] font-semibold text-danger">сбой генерации</span>
        </div>

        <div className="relative rounded-2xl rounded-tl-xs border border-danger/35 bg-[#1a1218]/90 p-4 shadow-lg backdrop-blur-xl">
          <div className="flex items-start gap-2.5 text-danger">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed text-zinc-200 [overflow-wrap:anywhere]">
              {error}
            </p>
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-danger/20 pt-2.5">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-xl border border-warning/40 bg-warning/15 px-3 py-1.5 text-xs font-semibold text-warning transition-all hover:bg-warning/25 active:scale-95"
            >
              <RotateCcw size={13} />
              <span>Повторить запрос</span>
            </button>

            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-content-muted hover:bg-white/[0.05] hover:text-content"
            >
              <X size={13} />
              <span>Закрыть</span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ChatView({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const session = useLiveQuery(
    () => db.sessions.get(sessionId),
    [sessionId]
  );

  const character = useLiveQuery(
    () => (session ? db.characters.get(session.characterId) : undefined),
    [session?.characterId]
  );

  const allMessages = useLiveQuery(
    () => db.messages.where("sessionId").equals(sessionId).sortBy("timestamp"),
    [sessionId]
  );

  // Групповая сцена: индекс персонажей нужен, чтобы находить автора реплики
  // по message.characterId и собирать список участников по session.characterIds.
  const charactersIndex = useLiveQuery(() => db.characters.toArray(), []);
  const charactersById = useMemo(
    () => buildCharacterIndex(charactersIndex),
    [charactersIndex]
  );

  const sessionCharacterIdsKey = (session?.characterIds ?? []).join(",");

  /** Участники сцены: основной персонаж ветки всегда первый. */
  const participants = useMemo(
    () => resolveParticipants(session, character, charactersById),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [character, sessionCharacterIdsKey, charactersById]
  );

  const isGroupScene = participants.length > 1;

  /** Кто физически в сцене, а кто за кадром (с причиной). */
  const presence = useMemo(
    () => resolvePresence(session, participants),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      participants,
      session?.activeCharacterIds?.join(","),
      session?.absentReasons ? Object.values(session.absentReasons).join("|") : "",
    ]
  );

  const presentCharacters = presence.present;
  const absentCharacters = presence.absent;

  /**
   * Имена остальных героев именно текущего кадра: отсутствующие существуют
   * в составе ветки, но не должны попадать в legacy-вспомогательные prompt-ы
   * как будто находятся рядом.
   */
  const othersInScene = useMemo(
    () =>
      presentCharacters
        .filter((item) => item.id !== character?.id)
        .map((item) => item.name),
    [presentCharacters, character?.id]
  );

  /**
   * Отсутствующие персонажи, чьё дистанционное сообщение ещё без ответа
   * игрока: они временно доступны как адресаты для отдельной ветки переписки.
   */
  const remotePendingCharacters = useMemo(() => {
    if (!allMessages) return [] as Character[];

    const result: Character[] = [];

    for (const { character: absentCharacter } of presence.absent) {
      let lastRemoteIndex = -1;
      let lastUserReplyIndex = -1;

      allMessages.forEach((message, index) => {
        if (
          message.sender === "assistant" &&
          message.characterId === absentCharacter.id &&
          message.remoteKind &&
          !message.isRemoteReply
        ) {
          lastRemoteIndex = index;
        }
        if (
          message.sender === "user" &&
          (message.addressedTo === absentCharacter.id ||
            message.targetCharacterId === absentCharacter.id)
        ) {
          lastUserReplyIndex = index;
        }
      });

      if (lastRemoteIndex !== -1 && lastUserReplyIndex < lastRemoteIndex) {
        result.push(absentCharacter);
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence, allMessages]);

  const [visibleLimit, setVisibleLimit] = useState(INITIAL_PAGE_SIZE);
  // Личность игрока: ветка → персонаж → активная персона. Живой запрос, чтобы
  // смена активной персоны подхватывалась без перезахода в чат.
  const personaState = useLiveQuery(() => getPersonaState(), []);

  const userProfile: UserProfile | null = useMemo(() => {
    if (!personaState) return null;

    const persona = resolvePersonaForChat(personaState, [
      session?.personaId,
      character?.defaultPersonaId,
    ]);

    if (!persona) return null;

    return {
      name: persona.name,
      avatarUrl: persona.avatarUrl,
      personaDescription: persona.personaDescription,
    };
  }, [personaState, session?.personaId, character?.defaultPersonaId]);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);

  const [statsOpen, setStatsOpen] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [novelMode, setNovelMode] = useState(false);
  const [thoughtMessage, setThoughtMessage] = useState<Message | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  /** Идёт ли сейчас фоновый апкип группы (память/хроника/офскрин-тики). */
  const upkeepRunningRef = useRef(false);
  /** Сколько реплик было при последнем обновлении нейтральной хроники. */
  const lastChronicleMsgCountRef = useRef(0);
  /** Указатель последней обработанной хроникой реплики (безопасен к перемотке). */
  const lastChronicleMessageIdRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [liveStreamedText, setLiveStreamedText] = useState("");
  const [streamingCharacterId, setStreamingCharacterId] = useState<string | null>(
    null
  );
  /** Выбранный адресат: его реплику ждём следующей (подсказка «Отвечает: …»). */
  const [targetCharacterId, setTargetCharacterId] = useState<string | null>(null);
  /** Кого уводим из сцены: спрашиваем причину («ушёл в гараж»). */
  const [presencePrompt, setPresencePrompt] = useState<Character | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [metaNotice, setMetaNotice] = useState<string | null>(null);
  const metaNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastToastMsgCount = useRef(0);
  const lastExtractedMsgCountRef = useRef(0);
  /** Сколько реплик ещё не попало в память — нужно для дозаписи при выходе. */
  const unsavedMessagesRef = useRef(0);
  const memoryCompressRef = useRef<(() => Promise<void>) | null>(null);
  const lastStatusRef = useRef("");

  const isNearBottomRef = useRef(true);

  const savedChatPositionRef = useRef<{
    anchor: ReadingAnchor | null;
    scrollTop: number;
  } | null>(null);

  const pendingReadingPositionRef = useRef<PendingReadingPosition | null>(null);
  const reducedMotion = useReducedMotion();

  const totalCount = allMessages?.length ?? 0;

  const messages = useMemo(() => {
    if (!allMessages) return [];
    return allMessages.slice(-visibleLimit);
  }, [allMessages, visibleLimit]);

  const reversedMessages = useMemo(
    () => [...messages].reverse(),
    [messages]
  );

  const hasMore = totalCount > messages.length;

  useEffect(() => {
    let active = true;

    getApiConfig()
      .then((config) => {
        if (active) setApiConfig(config);
      })
      .catch((cause) => {
        if (!active) return;
        setInitializationError(
          cause instanceof Error ? cause.message : "Не удалось прочитать настройки API."
        );
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (session) {
      setNovelMode(!!session.novelMode);

      if (!lastStatusRef.current && session.currentStats?.statusTitle) {
        lastStatusRef.current = session.currentStats.statusTitle;
      }
    }
  }, [session?.id]);

  useEffect(() => {
    setVisibleLimit(INITIAL_PAGE_SIZE);
    setShowScrollBottom(false);

    lastToastMsgCount.current = 0;
    lastMsgIdRef.current = null;
    isNearBottomRef.current = true;

    savedChatPositionRef.current = null;
    pendingReadingPositionRef.current = null;
  }, [sessionId]);

  // Где остановился фоновый экстрактор памяти: ветка помнит это между заходами,
  // иначе память дожималась бы заново при каждом открытии чата.
  useEffect(() => {
    if (!session) return;
    lastExtractedMsgCountRef.current = session.memoryExtractedCount ?? 0;
  }, [session?.id]);

  // Память дожимается при выходе из ветки: если накопились новые реплики,
  // а авто-экстрактор до них ещё не дошёл, записываем без ожидания.
  useEffect(() => {
    memoryCompressRef.current = compressMemory;
  });

  useEffect(() => {
    unsavedMessagesRef.current = Math.max(
      0,
      (allMessages?.length ?? 0) - lastExtractedMsgCountRef.current
    );
  }, [allMessages?.length]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      if (metaNoticeTimerRef.current) {
        clearTimeout(metaNoticeTimerRef.current);
      }
      // Не оставляем «висящую» генерацию после закрытия ветки.
      abortRef.current?.abort();
      abortRef.current = null;

      // Уходим из ветки — не теряем память: дожимаем её, если накопились
      // реплики, до которых фоновый экстрактор не успел дойти.
      if (unsavedMessagesRef.current >= MEMORY_FLUSH_MIN_MESSAGES) {
        void memoryCompressRef.current?.();
      }
    };
  }, []);

  const updateScrollButton = () => {
    const container = scrollRef.current;
    if (!container) return;

    const distanceToBottom = novelMode
      ? Math.max(0, container.scrollHeight - container.clientHeight - container.scrollTop)
      : Math.abs(container.scrollTop);

    isNearBottomRef.current = distanceToBottom < 80;
    setShowScrollBottom(distanceToBottom > 140);
  };

  const scrollToBottom = (smooth = true) => {
    const container = scrollRef.current;
    if (!container) return;

    isNearBottomRef.current = true;
    container.scrollTo({
      top: novelMode ? container.scrollHeight : 0,
      behavior: smooth && !reducedMotion ? "smooth" : "auto",
    });
  };

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;

    updateScrollButton();

    if (hasMore && !novelMode) {
      const currentScroll = Math.abs(container.scrollTop);
      const maxScroll = container.scrollHeight - container.clientHeight;
      const distanceToTop = maxScroll - currentScroll;

      if (distanceToTop < 300) {
        setVisibleLimit((prev) => Math.min(prev + PAGE_STEP, totalCount));
      }
    }
  };

  const captureReadingAnchor = (): ReadingAnchor | null => {
    const container = scrollRef.current;
    if (!container) return null;

    const containerRect = container.getBoundingClientRect();
    const source = novelMode ? allMessages ?? [] : messages;
    const prefix = novelMode ? "novel-msg-" : "msg-";

    let selected: {
      messageId: string;
      top: number;
      height: number;
    } | null = null;

    for (const message of source) {
      const element = document.getElementById(`${prefix}${message.id}`);
      if (!element || !container.contains(element)) continue;

      const rect = element.getBoundingClientRect();
      const isVisible =
        rect.bottom > containerRect.top && rect.top < containerRect.bottom;

      if (isVisible && (!selected || rect.top < selected.top)) {
        selected = {
          messageId: message.id,
          top: rect.top,
          height: rect.height,
        };
      }
    }

    if (!selected) return null;
    const offset = selected.top - containerRect.top;

    return {
      sessionId,
      messageId: selected.messageId,
      offset: Math.max(0, offset),
      progress:
        offset < 0 && selected.height > 0
          ? Math.min(1, Math.max(0, -offset / selected.height))
          : 0,
    };
  };

  useLayoutEffect(() => {
    const pending = pendingReadingPositionRef.current;
    const container = scrollRef.current;

    if (!pending || !container) return;

    const currentMode = novelMode ? "novel" : "chat";
    if (pending.mode !== currentMode) return;

    const anchor = pending.anchor;
    let targetScrollTop = pending.fallbackScrollTop;

    if (anchor && anchor.sessionId === sessionId) {
      const prefix = novelMode ? "novel-msg-" : "msg-";
      const target = document.getElementById(`${prefix}${anchor.messageId}`);

      if (target && container.contains(target)) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();

        const desiredOffset =
          anchor.progress > 0
            ? -targetRect.height * anchor.progress
            : anchor.offset;

        targetScrollTop =
          container.scrollTop + targetRect.top - containerRect.top - desiredOffset;
      }
    }

    const previousBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = "auto";
    container.scrollTop = targetScrollTop;
    container.style.scrollBehavior = previousBehavior;

    pendingReadingPositionRef.current = null;

    const distance = novelMode
      ? Math.max(0, container.scrollHeight - container.clientHeight - container.scrollTop)
      : Math.abs(container.scrollTop);

    isNearBottomRef.current = distance < 80;
    setShowScrollBottom(distance > 140);
  }, [novelMode, sessionId, allMessages, visibleLimit]);

  useEffect(() => {
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    let frame: number | null = null;

    if (lastMsgIdRef.current && lastMsgIdRef.current !== lastMessage.id) {
      if (lastMessage.sender === "user") {
        scrollToBottom(true);
      } else if (lastMessage.sender === "assistant" && !novelMode) {
        if (isNearBottomRef.current) {
          frame = requestAnimationFrame(() => {
            const container = scrollRef.current;
            const messageElement = document.getElementById(`msg-${lastMessage.id}`);

            if (container && messageElement && container.contains(messageElement)) {
              messageElement.scrollIntoView({
                behavior: reducedMotion ? "auto" : "smooth",
                block: "start",
              });
            }
          });
        }
      }
    }

    lastMsgIdRef.current = lastMessage.id;

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [messages]);

  useEffect(() => {
    if (!sending || novelMode) return;
    if (isNearBottomRef.current) {
      const container = scrollRef.current;
      if (container && Math.abs(container.scrollTop) > 5) {
        container.scrollTop = 0;
      }
    }
  }, [liveStreamedText, sending, novelMode]);

  /** Короткое служебное уведомление (например, о неразобранном мета-блоке). */
  const showMetaNotice = (message: string) => {
    if (metaNoticeTimerRef.current) clearTimeout(metaNoticeTimerRef.current);
    setMetaNotice(message);
    metaNoticeTimerRef.current = setTimeout(() => setMetaNotice(null), 8000);
  };

  const showToast = (data: ToastData) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    setToast(data);

    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 5000);
  };

  const checkMilestone = (
    oldStats: RelationshipStats,
    newStats: RelationshipStats,
    messageCount: number
  ) => {
    const toastsEnabled = session?.showRelationshipToasts !== false;
    if (!toastsEnabled) return;

    if (messageCount - lastToastMsgCount.current < 3) return;

    if (
      newStats.statusTitle &&
      newStats.statusTitle !== oldStats.statusTitle &&
      newStats.statusTitle !== lastStatusRef.current
    ) {
      lastStatusRef.current = newStats.statusTitle;
      showToast({
        title: `Новый этап: «${newStats.statusTitle}»`,
        type: "status",
      });
      lastToastMsgCount.current = messageCount;
      return;
    }

    const crossTier = (firstValue: number, secondValue: number, tier: number) =>
      firstValue < tier && secondValue >= tier;

    if (crossTier(oldStats.affection, newStats.affection, 85)) {
      showToast({
        title: `Глубокая привязанность: «${newStats.statusTitle || "Любовь"}»`,
        type: "affection",
      });
      lastToastMsgCount.current = messageCount;
      return;
    }

    if (crossTier(oldStats.affection, newStats.affection, 50)) {
      showToast({
        title: `Привязанность растёт: «${newStats.statusTitle || "Сближение"}»`,
        type: "affection",
      });
      lastToastMsgCount.current = messageCount;
      return;
    }

    if (crossTier(oldStats.affection, newStats.affection, 25)) {
      showToast({
        title: "Первая искра интереса...",
        type: "affection",
      });
      lastToastMsgCount.current = messageCount;
      return;
    }

    if (crossTier(oldStats.trust, newStats.trust, 75)) {
      showToast({
        title: "Высокое доверие: персонаж открывает душу",
        type: "trust",
      });
      lastToastMsgCount.current = messageCount;
      return;
    }

    if (crossTier(oldStats.trust, newStats.trust, 40)) {
      showToast({
        title: "Лёд тает: доверие начинает крепнуть",
        type: "trust",
      });
      lastToastMsgCount.current = messageCount;
      return;
    }

    if (crossTier(oldStats.tension, newStats.tension, 55)) {
      showToast({
        title: "Эмоциональное напряжение нарастает...",
        type: "tension",
      });
      lastToastMsgCount.current = messageCount;
      return;
    }
  };

  const isAbortError = (cause: unknown): boolean =>
    cause instanceof DOMException
      ? cause.name === "AbortError"
      : cause instanceof Error && cause.name === "AbortError";

  /** Прерывает текущую генерацию: частичный ответ не сохраняется. */
  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setLiveStreamedText("");
  };

  const handleGetSuggestions = async (): Promise<string[]> => {
    if (!apiConfig || !character || !userProfile || !messages || !session) {
      return [];
    }

    const recent = messages
      .filter(
        (message) =>
          !isGroupScene ||
          !isRemoteThreadMessage(message, participants, presentCharacters)
      )
      .slice(-14);
    const transcript = recent
      .map(
        (message) =>
          `${speakerName(message)}: ${message.swipes[message.currentSwipeIndex]}`
      )
      .join("\n");

    return await requestSuggestedReplies(
      apiConfig,
      character.name,
      userProfile.name,
      transcript,
      !!session.naturalSpeech,
      session.directorNotes
    );
  };

  if (!session || !character || !userProfile || !apiConfig || !allMessages) {
    return (
      <div className="fixed inset-0 z-40 flex h-screen w-full flex-col bg-bg text-content supports-[height:100dvh]:h-dvh">
        <header className="shrink-0 border-b border-white/[0.07] bg-[#0c0f15]/85 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label="Вернуться из чата"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-content-secondary hover:bg-white/[0.05]"
            >
              <ArrowLeft size={20} />
            </button>
            <p className="text-xs font-medium text-content-secondary">
              История
            </p>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          {initializationError ? (
            <div role="alert" className="max-w-md rounded-3xl border border-danger/25 bg-surface p-6 shadow-xl">
              <AlertCircle size={26} className="mb-3 text-danger" />
              <h1 className="text-lg font-semibold text-content">
                Не удалось открыть чат
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                {initializationError}
              </p>
              <button
                type="button"
                onClick={onBack}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-on-accent"
              >
                <ArrowLeft size={16} />
                Вернуться
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-xs text-content-secondary">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span>Открываем историю…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------- Групповая сцена: помощники --------------------

  /** Автор реплики: для групповых сцен — по message.characterId, иначе основной персонаж. */
  const speakerFor = (message: Message): Character =>
    resolveSpeaker(message, character, charactersById);

  /** Имя автора реплики (снимок имени переживает удаление персонажа). */
  const speakerName = (message: Message): string =>
    resolveSpeakerName(message, character, charactersById, userProfile.name);

  /** Шкалы отношений конкретного персонажа сцены. */
  const statsFor = (characterId: string): RelationshipStats =>
    statsForCharacter(session, characterId, charactersById);

  /** Текст последней реплики игрока — нужен роутеру говорящего. */
  const lastUserTextIn = (list: Message[]): string => {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const message = list[index];
      if (message.sender === "user") {
        return message.swipes[message.currentSwipeIndex] ?? "";
      }
    }
    return "";
  };

  /** Кто отвечал последним — его ход роутер старается не повторять.
   * Эхо «живой сцены» не делает персонажа «только что говорившим» (§9 ТЗ). */
  const lastAssistantSpeakerId = (list: Message[]): string => {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const message = list[index];
      if (message.sender !== "assistant" || message.isLiveSceneEcho) continue;
      if (isRemoteThreadMessage(message, participants, presentCharacters)) continue;
      return message.characterId ?? character.id;
    }
    return character.id;
  };

  /** Другие присутствующие для промпта: отсутствующих описывает блок присутствия. */
  const othersFor = (characterId: string): Character[] =>
    presentCharacters.filter((item) => item.id !== characterId);

  /** Подпись чужих реплик в контексте запроса. */
  const turnLabelFor = (speakerId: string) =>
    buildAssistantLabeler(speakerId, character.id, (message) =>
      speakerName(message)
    );

  /** Адресат следующей реплики: присутствующий либо «дистанционный» контакт. */
  const activeTarget = targetCharacterId
    ? presentCharacters.find((item) => item.id === targetCharacterId) ??
      remotePendingCharacters.find((item) => item.id === targetCharacterId)
    : undefined;

  /**
   * Единая точка применения патчей состояния ветки (ТЗ §2.6, §10):
   * читаем самое свежее состояние, прогоняем через редьюсер и пишем
   * одним обновлением. Побочные дистанционные сообщения добавляются в ленту.
   */
  async function commitPatch(
    patch: SceneSessionPatch,
    appendMessages: Message[] = [],
    updateMessages: { id: string; patch: Partial<Message> }[] = []
  ): Promise<void> {
    if (!session) return;

    // Dexie-транзакция сериализует конкурирующие фоновые патчи: чтение
    // свежей сессии, редукция, запись сессии и добавление сообщений проходят
    // одним атомарным шагом, а не как read → await → last-write-wins.
    await db.transaction("rw", db.sessions, db.messages, async () => {
      const fresh = await db.sessions.get(session.id);
      if (!fresh) return;

      const messages = await db.messages
        .where("sessionId")
        .equals(session.id)
        .sortBy("timestamp");
      const appendedLastId = appendMessages[appendMessages.length - 1]?.id;

      const { update, remoteMessages } = reduceScenePatch(fresh, patch, {
        participants,
        // Если за этот же логический шаг добавляется ответ героя, переход
        // за кадр привязываем к его стабильному id, а не к индексу массива.
        lastMessageId:
          appendedLastId ??
          (messages.length > 0 ? messages[messages.length - 1].id : null),
      });

      await db.sessions.update(session.id, update);

      const messagesToAdd = [...appendMessages, ...remoteMessages].map((message) => ({
        ...message,
        sessionId: session.id,
      }));
      if (messagesToAdd.length > 0) {
        await db.messages.bulkAdd(messagesToAdd);
      }
      for (const item of updateMessages) {
        await db.messages.update(item.id, item.patch);
      }
    });
  }

  const typingCharacter =
    (streamingCharacterId ? charactersById.get(streamingCharacterId) : undefined) ||
    character;

  const isOwnSceneTurn = (message: Message) =>
    message.sender === "assistant" &&
    !message.isLiveSceneEcho &&
    !isRemoteThreadMessage(message, participants, presentCharacters);

  const lastAssistantId = [...allMessages]
    .reverse()
    .find((message) => isOwnSceneTurn(message))?.id;

  const lastMessage = allMessages[allMessages.length - 1];
  const lastAssistantMessage = allMessages.filter(isOwnSceneTurn).pop();

  const isStepped = apiConfig.steppedContextEnabled !== false;
  const currentContextSlice = getSliceForContext(
    allMessages,
    apiConfig.contextWindow,
    isStepped
  );

  async function callModelAndAppend(
    contextMessages: Message[],
    isInitiative = false,
    onlySpeakers?: Character[],
    targetName?: string,
    patchSource: SceneSessionPatch["sourceKind"] = "user_turn"
  ) {
    if (!apiConfig || !character || !session || !userProfile) return;

    if (apiConfig.mode === "openai" && !apiConfig.baseUrl) {
      setErrorMsg("Укажите Base URL в настройках API.");
      return;
    }

    const isLocal = isLocalEndpoint(apiConfig.baseUrl);
    if (!apiConfig.apiKey && !isLocal) {
      setErrorMsg("Укажите API-ключ в настройках.");
      return;
    }

    setSending(true);
    setLiveStreamedText("");
    setErrorMsg(null);
    isNearBottomRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const isSteppedWindow = apiConfig.steppedContextEnabled !== false;
      const toastsEnabled = session.showRelationshipToasts !== false;

      // Групповая сцена: каждый участник отвечает своим ходом, по порядку списка.
      // Каждый следующий видит уже готовые реплики предыдущих.
      // Групповая сцена: за ход отвечает один персонаж. Либо его выбрал игрок
      // (адресат), либо решает лёгкий запрос роутера, а при сбое — упоминание
      // по имени и ротация. Одиночные ветки идут прежним путём.
      let speakers: Character[];
      let turnSceneShift: SceneShift | null = null;

      if (onlySpeakers && onlySpeakers.length > 0) {
        speakers = onlySpeakers;
      } else if (isGroupScene) {
        const pool =
          presentCharacters.length > 0 ? presentCharacters : participants;

        const lastSpeakerId = lastAssistantSpeakerId(contextMessages);

        const lastUserText = lastUserTextIn(contextMessages);

        const chosen = await chooseSpeaker(
          apiConfig,
          {
            present: pool,
            relations: session.relations,
            intentions: pool
              .map((item) => {
                const intention = getParticipantMemory(session, item.id).intention;
                return intention
                  ? { characterId: item.id, name: item.name, text: intention.text }
                  : null;
              })
              .filter((item): item is NonNullable<typeof item> => item !== null),
            userName: userProfile.name,
            lastUserText,
            lastSpeakerId,
            directorNotes: session.directorNotes,
          },
          controller.signal
        );

        speakers = [chosen];
      } else {
        speakers = [character];
      }
      let workingContext = contextMessages;
      let appended = 0;

      for (const speaker of speakers) {
        if (controller.signal.aborted) break;

        const recent = getSliceForContext(
          workingContext,
          apiConfig.contextWindow,
          isSteppedWindow
        );
        // SMS/дистанционный контакт видит игрок, но не активные персонажи
        // основной сцены — иначе сам факт сообщения станет метазнанием.
        const sceneRecent = recent.filter(
          (message) =>
            !isRemoteThreadMessage(message, participants, presentCharacters)
        );

        const speakerStats = statsFor(speaker.id);
        const speakerMemory = getParticipantMemory(session, speaker.id);

        const systemPrompt = buildSystemPrompt(
          speaker,
          session,
          userProfile,
          sceneRecent,
          isLocal,
          isGroupScene
            ? {
                others: othersFor(speaker.id),
                currentStats: speakerStats,
                absent: absentCharacters,
                relations: session.relations,
                personalMemory: {
                  privateNotes: speakerMemory.privateNotes,
                  intention: speakerMemory.intention,
                },
              }
            : undefined
        );

        const turns = isGroupScene
          ? messagesToTurns(sceneRecent, turnLabelFor(speaker.id))
          : messagesToTurns(sceneRecent);

        if (isInitiative) {
          turns.push({
            role: "user",
            content: `[${userProfile.name} молчит или выжидает. ${speaker.name}, прояви собственную инициативу: продолжи мысль, соверши физическое действие, измени положение, начни новую реплику или нарушь паузу. НЕ говори и НЕ действуй за ${userProfile.name}!]`,
          });
        } else if (targetName && speaker.id === speakers[0].id) {
          // Игрок выбрал адресата аватаром: подсказка уходит только в запрос,
          // в истории сообщения её нет.
          turns.push({
            role: "user",
            content: `[Отвечает: ${speaker.name}. Игрок обратился к нему в первую очередь — отвечай за ${speaker.name}, остальные остаются в сцене.]`,
          });
        }

        setStreamingCharacterId(speaker.id);
        setLiveStreamedText("");

        const parsed = await requestRoleplayReply(
          apiConfig,
          systemPrompt,
          turns,
          (chunk) => {
            setLiveStreamedText(chunk);
          },
          speakerStats,
          controller.signal
        );

        if (parsed.metaWarning) showMetaNotice(parsed.metaWarning);

        // Все изменения одного ответа собираем в ОДИН декларативный патч:
        // присутствие, связи, намерение, sceneShift и шкалы применятся
        // атомарно вместе с сообщением ниже.
        const turnPatch: SceneSessionPatch = {
          sourceKind: patchSource,
          sourceSnapshotAt: Date.now(),
        };
        let returnedForToast: Character[] = [];
        let leavingForToast: { character: Character; reason?: string }[] = [];
        let relationChangesForToast: { from: string; to?: string }[] = [];

        // Сцена двигается сама: кто-то мог вернуться, а кто-то — уйти.
        if (parsed.returnedNames?.length || parsed.left?.length) {
          const returning = matchReturnedCharacters(
            parsed.returnedNames ?? [],
            absentCharacters.map((item) => item.character)
          );
          const leaving = matchLeftCharacters(parsed.left ?? [], presentCharacters);
          returnedForToast = returning;
          leavingForToast = leaving;
          const presentIds = new Set(presentCharacters.map((item) => item.id));
          const returningIds = new Set(returning.map((item) => item.id));
          const leavingIds = new Set(leaving.map((item) => item.character.id));

          let nextIds = participants
            .map((item) => item.id)
            .filter(
              (id) =>
                (presentIds.has(id) || returningIds.has(id)) &&
                !leavingIds.has(id)
            );

          // Защита от пустой сцены сохраняется и в основном ходе.
          if (nextIds.length === 0 && presentIds.size > 0) nextIds = [...presentIds];

          if (nextIds.length > 0) {
            const nextReasons = { ...(session.absentReasons ?? {}) };
            for (const id of returningIds) delete nextReasons[id];
            for (const item of leaving) {
              const reason = item.reason?.trim().slice(0, 120);
              if (reason) nextReasons[item.character.id] = reason;
              else delete nextReasons[item.character.id];
            }
            turnPatch.presencePatch = {
              activeCharacterIds: nextIds,
              absentReasons: nextReasons,
            };
          }
        }

        if (parsed.relations?.length) {
          turnPatch.relationsPatch = parsed.relations;
          relationChangesForToast = mergeSceneRelations(
            session.relations ?? [],
            parsed.relations,
            participants
          ).changed;
        }

        // Намерение говорящего: новое замещает старое, `resolved` очищает.
        if (isGroupScene && (parsed.intention || parsed.resolvedIntention)) {
          const nextIntention: Intention | null = parsed.intention
            ? {
                text: parsed.intention.text,
                scope: parsed.intention.scope,
                createdAtMessageId: "",
                origin: "scene",
              }
            : null;
          turnPatch.participantMemoryPatch = {
            [speaker.id]: { intention: nextIntention },
          };
        }

        // Скачок времени/локации: редьюсер инвалидирует намерения по скоупу.
        if (parsed.sceneShift) {
          turnSceneShift = parsed.sceneShift;
          turnPatch.sceneShiftPatch = parsed.sceneShift;
        }

        const newStats = parsed.stats ?? speakerStats;
        turnPatch.statsPatch =
          speaker.id === character.id
            ? { leader: newStats }
            : { participants: { [speaker.id]: newStats } };

        // «Живая сцена»: хвостовые инлайн-реакции других героев отделяются
        // в собственные сообщения-эхо (только отображение, без последствий
        // для шкал/связей/памяти «сказавшего»).
        let mainText = parsed.text || "...";
        const echoMessages: Message[] = [];

        if (isGroupScene && session.liveScene !== false && othersFor(speaker.id).length > 0) {
          const split = splitLiveSceneReactions(mainText, othersFor(speaker.id), speaker.id);
          const matched = split.reactions.filter((reaction) => reaction.character);
          const unmatched = split.reactions.filter((reaction) => !reaction.character);

          if (matched.length > 0) {
            mainText = split.mainText;
            // Нераспознанные имена возвращаем в основной текст — не теряем слова.
            if (unmatched.length > 0) {
              mainText += `\n${unmatched
                .map((reaction) => `— **${reaction.rawName}:** ${reaction.text}`)
                .join("\n")}`;
            }

            const baseTimestamp = Date.now();
            matched.forEach((reaction, index) => {
              echoMessages.push({
                id: newId(),
                sessionId: session.id,
                sender: "assistant",
                characterId: reaction.character!.id,
                characterName: reaction.character!.name,
                swipes: [reaction.text],
                currentSwipeIndex: 0,
                presentCharacterIds: presentCharacters.map((item) => item.id),
                isLiveSceneEcho: true,
                timestamp: baseTimestamp + index + 1,
              });
            });
          }
        }

        // Связь нельзя обновлять на основании эха: его текст написал
        // основной говорящий, а не персонаж, которому приписана реакция.
        if (turnPatch.relationsPatch && echoMessages.length > 0) {
          const echoIds = new Set(
            echoMessages
              .map((message) => message.characterId)
              .filter((id): id is string => Boolean(id))
          );
          turnPatch.relationsPatch = turnPatch.relationsPatch.filter((relation) => {
            const from = matchReturnedCharacters([relation.from], participants)[0];
            const to = relation.to
              ? matchReturnedCharacters([relation.to], participants)[0]
              : undefined;
            return !echoIds.has(from?.id ?? "") && !echoIds.has(to?.id ?? "");
          });
          relationChangesForToast = mergeSceneRelations(
            session.relations ?? [],
            turnPatch.relationsPatch,
            participants
          ).changed;
        }

        const assistantMessage: Message = {
          id: newId(),
          sessionId: session.id,
          sender: "assistant",
          characterId: isGroupScene ? speaker.id : undefined,
          characterName: isGroupScene ? speaker.name : undefined,
          presentCharacterIds: isGroupScene
            ? presentCharacters.map((item) => item.id)
            : undefined,
          swipes: [mainText],
          currentSwipeIndex: 0,
          innerThought: parsed.innerThought,
          statsSnapshot: newStats,
          statsDelta: computeStatsDelta(speakerStats, newStats),
          timestamp: Date.now(),
        };

        // Намерение возникло именно в этой реплике. Сохраняем стабильный
        // message.id, а не позицию в массиве — это важно для rewind/clone/import.
        const intentionPatch = turnPatch.participantMemoryPatch?.[speaker.id];
        if (intentionPatch?.intention) {
          intentionPatch.intention = {
            ...intentionPatch.intention,
            createdAtMessageId: assistantMessage.id,
          };
        }

        await commitPatch(turnPatch, [assistantMessage, ...echoMessages]);
        appended += 1;

        const total = (allMessages?.length ?? 0) + appended;

        if (toastsEnabled && returnedForToast.length > 0) {
          showToast({
            title:
              returnedForToast.length === 1
                ? `${returnedForToast[0].name} снова в сцене`
                : `В сцену вернулись: ${returnedForToast.map((item) => item.name).join(", ")}`,
            type: "status",
          });
        } else if (toastsEnabled && leavingForToast.length > 0) {
          showToast({
            title:
              leavingForToast.length === 1
                ? `${leavingForToast[0].character.name} выходит из сцены`
                : `За кадром: ${leavingForToast.map((item) => item.character.name).join(", ")}`,
            type: "status",
          });
        } else if (toastsEnabled && relationChangesForToast.length > 0) {
          showToast({
            title: `Связи обновились: ${relationChangesForToast.length} ${relationChangesForToast.length === 1 ? "пара" : "пары"}`,
            type: "status",
          });
        }

        if (toastsEnabled && parsed.feelingHint && parsed.feelingHint.trim()) {
          showToast({
            title:
              speaker.id === character.id
                ? parsed.feelingHint.trim()
                : `${speaker.name}: ${parsed.feelingHint.trim()}`,
            type: "feeling",
          });
        } else if (parsed.stats && speaker.id === character.id) {
          checkMilestone(speakerStats, newStats, total);
        }

        workingContext = [...workingContext, assistantMessage, ...echoMessages];
      }

      const totalAfter = (allMessages?.length ?? 0) + appended;

      // В групповой ветке старый лидерский экстрактор не запускаем: его
      // субъективный diary/facts-слой заменён симметричной личной памятью
      // участников и нейтральной общей хроникой. Одиночные чаты работают
      // по прежнему пути без изменений.
      if (
        !isGroupScene &&
        totalAfter - lastExtractedMsgCountRef.current >= MEMORY_EXTRACT_INTERVAL
      ) {
        lastExtractedMsgCountRef.current = totalAfter;
        unsavedMessagesRef.current = 0;
        compressMemory().catch(() => {});
      }

      // Фоновая жизнь группы: личная память, нейтральная хроника, офскрин-тики.
      // Не блокируем ответ игроку: апкип догоняет состояние самостоятельно.
      if (isGroupScene) {
        void runSceneUpkeep(turnSceneShift).catch(() => {});
      }
    } catch (cause) {
      // Отмена пользователем — не ошибка, просто снимаем индикаторы.
      if (!isAbortError(cause)) {
        setErrorMsg(
          cause instanceof Error ? cause.message : "Ошибка при получении ответа."
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
      setLiveStreamedText("");
      setStreamingCharacterId(null);
    }
  }

  async function handleRetry() {
    if (!session || sending) return;

    const full = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");

    if (full.length === 0) return;
    const last = full[full.length - 1];

    if (last && last.sender === "user") {
      await callModelAndAppend(full, false, undefined, undefined, "regenerate");
      return;
    }

    // Групповая сцена: если ход прервался на середине, дожимаем тех,
    // кто ещё не ответил на последнюю реплику игрока.
    if (!isGroupScene) return;

    const pending = pendingSpeakers(full, participants, character?.id ?? "");
    if (pending.length === 0) return;

    await callModelAndAppend(full, false, pending, undefined, "regenerate");
  }

  /**
   * Фоновая жизнь группы после завершённого хода (ТЗ §3–§5):
   *  - персональная память каждого присутствующего — по «грязному флагу»;
   *  - нейтральная общая хроника вместо синопсиса от первого лица;
   *  - offscreen-тики отсутствующих — по счётчику ходов или скачку времени.
   *
   * Всё асинхронно и не блокирует ответ игроку; каждое изменение проходит
   * через единый редьюсер патчей с защитой от устаревших фоновых записей.
   */
  async function runSceneUpkeep(sceneShift: SceneShift | null): Promise<void> {
    if (!session || !apiConfig || !character || !userProfile || !isGroupScene) return;
    if (upkeepRunningRef.current) return;
    upkeepRunningRef.current = true;

    // В апкип всегда читаем свежую ветку: к моменту завершения основного
    // запроса React-снимок `allMessages`/`session` уже мог устареть.
    const freshSession = await db.sessions.get(session.id);
    const freshMessages = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");
    if (!freshSession) {
      upkeepRunningRef.current = false;
      return;
    }

    const freshParticipants = resolveParticipants(
      freshSession,
      character,
      charactersById
    );
    const freshPresence = resolvePresence(freshSession, freshParticipants);
    const freshPresent = freshPresence.present;
    const freshAbsent = freshPresence.absent;
    let currentUpkeepSummary = freshSession.summary ?? "";
    const nameForMessage = (message: Message) =>
      resolveSpeakerName(message, character, charactersById, userProfile.name);

    try {
      // 1. Персональная память присутствующих (лидер — на равных, §12).
      for (const member of freshPresent) {
        const memory = getParticipantMemory(freshSession, member.id);
        const due = isExtractionDue(
          freshMessages,
          freshSession,
          member.id,
          freshParticipants
        );
        if (!due.due) continue;

        const fragment = buildPersonalTranscriptSince(
          freshMessages,
          member.id,
          due.pointer,
          nameForMessage
        );
        if (!fragment.trim()) continue;

        try {
          const result = await requestPersonalExtraction(
            apiConfig,
            member.name,
            fragment,
            memory.privateNotes,
            memory.intention?.text
          );

          if (!result) continue;

          const extractionMessageId =
            freshMessages[freshMessages.length - 1]?.id ?? null;
          const extractedIntention = result.intention
            ? {
                ...result.intention,
                createdAtMessageId: extractionMessageId ?? "",
              }
            : null;

          await commitPatch({
            participantMemoryPatch: {
              [member.id]: {
                privateNotes: result.privateNotes,
                intention: extractedIntention,
                lastExtractedMessageId: extractionMessageId,
              },
            },
            baseNotesSignature: notesSignature(memory.privateNotes),
            baseIntentionSignature: intentionSignature(memory.intention),
            sourceKind: "memory_extraction",
            sourceSnapshotAt: Date.now(),
          });
        } catch {
          // Фоновая экстракция — не повод ронять чат.
        }
      }

      // 2. Нейтральная хроника: обновляем синопсис от третьего лица,
      //    только когда накопилось достаточно новых реплик.
      const extractDue =
        freshMessages.length - lastChronicleMsgCountRef.current >=
        MEMORY_EXTRACT_INTERVAL;
      if (extractDue && freshMessages.length >= 4) {
        const fragment = buildTranscriptSince(
          freshMessages,
          lastChronicleMessageIdRef.current,
          nameForMessage,
          24,
          (message) =>
            isRemoteThreadMessage(message, freshParticipants, freshPresent)
        );
        if (fragment.trim()) {
          try {
            const chronicle = await requestNeutralChronicle(
              apiConfig,
              fragment,
              currentUpkeepSummary
            );
            if (chronicle.trim()) {
              await commitPatch({
                summaryPatch: chronicle.trim(),
                sourceKind: "memory_extraction",
                sourceSnapshotAt: Date.now(),
              });
              currentUpkeepSummary = chronicle.trim();
              lastChronicleMsgCountRef.current = freshMessages.length;
              lastChronicleMessageIdRef.current =
                freshMessages[freshMessages.length - 1]?.id ?? null;
            }
          } catch {
            // Хроника — фоновая механика, молча пропускаем сбой.
          }
        }
      }

      // 3. Офскрин-тики: каждый отсутствующий получает шанс на развитие.
      if (freshSession.offscreenLifeEnabled !== false) {
        for (const absentEntry of freshAbsent) {
          const member = absentEntry.character;
          const due = isOffscreenTickDue({
            messages: freshMessages,
            session: freshSession,
            characterId: member.id,
            sceneShift,
          });
          if (!due.due) continue;

          const memory = getParticipantMemory(freshSession, member.id);
          const prompt = buildOffscreenTickPrompt({
            characterName: member.name,
            userName: userProfile.name,
            absentReason: absentEntry.reason,
            privateNotes: memory.privateNotes,
            intentionText: memory.intention?.text,
            chronicle: currentUpkeepSummary,
            relationsDigest: buildOffscreenRelationsDigest({
              character: member,
              characterName: (id) =>
                charactersById.get(id)?.name ?? "кто-то",
              relations: freshSession.relations,
              stats: statsForCharacter(freshSession, member.id, charactersById),
            }),
            elapsedTime: estimateElapsedTime(
              due.turnsAbsent,
              sceneShift?.time ?? null
            ),
          });

          try {
            const result = await requestOffscreenTick(apiConfig, prompt);
            if (!result) continue;

            const patch = buildOffscreenPatch({
              session: freshSession,
              character: member,
              memory,
              result,
              turnsAbsent: due.turnsAbsent,
              lastMessageId: freshMessages[freshMessages.length - 1]?.id ?? null,
              summary: currentUpkeepSummary,
            });
            await commitPatch(patch);
            if (result.worldConsequence?.reveal === "public") {
              currentUpkeepSummary = `${currentUpkeepSummary.trim()}\n${result.worldConsequence.text}`.trim();
            }
          } catch {
            // Офскрин-тик — фоновая механика, молча пропускаем сбой.
          }
        }
      }
    } finally {
      upkeepRunningRef.current = false;
    }
  }

  /** Ввести персонажа в сцену или убрать его за кадр. */
  async function applyPresence(
    target: Character,
    isPresent: boolean,
    reason?: string
  ) {
    if (!session) return;

    const presentIds = new Set(presentCharacters.map((item) => item.id));

    // Порядок присутствующих всегда повторяет порядок состава.
    const nextIds = participants
      .map((item) => item.id)
      .filter((id) =>
        id === target.id ? isPresent : presentIds.has(id)
      );

    const nextReasons = { ...(session.absentReasons ?? {}) };

    if (isPresent) {
      delete nextReasons[target.id];
    } else if (reason?.trim()) {
      nextReasons[target.id] = reason.trim().slice(0, 120);
    }

    await commitPatch({
      presencePatch: { activeCharacterIds: nextIds, absentReasons: nextReasons },
      sourceKind: "user_turn",
      sourceSnapshotAt: Date.now(),
    });

    if (!isPresent && targetCharacterId === target.id) {
      setTargetCharacterId(null);
    }
  }

  /**
   * Сцена живёт сама: модель может вернуть героя из-за кадра (мета-поле
   * `returned`) или, наоборот, увести его по сюжету (`left`). Оба изменения
   * применяем одним обновлением ветки и показываем игроку тостом.
   */
  function handleTogglePresence(target: Character, isPresent: boolean) {
    if (isPresent) {
      void applyPresence(target, true);
      return;
    }

    // Убираем из сцены: спросим причину — она уходит в промпт сцены.
    if (presentCharacters.length <= 1) return;
    setPresencePrompt(target);
  }

  /** Дать ход одному участнику сцены (кнопка у его имени). */
  async function handleRequestTurn(characterId: string) {
    if (!session || sending) return;

    const speaker =
      presentCharacters.find((item) => item.id === characterId) ??
      participants.find(
        (item) => item.id === characterId && presence.present.includes(item)
      );
    if (!speaker) return;

    const full = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");

    setDirectorOpen(false);
    await callModelAndAppend(full, true, [speaker]);
  }

  /**
   * Изолированный ответ отсутствующего персонажа на дистанционное сообщение
   * игрока (ТЗ §6.3). Контекст ограничен самой веткой переписки: персонаж
   * физически не в сцене и не знает, что там сейчас происходит.
   */
  async function handleRemoteReply(target: Character, full: Message[]) {
    if (!session || !character || !apiConfig || !userProfile || sending) return;

    setSending(true);
    setLiveStreamedText("");
    setErrorMsg(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Ветка переписки: дистанционные сообщения персонажа + ответы игрока ему.
      const thread = full
        .filter(
          (message) =>
            (message.sender === "assistant" &&
              message.characterId === target.id &&
              (Boolean(message.remoteKind) ||
                message.isRemoteReply ||
                (message.presentCharacterIds &&
                  !message.presentCharacterIds.includes(target.id)))) ||
            (message.sender === "user" &&
              (message.addressedTo === target.id ||
                message.targetCharacterId === target.id))
        )
        .slice(-12);

      const speakerStats = statsFor(target.id);
      const speakerMemory = getParticipantMemory(session, target.id);
      const isLocal = isLocalEndpoint(apiConfig.baseUrl);

      // Убираем из системного контекста общую сцену, режиссёрские заметки,
      // факты и связи основной ветки: отсутствующий персонаж не должен
      // получить метазнание только из-за дистанционного ответа.
      const remoteSession = {
        ...session,
        isGroup: false,
        characterIds: [],
        activeCharacterIds: undefined,
        absentReasons: {},
        relations: [],
        summary: "",
        storyLog: [],
        extractedFacts: [],
        directorNotes: "",
      };

      const basePrompt = buildSystemPrompt(
        target,
        remoteSession,
        userProfile,
        [],
        isLocal,
        {
          others: [], // вне сцены: групповые правила и ростер не добавляются
          currentStats: speakerStats,
          absent: [],
          relations: [],
          personalMemory: {
            privateNotes: speakerMemory.privateNotes,
            intention: speakerMemory.intention,
          },
        }
      );

      const systemPrompt = `${basePrompt}\n\nТы отвечаешь на СМС/сообщение от ${userProfile.name}, находясь ФИЗИЧЕСКИ ВНЕ основной сцены — ты сейчас не там, где происходит основное действие. Отвечай только текстом сообщения, коротко и естественно, как в переписке, а не как в личной встрече. Ты не видишь и не знаешь, что происходит в основной сцене прямо сейчас, если это не было тебе сообщено в этой переписке.`;

      const turns = messagesToTurns(thread);

      setStreamingCharacterId(target.id);
      const parsed = await requestRoleplayReply(
        apiConfig,
        systemPrompt,
        turns,
        (chunk) => setLiveStreamedText(chunk),
        speakerStats,
        controller.signal
      );

      if (parsed.metaWarning) showMetaNotice(parsed.metaWarning);

      const newStats = parsed.stats ?? speakerStats;
      const remoteChannel =
        thread
          .slice()
          .reverse()
          .find(
            (message) =>
              message.sender === "assistant" &&
              message.remoteKind &&
              !message.isRemoteReply
          )?.remoteKind ?? "message";

      const replyMessage: Message = {
        id: newId(),
        sessionId: session.id,
        sender: "assistant",
        characterId: target.id,
        characterName: target.name,
        presentCharacterIds: [],
        remoteKind: remoteChannel,
        isRemoteReply: true,
        swipes: [parsed.text || "..."],
        currentSwipeIndex: 0,
        innerThought: parsed.innerThought,
        statsSnapshot: newStats,
        statsDelta: computeStatsDelta(speakerStats, newStats),
        timestamp: Date.now(),
      };

      // Ответ, шкалы и возможное новое намерение — один атомарный
      // логический шаг. Сам персонаж остаётся absent: remote не меняет
      // activeCharacterIds и не возвращает его в обычную маршрутизацию.
      const remotePatch: SceneSessionPatch = {
        statsPatch:
          target.id === character.id
            ? { leader: newStats }
            : { participants: { [target.id]: newStats } },
        sourceKind: "user_turn",
        sourceSnapshotAt: Date.now(),
      };
      if (isGroupScene && (parsed.intention || parsed.resolvedIntention)) {
        remotePatch.participantMemoryPatch = {
          [target.id]: {
            intention: parsed.intention
              ? {
                  text: parsed.intention.text,
                  scope: parsed.intention.scope,
                  createdAtMessageId: replyMessage.id,
                  origin: "scene",
                }
              : null,
          },
        };
      }
      await commitPatch(remotePatch, [replyMessage]);

      if (isGroupScene) void runSceneUpkeep(null).catch(() => {});
    } catch (cause) {
      if (!isAbortError(cause)) {
        setErrorMsg(
          cause instanceof Error ? cause.message : "Ошибка при получении ответа."
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
      setLiveStreamedText("");
      setStreamingCharacterId(null);
    }
  }

  async function handleSend(text: string) {
    if (!session) return;

    const target = activeTarget;
    const targetIsRemote = target
      ? !presentCharacters.some((item) => item.id === target.id)
      : false;

    const userMessage: Message = {
      id: newId(),
      sessionId: session.id,
      sender: "user",
      swipes: [text],
      currentSwipeIndex: 0,
      addressedTo: target?.id,
      targetCharacterId: target?.id,
      // Помечаем ответ отсутствующему герою как приватный remote-thread:
      // обычные персонажи не должны увидеть даже пользовательскую часть SMS.
      remoteKind: targetIsRemote ? "message" : undefined,
      presentCharacterIds: isGroupScene
        ? presentCharacters.map((item) => item.id)
        : undefined,
      timestamp: Date.now(),
    };

    await db.messages.add(userMessage);
    await db.sessions.update(session.id, {
      updatedAt: Date.now(),
    });

    const full = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");

    setTargetCharacterId(null);

    // Адресат — отсутствующий персонаж, вышедший на связь дистанционно:
    // отвечаем ему отдельной изолированной веткой переписки (ТЗ §6.3).
    if (target && targetIsRemote) {
      await handleRemoteReply(target, full);
      return;
    }

    await callModelAndAppend(full, false, target ? [target] : undefined, target?.name);
  }

  async function handleContinue() {
    if (!session || sending) return;

    const full = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");

    // Группа: «Продолжить» передаёт ход следующему, чтобы он среагировал
    // на услышанное, а не повторял предыдущего.
    if (isGroupScene) {
      const next = nextSpeaker(
        presentCharacters.length > 0 ? presentCharacters : participants,
        lastAssistantSpeakerId(full)
      );

      if (!next) return;

      await callModelAndAppend(full, true, [next]);
      return;
    }

    await callModelAndAppend(full, true);
  }

  async function handleRegenerate(message: Message) {
    if (!allMessages || !session) return;

    const index = allMessages.findIndex((item) => item.id === message.id);
    const context = allMessages.slice(0, index);
    const isLocal = isLocalEndpoint(apiConfig!.baseUrl);
    // Групповая сцена: переписываем реплику того же персонажа, что её написал.
    const speaker = speakerFor(message);
    const speakerStats = statsFor(speaker.id);

    setSending(true);
    setLiveStreamedText("");
    setErrorMsg(null);
    isNearBottomRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const isSteppedWindow = apiConfig!.steppedContextEnabled !== false;
      const recent = getSliceForContext(
        context,
        apiConfig!.contextWindow,
        isSteppedWindow
      );
      const sceneRecent = recent.filter(
        (item) =>
          !isRemoteThreadMessage(item, participants, presentCharacters)
      );

      const systemPrompt = buildSystemPrompt(
        speaker,
        session,
        userProfile!,
        sceneRecent,
        isLocal,
        isGroupScene
          ? {
              others: othersFor(speaker.id),
              currentStats: speakerStats,
              absent: absentCharacters,
              relations: session.relations,
              personalMemory: (() => {
                const memory = getParticipantMemory(session, speaker.id);
                return {
                  privateNotes: memory.privateNotes,
                  intention: memory.intention,
                };
              })(),
            }
          : undefined
      );
      const turns = isGroupScene
        ? messagesToTurns(sceneRecent, turnLabelFor(speaker.id))
        : messagesToTurns(sceneRecent);

      setStreamingCharacterId(speaker.id);
      setLiveStreamedText("");

      const parsed = await requestRoleplayReply(
        apiConfig!,
        systemPrompt,
        turns,
        (chunk) => {
          setLiveStreamedText(chunk);
        },
        speakerStats,
        controller.signal
      );

      if (parsed.metaWarning) showMetaNotice(parsed.metaWarning);

      // Перегенерация тоже формирует единый патч: состояние сцены и новая
      // свайп-реплика записываются атомарно, без промежуточного состояния.
      const regeneratePatch: SceneSessionPatch = {
        sourceKind: "regenerate",
        sourceSnapshotAt: Date.now(),
      };

      if (parsed.returnedNames?.length || parsed.left?.length) {
        const returning = matchReturnedCharacters(
          parsed.returnedNames ?? [],
          absentCharacters.map((item) => item.character)
        );
        const leaving = matchLeftCharacters(parsed.left ?? [], presentCharacters);
        const presentIds = new Set(presentCharacters.map((item) => item.id));
        const returningIds = new Set(returning.map((item) => item.id));
        const leavingIds = new Set(leaving.map((item) => item.character.id));
        const nextIds = participants
          .map((item) => item.id)
          .filter(
            (id) =>
              (presentIds.has(id) || returningIds.has(id)) &&
              !leavingIds.has(id)
          );
        const nextReasons = { ...(session.absentReasons ?? {}) };
        for (const id of returningIds) delete nextReasons[id];
        for (const item of leaving) {
          const reason = item.reason?.trim().slice(0, 120);
          if (reason) nextReasons[item.character.id] = reason;
          else delete nextReasons[item.character.id];
        }
        if (nextIds.length > 0) {
          regeneratePatch.presencePatch = {
            activeCharacterIds: nextIds,
            absentReasons: nextReasons,
          };
        }
      }

      if (parsed.relations?.length) {
        regeneratePatch.relationsPatch = parsed.relations;
      }
      if (isGroupScene && (parsed.intention || parsed.resolvedIntention)) {
        regeneratePatch.participantMemoryPatch = {
          [speaker.id]: {
            intention: parsed.intention
              ? {
                  text: parsed.intention.text,
                  scope: parsed.intention.scope,
                  createdAtMessageId: message.id,
                  origin: "scene",
                }
              : null,
          },
        };
      }
      if (parsed.sceneShift) regeneratePatch.sceneShiftPatch = parsed.sceneShift;

      const newStats = parsed.stats ?? speakerStats;
      regeneratePatch.statsPatch =
        speaker.id === character!.id
          ? { leader: newStats }
          : { participants: { [speaker.id]: newStats } };

      let regeneratedText = parsed.text || "...";
      const echoMessages: Message[] = [];
      if (isGroupScene && session.liveScene !== false && othersFor(speaker.id).length > 0) {
        const split = splitLiveSceneReactions(
          regeneratedText,
          othersFor(speaker.id),
          speaker.id
        );
        const matched = split.reactions.filter((reaction) => reaction.character);
        const unmatched = split.reactions.filter((reaction) => !reaction.character);
        if (matched.length > 0) {
          regeneratedText = split.mainText;
          if (unmatched.length > 0) {
            regeneratedText += `\\n${unmatched
              .map((reaction) => `— **${reaction.rawName}:** ${reaction.text}`)
              .join("\\n")}`;
          }
          matched.forEach((reaction, echoIndex) => {
            echoMessages.push({
              id: newId(),
              sessionId: session.id,
              sender: "assistant",
              characterId: reaction.character!.id,
              characterName: reaction.character!.name,
              swipes: [reaction.text],
              currentSwipeIndex: 0,
              presentCharacterIds: presentCharacters.map((item) => item.id),
              isLiveSceneEcho: true,
              timestamp: Date.now() + echoIndex + 1,
            });
          });
        }
      }

      if (regeneratePatch.relationsPatch && echoMessages.length > 0) {
        const echoIds = new Set(
          echoMessages
            .map((item) => item.characterId)
            .filter((id): id is string => Boolean(id))
        );
        regeneratePatch.relationsPatch = regeneratePatch.relationsPatch.filter((relation) => {
          const from = matchReturnedCharacters([relation.from], participants)[0];
          const to = relation.to
            ? matchReturnedCharacters([relation.to], participants)[0]
            : undefined;
          return !echoIds.has(from?.id ?? "") && !echoIds.has(to?.id ?? "");
        });
      }

      const newSwipes = [...message.swipes, regeneratedText];
      await commitPatch(
        regeneratePatch,
        echoMessages,
        [
          {
            id: message.id,
            patch: {
              swipes: newSwipes,
              currentSwipeIndex: newSwipes.length - 1,
              innerThought: parsed.innerThought,
              statsSnapshot: newStats,
              statsDelta: computeStatsDelta(speakerStats, newStats),
              timestamp: Date.now(),
            },
          },
        ]
      );

      const toastsEnabled = session.showRelationshipToasts !== false;

      if (toastsEnabled && parsed.feelingHint && parsed.feelingHint.trim()) {
        showToast({
          title:
            speaker.id === character!.id
              ? parsed.feelingHint.trim()
              : `${speaker.name}: ${parsed.feelingHint.trim()}`,
          type: "feeling",
        });
      }
    } catch (cause) {
      if (!isAbortError(cause)) {
        setErrorMsg(
          cause instanceof Error ? cause.message : "Ошибка регенерации."
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
      setLiveStreamedText("");
      setStreamingCharacterId(null);
    }
  }

  async function compressMemory() {
    if (!allMessages || !session || !apiConfig || !character || !userProfile) {
      return;
    }

    // Группа больше не отправляет старый субъективный facts/diary extractor:
    // он не умеет различать общую хронику и личный слой участника. Кнопка
    // ручного обновления в group flow остаётся рабочей, но обновляет только
    // нейтральный summary через тот же безопасный путь.
    if (isGroupScene) {
      await handleRefreshSummary();
      return;
    }

    if (allMessages.length < 3) return;

    const targetMessages =
      allMessages.length > 20 ? allMessages.slice(-20) : allMessages;

    const transcript = targetMessages
      .map(
        (message) =>
          `${speakerName(message)}: ${message.swipes[message.currentSwipeIndex]}`
      )
      .join("\n");

    try {
      const existingFacts = (session.extractedFacts || []).map((fact) => ({
        keys: fact.keys,
        content: fact.content,
        isPinned: fact.isPinned ?? false,
      }));

      const result = await extractMemoriesAndDiary(
        apiConfig,
        character.name,
        userProfile.name,
        transcript,
        existingFacts,
        othersInScene
      );

      const existingDiary = session.diary || [];

      const newDiaryEntry = {
        id: newId(),
        timestamp: Date.now(),
        entryNumber: existingDiary.length + 1,
        thought: result.diaryThought,
        mood: result.mood,
      };

      const updatedFacts = result.activeFacts.map((fact) => ({
        id: newId(),
        keys: fact.keys || [],
        content: fact.content,
        createdAt: Date.now(),
        isPinned: fact.isPinned ?? false,
      }));

      const currentStoryLog: StoryLogEntry[] = session.storyLog
        ? [...session.storyLog]
        : [];

      if (result.summary && result.summary.trim()) {
        currentStoryLog.push({
          id: newId(),
          timestamp: Date.now(),
          text: result.summary.trim(),
        });
      }

      let combinedSummary = session.summary || "";

      if (result.summary && result.summary.trim()) {
        combinedSummary = combinedSummary
          ? `${combinedSummary}\n${result.summary.trim()}`
          : result.summary.trim();
      }

      await db.sessions.update(session.id, {
        summary: combinedSummary,
        storyLog: currentStoryLog,
        diary: [...existingDiary, newDiaryEntry],
        extractedFacts: updatedFacts,
        memoryExtractedCount: allMessages.length,
        updatedAt: Date.now(),
      });

      lastExtractedMsgCountRef.current = allMessages.length;
      unsavedMessagesRef.current = 0;

      // Видно, что память действительно пишется (и сколько записей ушло).
      if (session.showRelationshipToasts !== false) {
        showToast({
          title: `Память обновлена: ${updatedFacts.length} якорей, дневник и синопсис`,
          type: "status",
        });
      }
    } catch (cause) {
      console.error("Memory extract error:", cause);
      throw cause;
    }
  }

  async function handleRefreshSummary() {
    if (!session || !apiConfig || !character || !userProfile) return;

    if (isGroupScene) {
      const freshMessages = await db.messages
        .where("sessionId")
        .equals(session.id)
        .sortBy("timestamp");
      const transcript = freshMessages
        .filter(
          (message) =>
            !message.isLiveSceneEcho &&
            !isRemoteThreadMessage(message, participants, presentCharacters)
        )
        .map(
          (message) =>
            `${speakerName(message)}: ${message.swipes[message.currentSwipeIndex] ?? ""}`
        )
        .join("\n");
      if (!transcript.trim()) return;

      const freshSummary = await requestNeutralChronicle(
        apiConfig,
        transcript,
        session.summary ?? ""
      );
      if (freshSummary.trim()) {
        await commitPatch({
          summaryPatch: freshSummary.trim(),
          sourceKind: "memory_extraction",
          sourceSnapshotAt: Date.now(),
        });
      }
      return;
    }

    const storyLogText = (session.storyLog || [])
      .map((event, index) => `Эпизод ${index + 1}: ${event.text}`)
      .join("\n");

    const sourceText =
      session.summary?.trim() || storyLogText.trim() || "Начало истории.";

    try {
      const freshSummary = await directCompressStoryToSummary(
        apiConfig,
        character.name,
        userProfile.name,
        sourceText,
        othersInScene
      );

      if (freshSummary && freshSummary.trim().length > 0) {
        await db.sessions.update(session.id, {
          summary: freshSummary.trim(),
          updatedAt: Date.now(),
        });
      }
    } catch (cause) {
      console.error("Refresh summary error:", cause);
      throw cause;
    }
  }

  async function handleRebuildChronicle() {
    if (!allMessages || !session || !apiConfig || !character || !userProfile) {
      return;
    }

    const sourceMessages = isGroupScene
      ? allMessages.filter(
          (message) =>
            !message.isLiveSceneEcho &&
            !isRemoteThreadMessage(message, participants, presentCharacters)
        )
      : allMessages;
    if (sourceMessages.length < 2) return;

    const transcript = sourceMessages
      .map(
        (message, index) =>
          `[#${index + 1}] ${speakerName(message)}: ${message.swipes[message.currentSwipeIndex]}`
      )
      .join("\n");

    try {
      const rawEpisodes = await extractFullChronicleFromChat(
        apiConfig,
        character.name,
        userProfile.name,
        transcript,
        othersInScene
      );

      if (rawEpisodes.length > 0) {
        const firstMessageTime =
          sourceMessages[0]?.timestamp || Date.now() - 3600000;

        const lastMessageTime =
          sourceMessages[sourceMessages.length - 1]?.timestamp || Date.now();

        const timeStep =
          (lastMessageTime - firstMessageTime) /
          Math.max(1, rawEpisodes.length - 1);

        const newStoryLog: StoryLogEntry[] = rawEpisodes.map((text, index) => ({
          id: newId(),
          timestamp: Math.round(firstMessageTime + index * timeStep),
          text: text.replace(/^\d+[\.\)]\s*/, "").trim(),
        }));

        await db.sessions.update(session.id, {
          storyLog: newStoryLog,
          updatedAt: Date.now(),
        });
      }
    } catch (cause) {
      console.error("Rebuild chronicle error:", cause);
      throw cause;
    }
  }

  async function handleToggleNovelMode() {
    if (!session) return;

    const next = !novelMode;
    const container = scrollRef.current;

    if (next) {
      const anchor = captureReadingAnchor();

      savedChatPositionRef.current = {
        anchor,
        scrollTop: container?.scrollTop ?? 0,
      };

      pendingReadingPositionRef.current = {
        mode: "novel",
        anchor,
        fallbackScrollTop: 0,
      };
    } else {
      const savedPosition = savedChatPositionRef.current;

      pendingReadingPositionRef.current = {
        mode: "chat",
        anchor: savedPosition?.anchor ?? null,
        fallbackScrollTop: savedPosition?.scrollTop ?? 0,
      };
    }

    setNovelMode(next);

    await db.sessions.update(session.id, {
      novelMode: next,
    });
  }

  const handleUpdateThoughtMode = async (mode: ThoughtMode) => {
    if (!session) return;
    await db.sessions.update(session.id, { thoughtMode: mode });
  };

  const stats = session.currentStats;

  /**
   * Последний сдвиг шкал каждого участника: берём самый свежий ответ
   * соответствующего персонажа. Если данных об ответе нет (старые сообщения
   * или ответ без мета-блока) — оставляем undefined и панель ничего не
   * показывает; подтягивать более старые дельты нельзя, это был бы уже
   * не «последний ответ».
   *
   * Важно: это обычное вычисление, а не useMemo — компонент выше делает
   * ранний return, пока данные не загрузились, и любой хук после этой
   * точки ломает порядок хуков между рендерами («Rendered more hooks»).
   * Цикл дешёвый: обрывается на первом ответе каждого участника.
   */
  const lastStatsDeltas: Record<string, RelationshipDelta | undefined> = {};

  for (let index = allMessages.length - 1; index >= 0; index -= 1) {
    const message = allMessages[index];
    if (
      message.sender !== "assistant" ||
      message.isLiveSceneEcho ||
      isRemoteThreadMessage(message, participants, presentCharacters)
    ) {
      continue;
    }

    const speakerId = message.characterId ?? character.id;
    if (speakerId in lastStatsDeltas) continue;

    lastStatsDeltas[speakerId] = message.statsDelta;
  }

  const activeWallpaper = session.wallpaperUrl || character.wallpaperUrl;
  const blurValue = session.wallpaperBlur ?? 0;
  const dimValue = session.wallpaperDim ?? 0.55;

  const characterTagline =
    character.tagline?.trim() ||
    character.genre?.trim() ||
    (character.tags && character.tags.length > 0 ? character.tags.join(" · ") : "") ||
    session.currentStats?.statusTitle ||
    "";

  return (
    <div className="fixed inset-0 z-40 flex h-screen w-full min-w-0 flex-col overflow-hidden bg-[#090b10] text-content supports-[height:100dvh]:h-dvh">
      {activeWallpaper && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
          <img
            src={activeWallpaper}
            alt=""
            draggable={false}
            className="h-full w-full object-cover object-center"
            style={{
              filter: blurValue ? `blur(${blurValue}px)` : undefined,
              transform: blurValue ? "scale(1.08)" : undefined,
            }}
          />
          <div
            className="absolute inset-0 bg-[#090b10]"
            style={{ opacity: dimValue }}
          />
        </div>
      )}

      {/* Верхняя панель (Шапка чата) */}
      <header className="relative z-20 shrink-0 border-b border-white/[0.07] bg-[#0c0f15]/90 backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-3 py-2.5 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={onBack}
              aria-label="Вернуться из чата"
              title="Назад"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-content-secondary transition-colors hover:bg-white/[0.06] hover:text-content"
            >
              <ArrowLeft size={20} />
            </button>

            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left transition-all"
            >
              <Avatar
                src={character.avatarUrl}
                name={character.name}
                size={42}
                className="ring-2 ring-white/[0.12] transition-all group-hover:ring-accent/60"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-bold text-zinc-100 group-hover:text-accent sm:text-base">
                  <span className="truncate">{character.name}</span>
                  {isGroupScene && (
                    <span
                      title={`Групповая сцена. В комнате: ${presentCharacters
                        .map((item) => item.name)
                        .join(", ")}${
                        absentCharacters.length > 0
                          ? `. За кадром: ${absentCharacters
                              .map(
                                (item) =>
                                  `${item.character.name}${
                                    item.reason ? ` (${item.reason})` : ""
                                  }`
                              )
                              .join(", ")}`
                          : ""
                      }`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/35 bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent"
                    >
                      <Users size={11} strokeWidth={2.2} />
                      {absentCharacters.length > 0
                        ? `${presentCharacters.length}/${participants.length}`
                        : participants.length}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-content-muted">
                  {isGroupScene
                    ? `в сцене: ${
                        presentCharacters
                          .filter((item) => item.id !== character.id)
                          .map((item) => item.name)
                          .join(", ") || "только вы двое"
                      }`
                    : characterTagline}
                </p>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <StatsBadge stats={stats} onClick={() => setStatsOpen(true)} />

            <button
              type="button"
              onClick={() => void handleToggleNovelMode()}
              aria-pressed={novelMode}
              title={novelMode ? "Вернуться к чату" : "Режим книги"}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-all",
                novelMode
                  ? "border-accent/50 bg-accent/20 text-accent shadow-sm"
                  : "border-white/[0.07] bg-[#121622]/80 text-content-muted hover:text-content hover:bg-[#161b28]"
              )}
            >
              <BookOpen size={18} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {isGroupScene && (
          <ScenePresenceBar
            cast={participants}
            present={presentCharacters}
            remoteIds={remotePendingCharacters.map((item) => item.id)}
            disabled={sending}
            onToggle={handleTogglePresence}
          />
        )}

        <RelationshipToast toast={toast} className="absolute top-full mt-3" />
      </header>

      {/* Лента сообщений */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={cn(
          "relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain",
          !novelMode && "flex flex-col-reverse"
        )}
      >
        {novelMode ? (
          <NovelReader
            messages={allMessages}
            character={character}
            userProfile={userProfile}
            resolveSpeakerName={speakerName}
          />
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col-reverse gap-4 px-3 py-6 sm:px-6">
            {sending && (
              <TypingBubble
                character={typingCharacter}
                streamedText={liveStreamedText}
              />
            )}

            {errorMsg && (
              <ErrorBubble
                character={character}
                error={errorMsg}
                onRetry={() => void handleRetry()}
                onDismiss={() => setErrorMsg(null)}
              />
            )}

            {reversedMessages.map((message, index) => {
              const previousMessage = reversedMessages[index + 1];
              const isNewDay =
                !previousMessage ||
                new Date(message.timestamp).toDateString() !==
                  new Date(previousMessage.timestamp).toDateString();

              return (
                <React.Fragment key={message.id}>
                  <MessageBubble
                    message={message}
                    character={speakerFor(message)}
                    userProfile={userProfile}
                    isLastAssistant={message.id === lastAssistantId}
                    isLastUser={
                      message.id === lastMessage?.id &&
                      lastMessage?.sender === "user"
                    }
                    disableTypewriter={apiConfig?.streamEnabled !== false}
                    onRetry={handleRetry}
                    onEdit={async (text) => {
                      const swipes = [...message.swipes];
                      swipes[message.currentSwipeIndex] = text;
                      await db.messages.update(message.id, { swipes });
                    }}
                    onDelete={() => setPendingDeleteId(message.id)}
                    onSwipe={async (direction) => {
                      const next = message.currentSwipeIndex + direction;
                      if (next < 0 || next >= message.swipes.length) return;
                      await db.messages.update(message.id, {
                        currentSwipeIndex: next,
                      });
                    }}
                    onRegenerate={() => handleRegenerate(message)}
                    onShowThought={() => setThoughtMessage(message)}
                  />

                  {isNewDay && (
                    <div className="flex justify-center py-2.5">
                      <span className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#121622]/80 px-3.5 py-1 text-xs font-medium text-content-muted backdrop-blur-xl">
                        <BookOpen size={13} className="text-accent" />
                        <span>{formatDateDivider(message.timestamp)}</span>
                      </span>
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {hasMore && (
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleLimit((prev) => Math.min(prev + PAGE_STEP, totalCount))
                  }
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-[#121622]/90 px-4 py-2 text-xs font-medium text-content-secondary hover:bg-[#161b28] hover:text-content"
                >
                  <MessagesSquare size={14} />
                  <span>Показать предыдущие сообщения</span>
                </button>
              </div>
            )}

            {allMessages.length === 0 && !sending && !errorMsg && (
              <div className="mx-auto my-12 max-w-sm rounded-3xl border border-white/[0.07] bg-[#121622]/80 p-8 text-center backdrop-blur-xl">
                <MessagesSquare size={28} className="mx-auto mb-3 text-accent" />
                <p className="text-sm font-semibold text-zinc-100">
                  В этой ветке пока нет сообщений
                </p>
                <p className="mt-1 text-xs text-content-secondary">
                  Напишите реплику или передайте ход персонажу.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Нижняя консоль ввода */}
      <div className="relative z-20 shrink-0 border-t border-white/[0.07] bg-[#0c0f15]/90 backdrop-blur-2xl">
        <div className="relative mx-auto max-w-4xl">
          {showScrollBottom && (
            <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-end px-4 pb-3">
              <button
                type="button"
                onClick={() => scrollToBottom(true)}
                title="К последним сообщениям"
                className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#161b28]/90 text-content-secondary shadow-xl backdrop-blur-xl transition-all hover:border-accent/40 hover:text-accent"
              >
                <ChevronDown size={20} />
              </button>
            </div>
          )}

          {metaNotice && (
            <div
              role="status"
              className="mx-3 mb-2 flex items-start gap-2 rounded-2xl border border-warning/25 bg-warning/[0.08] px-3 py-2 text-[11px] leading-relaxed text-warning"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{metaNotice}</span>
              <button
                type="button"
                onClick={() => setMetaNotice(null)}
                aria-label="Скрыть уведомление"
                className="shrink-0 rounded-lg px-1.5 text-warning/70 hover:text-warning"
              >
                <X size={13} />
              </button>
            </div>
          )}

          <InputBar
            onSend={handleSend}
            onOpenDirector={() => setDirectorOpen(true)}
            onRequestSuggestions={handleGetSuggestions}
            onContinue={handleContinue}
            onStop={handleStop}
            sending={sending}
            characterName={character.name}
            modelName={apiConfig?.model || "AI Model"}
            groupScene={isGroupScene}
            participants={
              isGroupScene
                ? [
                    ...presentCharacters.map((item) => ({
                      id: item.id,
                      name: item.name,
                      avatarUrl: item.avatarUrl,
                      remote: false,
                    })),
                    ...remotePendingCharacters.map((item) => ({
                      id: item.id,
                      name: item.name,
                      avatarUrl: item.avatarUrl,
                      remote: true,
                    })),
                  ]
                : undefined
            }
            targetId={activeTarget?.id ?? null}
            onSelectTarget={(characterId) =>
              setTargetCharacterId((prev) =>
                prev === characterId ? null : characterId
              )
            }
          />
        </div>
      </div>

      <StatsPanel
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        stats={stats}
        delta={lastStatsDeltas[character.id]}
        participants={
          isGroupScene
            ? participants.map((item) => ({
                id: item.id,
                name: item.name,
                avatarUrl: item.avatarUrl,
                stats: statsFor(item.id),
                delta: lastStatsDeltas[item.id],
              }))
            : undefined
        }
        activeParticipantId={character.id}
      />

      <DirectorPanel
        open={directorOpen}
        onClose={() => setDirectorOpen(false)}
        session={session}
        messageCount={totalCount}
        onUpdateNotes={(notes) =>
          db.sessions.update(session.id, { directorNotes: notes })
        }
        onUpdateSummary={(summary) =>
          db.sessions.update(session.id, { summary })
        }
        onUpdateDim={(dim) =>
          db.sessions.update(session.id, { wallpaperDim: dim })
        }
        onUpdateBlur={(blur) =>
          db.sessions.update(session.id, { wallpaperBlur: blur })
        }
        onUpdateWallpaper={(url) =>
          db.sessions.update(session.id, { wallpaperUrl: url })
        }
        onToggleDynamicEvents={(enabled) =>
          db.sessions.update(session.id, {
            dynamicEvents: enabled,
            suspenseMode: enabled ? false : session.suspenseMode,
          })
        }
        onToggleSuspenseMode={(enabled) =>
          db.sessions.update(session.id, {
            suspenseMode: enabled,
            dynamicEvents: enabled ? false : session.dynamicEvents,
          })
        }
        onToggleNaturalSpeech={(enabled) =>
          db.sessions.update(session.id, { naturalSpeech: enabled })
        }
        onToggleToasts={(enabled) =>
          db.sessions.update(session.id, { showRelationshipToasts: enabled })
        }
        onTogglePacing={(enabled) =>
          db.sessions.update(session.id, { realisticPacing: enabled })
        }
        onUpdateThoughtMode={handleUpdateThoughtMode}
        onRequestTurn={(characterId) => void handleRequestTurn(characterId)}
        onTogglePresence={(characterId, isPresent, reason) => {
          const target = participants.find((item) => item.id === characterId);
          if (!target) return;
          void applyPresence(target, isPresent, reason);
        }}
        onToggleLiveScene={(enabled) => {
          void commitPatch({
            settingsPatch: { liveScene: enabled },
            sourceKind: "user_turn",
            sourceSnapshotAt: Date.now(),
          });
        }}
        onUpdateParticipantMemory={(characterId, patch) =>
          commitPatch({
            participantMemoryPatch: { [characterId]: patch },
            sourceKind: "user_turn",
            sourceSnapshotAt: Date.now(),
          })
        }
        onToggleOffscreenLife={(enabled) => {
          void commitPatch({
            settingsPatch: { offscreenLifeEnabled: enabled },
            sourceKind: "user_turn",
            sourceSnapshotAt: Date.now(),
          });
        }}
        onUpdateOffscreenInterval={(interval) => {
          void commitPatch({
            settingsPatch: { offscreenTickInterval: interval },
            sourceKind: "user_turn",
            sourceSnapshotAt: Date.now(),
          });
        }}
        onApplyScenePatch={commitPatch}
        presentIds={presentCharacters.map((item) => item.id)}
        sending={sending}
        onOpenInspector={() => setInspectorOpen(true)}
        onCompressMemory={compressMemory}
        onRefreshSummary={handleRefreshSummary}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        tone="danger"
        title="Удалить эту и все последующие реплики?"
        description="История ветки будет откатана до выбранного сообщения. Восстановить удалённое нельзя."
        confirmLabel="Удалить"
        onClose={() => setPendingDeleteId(null)}
        onConfirm={async () => {
          if (!pendingDeleteId) return;
          await rewindToMessage(session.id, pendingDeleteId, false);
          lastExtractedMsgCountRef.current = Math.min(
            lastExtractedMsgCountRef.current,
            Math.max(0, allMessages.length - 1)
          );
          setPendingDeleteId(null);
        }}
      />

      <PromptDialog
        open={presencePrompt !== null}
        title={`Убрать ${presencePrompt?.name ?? "персонажа"} из сцены?`}
        description="Персонаж уходит за кадр: он не сможет отвечать, и модель не будет говорить за него. Причину можно указать — она попадёт в контекст сцены."
        label="Где он сейчас"
        placeholder="ушёл в гараж, спит, уехал…"
        initialValue={
          presencePrompt
            ? session.absentReasons?.[presencePrompt.id] ?? ""
            : ""
        }
        confirmLabel="Убрать из сцены"
        onClose={() => setPresencePrompt(null)}
        onConfirm={async (reason) => {
          const target = presencePrompt;
          setPresencePrompt(null);
          if (target) await applyPresence(target, false, reason);
        }}
      />

      <ThoughtModal
        open={!!thoughtMessage}
        onClose={() => setThoughtMessage(null)}
        thought={thoughtMessage?.innerThought ?? ""}
        characterName={character.name}
        thoughtMode={session.thoughtMode || "censor"}
        onChangeThoughtMode={handleUpdateThoughtMode}
      />

      <CharacterProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        character={character}
        session={session}
        messageCount={totalCount}
        onManualExtractMemory={compressMemory}
        onRebuildChronicle={handleRebuildChronicle}
        onDeleteFact={async (factId) => {
          const updated = (session.extractedFacts || []).filter(
            (fact) => fact.id !== factId
          );
          await db.sessions.update(session.id, { extractedFacts: updated });
        }}
        onAddFact={async (content) => {
          const newFact = {
            id: newId(),
            keys: ["Ручное"],
            content,
            createdAt: Date.now(),
            isPinned: true,
          };
          const updated = [...(session.extractedFacts || []), newFact];
          await db.sessions.update(session.id, { extractedFacts: updated });
        }}
        onTogglePinFact={async (factId) => {
          const updated = (session.extractedFacts || []).map((fact) =>
            fact.id === factId ? { ...fact, isPinned: !fact.isPinned } : fact
          );
          await db.sessions.update(session.id, { extractedFacts: updated });
        }}
        onUpdateFact={async (factId, content) => {
          const updated = (session.extractedFacts || []).map((fact) =>
            fact.id === factId ? { ...fact, content } : fact
          );
          await db.sessions.update(session.id, { extractedFacts: updated });
        }}
        onDeleteStoryEvent={async (eventId) => {
          const updated = (session.storyLog || []).filter(
            (event) => event.id !== eventId
          );
          await db.sessions.update(session.id, { storyLog: updated });
        }}
        onDeleteDiaryEntry={async (entryId) => {
          const updated = (session.diary || []).filter(
            (entry) => entry.id !== entryId
          );
          await db.sessions.update(session.id, { diary: updated });
        }}
      />

      {apiConfig && userProfile && (
        <PromptInspectorModal
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          character={character}
          session={session}
          userProfile={userProfile}
          apiConfig={apiConfig}
          contextMessages={currentContextSlice}
          lastAssistantMessage={lastAssistantMessage}
          participants={participants}
          absent={absentCharacters}
          speakerId={lastAssistantMessage?.characterId ?? character.id}
        />
      )}
    </div>
  );
}