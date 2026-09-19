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
  X,
} from "lucide-react";
import { db, getApiConfig, getUserProfile } from "../../db";
import { newId } from "../../utils/id";
import type {
  ApiConfig,
  Message,
  UserProfile,
  RelationshipStats,
  StoryLogEntry,
  Character,
  ThoughtMode,
} from "../../types";
import { buildSystemPrompt } from "../../services/promptBuilder";
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

const MEMORY_EXTRACT_INTERVAL = 12;
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

  const [visibleLimit, setVisibleLimit] = useState(INITIAL_PAGE_SIZE);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);

  const [statsOpen, setStatsOpen] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [novelMode, setNovelMode] = useState(false);
  const [thoughtMessage, setThoughtMessage] = useState<Message | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [liveStreamedText, setLiveStreamedText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastToastMsgCount = useRef(0);
  const lastExtractedMsgCountRef = useRef(0);
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

    getUserProfile()
      .then((profile) => {
        if (active) setUserProfile(profile);
      })
      .catch((cause) => {
        if (!active) return;
        setInitializationError(
          cause instanceof Error ? cause.message : "Не удалось прочитать профиль."
        );
      });

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
    lastExtractedMsgCountRef.current = 0;
    isNearBottomRef.current = true;

    savedChatPositionRef.current = null;
    pendingReadingPositionRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
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

  const handleGetSuggestions = async (): Promise<string[]> => {
    if (!apiConfig || !character || !userProfile || !messages || !session) {
      return [];
    }

    const recent = messages.slice(-14);
    const transcript = recent
      .map(
        (message) =>
          `${message.sender === "user" ? userProfile.name : character.name}: ${message.swipes[message.currentSwipeIndex]}`
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

  const lastAssistantId = [...allMessages]
    .reverse()
    .find((message) => message.sender === "assistant")?.id;

  const lastMessage = allMessages[allMessages.length - 1];
  const lastAssistantMessage = allMessages.filter((m) => m.sender === "assistant").pop();

  const isStepped = apiConfig.steppedContextEnabled !== false;
  const currentContextSlice = getSliceForContext(
    allMessages,
    apiConfig.contextWindow,
    isStepped
  );

  async function callModelAndAppend(
    contextMessages: Message[],
    isInitiative = false
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

    try {
      const isSteppedWindow = apiConfig.steppedContextEnabled !== false;
      const recent = getSliceForContext(
        contextMessages,
        apiConfig.contextWindow,
        isSteppedWindow
      );

      const systemPrompt = buildSystemPrompt(
        character,
        session,
        userProfile,
        recent,
        isLocal
      );
      const turns = messagesToTurns(recent);

      if (isInitiative) {
        turns.push({
          role: "user",
          content: `[${userProfile.name} молчит или выжидает. ${character.name}, прояви собственную инициативу: продолжи мысль, соверши физическое действие, измени положение, начни новую реплику или нарушь паузу. НЕ говори и НЕ действуй за ${userProfile.name}!]`,
        });
      }

      const parsed = await requestRoleplayReply(
        apiConfig,
        systemPrompt,
        turns,
        (chunk) => {
          setLiveStreamedText(chunk);
        },
        session.currentStats
      );

      const oldStats = session.currentStats;
      const newStats = parsed.stats ?? session.currentStats;

      const assistantMessage: Message = {
        id: newId(),
        sessionId: session.id,
        sender: "assistant",
        swipes: [parsed.text || "..."],
        currentSwipeIndex: 0,
        innerThought: parsed.innerThought,
        statsSnapshot: newStats,
        timestamp: Date.now(),
      };

      await db.messages.add(assistantMessage);
      await db.sessions.update(session.id, {
        currentStats: newStats,
        updatedAt: Date.now(),
      });

      const total = (allMessages?.length ?? 0) + 1;
      const toastsEnabled = session.showRelationshipToasts !== false;

      if (toastsEnabled && parsed.feelingHint && parsed.feelingHint.trim()) {
        showToast({
          title: parsed.feelingHint.trim(),
          type: "feeling",
        });
      } else if (parsed.stats) {
        checkMilestone(oldStats, newStats, total);
      }

      if (total - lastExtractedMsgCountRef.current >= MEMORY_EXTRACT_INTERVAL) {
        lastExtractedMsgCountRef.current = total;
        compressMemory().catch(() => {});
      }
    } catch (cause) {
      setErrorMsg(
        cause instanceof Error ? cause.message : "Ошибка при получении ответа."
      );
    } finally {
      setSending(false);
      setLiveStreamedText("");
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
      await callModelAndAppend(full, false);
    }
  }

  async function handleSend(text: string) {
    if (!session) return;

    const userMessage: Message = {
      id: newId(),
      sessionId: session.id,
      sender: "user",
      swipes: [text],
      currentSwipeIndex: 0,
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

    await callModelAndAppend(full, false);
  }

  async function handleContinue() {
    if (!session || sending) return;

    const full = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");

    await callModelAndAppend(full, true);
  }

  async function handleRegenerate(message: Message) {
    if (!allMessages || !session) return;

    const index = allMessages.findIndex((item) => item.id === message.id);
    const context = allMessages.slice(0, index);
    const isLocal = isLocalEndpoint(apiConfig!.baseUrl);

    setSending(true);
    setLiveStreamedText("");
    setErrorMsg(null);
    isNearBottomRef.current = true;

    try {
      const isSteppedWindow = apiConfig!.steppedContextEnabled !== false;
      const recent = getSliceForContext(
        context,
        apiConfig!.contextWindow,
        isSteppedWindow
      );

      const systemPrompt = buildSystemPrompt(
        character!,
        session,
        userProfile!,
        recent,
        isLocal
      );
      const turns = messagesToTurns(recent);

      const parsed = await requestRoleplayReply(
        apiConfig!,
        systemPrompt,
        turns,
        (chunk) => {
          setLiveStreamedText(chunk);
        },
        session.currentStats
      );

      const newStats = parsed.stats ?? session.currentStats;
      const newSwipes = [...message.swipes, parsed.text || "..."];

      await db.messages.update(message.id, {
        swipes: newSwipes,
        currentSwipeIndex: newSwipes.length - 1,
        innerThought: parsed.innerThought,
        statsSnapshot: newStats,
        timestamp: Date.now(),
      });

      await db.sessions.update(session.id, {
        currentStats: newStats,
        updatedAt: Date.now(),
      });

      const toastsEnabled = session.showRelationshipToasts !== false;

      if (toastsEnabled && parsed.feelingHint && parsed.feelingHint.trim()) {
        showToast({
          title: parsed.feelingHint.trim(),
          type: "feeling",
        });
      }
    } catch (cause) {
      setErrorMsg(
        cause instanceof Error ? cause.message : "Ошибка регенерации."
      );
    } finally {
      setSending(false);
      setLiveStreamedText("");
    }
  }

  async function compressMemory() {
    if (!allMessages || !session || !apiConfig || !character || !userProfile) {
      return;
    }

    if (allMessages.length < 3) return;

    const targetMessages =
      allMessages.length > 20 ? allMessages.slice(-20) : allMessages;

    const transcript = targetMessages
      .map(
        (message) =>
          `${message.sender === "user" ? userProfile.name : character.name}: ${message.swipes[message.currentSwipeIndex]}`
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
        existingFacts
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
        updatedAt: Date.now(),
      });
    } catch (cause) {
      console.error("Memory extract error:", cause);
      throw cause;
    }
  }

  async function handleRefreshSummary() {
    if (!session || !apiConfig || !character || !userProfile) return;

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
        sourceText
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

    if (allMessages.length < 2) return;

    const transcript = allMessages
      .map(
        (message, index) =>
          `[#${index + 1}] ${message.sender === "user" ? userProfile.name : character.name}: ${message.swipes[message.currentSwipeIndex]}`
      )
      .join("\n");

    try {
      const rawEpisodes = await extractFullChronicleFromChat(
        apiConfig,
        character.name,
        userProfile.name,
        transcript
      );

      if (rawEpisodes.length > 0) {
        const firstMessageTime =
          allMessages[0]?.timestamp || Date.now() - 3600000;

        const lastMessageTime =
          allMessages[allMessages.length - 1]?.timestamp || Date.now();

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
                <p className="truncate text-sm font-bold text-zinc-100 group-hover:text-accent sm:text-base">
                  {character.name}
                </p>
                {characterTagline && (
                  <p className="truncate text-xs text-content-muted">
                    {characterTagline}
                  </p>
                )}
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
          />
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col-reverse gap-4 px-3 py-6 sm:px-6">
            {sending && (
              <TypingBubble character={character} streamedText={liveStreamedText} />
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
                    character={character}
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

          <InputBar
            onSend={handleSend}
            onOpenDirector={() => setDirectorOpen(true)}
            onRequestSuggestions={handleGetSuggestions}
            onContinue={handleContinue}
            sending={sending}
            characterName={character.name}
            modelName={apiConfig?.model || "AI Model"}
          />
        </div>
      </div>

      <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} stats={stats} />

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
        />
      )}
    </div>
  );
}