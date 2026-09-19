import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, BookOpen, ChevronDown, MessagesSquare, RotateCcw } from "lucide-react";
import { db, getApiConfig, getUserProfile } from "../../db";
import { newId } from "../../utils/id";
import type { ApiConfig, Message, UserProfile, RelationshipStats } from "../../types";
import { buildSystemPrompt } from "../../services/promptBuilder";
import { messagesToTurns, requestRoleplayReply, requestSuggestedReplies } from "../../services/apiClient";
import { extractMemoriesAndDiary } from "../../services/memoryEngine";
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
import { RelationshipToast, type ToastData } from "./RelationshipToast";

const MEMORY_EXTRACT_INTERVAL = 12; // Частота автоанализа сцены

export function ChatView({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId]);
  const character = useLiveQuery(
    () => (session ? db.characters.get(session.characterId) : undefined),
    [session?.characterId]
  );
  const messages = useLiveQuery(
    () => db.messages.where("sessionId").equals(sessionId).sortBy("timestamp"),
    [sessionId]
  );

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [novelMode, setNovelMode] = useState(false);
  const [thoughtMessage, setThoughtMessage] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  
  const isInitialMountedRef = useRef(false);
  const prevMsgCountRef = useRef<number>(0);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastToastMsgCount = useRef<number>(0);
  const lastExtractedMsgCountRef = useRef<number>(0);
  const lastStatusRef = useRef<string>("");

  useEffect(() => {
    getUserProfile().then(setUserProfile);
    getApiConfig().then(setApiConfig);
  }, []);

  useEffect(() => {
    if (session) {
      setNovelMode(!!session.novelMode);
      if (!lastStatusRef.current && session.currentStats?.statusTitle) {
        lastStatusRef.current = session.currentStats.statusTitle;
      }
    }
  }, [session?.id]);

  // Сброс состояния при переключении между сессиями
  useEffect(() => {
    isInitialMountedRef.current = false;
    setShowScrollBottom(false);
    lastToastMsgCount.current = 0;
    prevMsgCountRef.current = 0;
    lastExtractedMsgCountRef.current = 0;
  }, [sessionId]);

  // Гарантированная принудительная прокрутка на дно
  const scrollToBottomInstant = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  // 1. Автоматическое удержание дна при монтировании и подгрузке тяжелой истории
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !messages || messages.length === 0) return;

    if (!isInitialMountedRef.current) {
      scrollToBottomInstant();

      // Наблюдатель за ростом высоты контента при рендере сотен сообщений
      const target = contentWrapperRef.current || container;
      let active = true;

      const observer = new ResizeObserver(() => {
        if (!active || !scrollRef.current) return;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });

      observer.observe(target);

      // Отключаем наблюдатель через 800 мс после того, как все сообщения стабилизировались
      const timeout = setTimeout(() => {
        active = false;
        observer.disconnect();
        isInitialMountedRef.current = true;
        scrollToBottomInstant();
      }, 800);

      prevMsgCountRef.current = messages.length;
      lastExtractedMsgCountRef.current = messages.length;

      return () => {
        active = false;
        observer.disconnect();
        clearTimeout(timeout);
      };
    }

    // 2. Обработка новых сообщений в ходе живой игры
    if (messages.length > prevMsgCountRef.current) {
      const lastMsg = messages[messages.length - 1];

      if (lastMsg.sender === "user") {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      } else if (lastMsg.sender === "assistant") {
        requestAnimationFrame(() => {
          const msgEl = document.getElementById(`msg-${lastMsg.id}`);
          if (msgEl) {
            msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          }
        });
      }
      prevMsgCountRef.current = messages.length;
    }
  }, [messages, sessionId]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollBottom(distanceFromBottom > 140);
  };

  const scrollToBottom = (smooth = true) => {
    if (scrollRef.current) {
      if (smooth) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      } else {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  };

  const showToast = (data: ToastData) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(data);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 5000);
  };

  const checkMilestone = (oldS: RelationshipStats, newS: RelationshipStats, msgCount: number) => {
    const toastsEnabled = session?.showRelationshipToasts !== false;
    if (!toastsEnabled) return;

    if (msgCount - lastToastMsgCount.current < 3) return;

    if (newS.statusTitle && newS.statusTitle !== oldS.statusTitle && newS.statusTitle !== lastStatusRef.current) {
      lastStatusRef.current = newS.statusTitle;
      showToast({ title: `Новый этап: «${newS.statusTitle}»`, type: "status" });
      lastToastMsgCount.current = msgCount;
      return;
    }

    const crossTier = (val1: number, val2: number, tier: number) => val1 < tier && val2 >= tier;

    if (crossTier(oldS.affection, newS.affection, 85)) {
      showToast({ title: `Глубокая привязанность: «${newS.statusTitle || "Любовь"}»`, type: "affection" });
      lastToastMsgCount.current = msgCount;
      return;
    }
    if (crossTier(oldS.affection, newS.affection, 50)) {
      showToast({ title: `Привязанность растёт: «${newS.statusTitle || "Сближение"}»`, type: "affection" });
      lastToastMsgCount.current = msgCount;
      return;
    }
    if (crossTier(oldS.affection, newS.affection, 25)) {
      showToast({ title: `Первая искра интереса...`, type: "affection" });
      lastToastMsgCount.current = msgCount;
      return;
    }

    if (crossTier(oldS.trust, newS.trust, 75)) {
      showToast({ title: `Высокое доверие: персонаж открывает душу`, type: "trust" });
      lastToastMsgCount.current = msgCount;
      return;
    }
    if (crossTier(oldS.trust, newS.trust, 40)) {
      showToast({ title: `Лёд тает: доверие начинает крепнуть`, type: "trust" });
      lastToastMsgCount.current = msgCount;
      return;
    }

    if (crossTier(oldS.tension, newS.tension, 55)) {
      showToast({ title: "Эмоциональное напряжение нарастает...", type: "tension" });
      lastToastMsgCount.current = msgCount;
      return;
    }
  };

  const handleGetSuggestions = async (): Promise<string[]> => {
    if (!apiConfig || !character || !userProfile || !messages) return [];
    const recent = messages.slice(-14);
    const transcript = recent
      .map((m) => `${m.sender === "user" ? userProfile.name : character.name}: ${m.swipes[m.currentSwipeIndex]}`)
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

  if (!session || !character || !userProfile || !apiConfig || !messages) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan border-t-transparent" />
      </div>
    );
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.sender === "assistant")?.id;
  const lastMsg = messages[messages.length - 1];
  const isLastMsgUser = lastMsg?.sender === "user";

  async function callModelAndAppend(contextMessages: Message[], isInitiative = false) {
    if (!apiConfig || !character || !session || !userProfile) return;
    if (apiConfig.mode === "openai" && !apiConfig.baseUrl) {
      setErrorMsg("Укажите Base URL в настройках API.");
      return;
    }
    if (!apiConfig.apiKey) {
      setErrorMsg("Укажите API-ключ в настройках.");
      return;
    }

    setSending(true);
    setErrorMsg(null);

    try {
      const recent = contextMessages.slice(-apiConfig.contextWindow);
      const systemPrompt = buildSystemPrompt(character, session, userProfile, recent);
      const turns = messagesToTurns(recent);

      if (isInitiative) {
        turns.push({
          role: "user",
          content: `[${userProfile.name} молчит или выжидает. ${character.name}, прояви собственную инициативу: продолжи мысль, соверши физическое действие, измени положение, начни новую реплику или нарушь паузу. НЕ говори и НЕ действуй за ${userProfile.name}!]`,
        });
      }

      const parsed = await requestRoleplayReply(apiConfig, systemPrompt, turns);

      const oldStats = session.currentStats;
      const newStats = parsed.stats ?? session.currentStats;
      const assistantMsg: Message = {
        id: newId(),
        sessionId: session.id,
        sender: "assistant",
        swipes: [parsed.text || "..."],
        currentSwipeIndex: 0,
        innerThought: parsed.innerThought,
        statsSnapshot: newStats,
        timestamp: Date.now(),
      };

      await db.messages.add(assistantMsg);
      await db.sessions.update(session.id, { currentStats: newStats, updatedAt: Date.now() });

      const total = await db.messages.where("sessionId").equals(session.id).count();
      const toastsEnabled = session.showRelationshipToasts !== false;

      if (toastsEnabled && parsed.feelingHint && parsed.feelingHint.trim()) {
        showToast({ title: parsed.feelingHint.trim(), type: "feeling" });
      } else if (parsed.stats) {
        checkMilestone(oldStats, newStats, total);
      }

      if (total - lastExtractedMsgCountRef.current >= MEMORY_EXTRACT_INTERVAL) {
        lastExtractedMsgCountRef.current = total;
        compressMemory().catch(() => {});
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Ошибка при получении ответа.");
    } finally {
      setSending(false);
    }
  }

  async function handleRetry() {
    if (!session || sending) return;
    const full = await db.messages.where("sessionId").equals(session.id).sortBy("timestamp");
    if (full.length === 0) return;
    const last = full[full.length - 1];
    if (last && last.sender === "user") {
      await callModelAndAppend(full, false);
    }
  }

  async function handleSend(text: string) {
    if (!session) return;
    const userMsg: Message = {
      id: newId(),
      sessionId: session.id,
      sender: "user",
      swipes: [text],
      currentSwipeIndex: 0,
      timestamp: Date.now(),
    };

    await db.messages.add(userMsg);
    await db.sessions.update(session.id, { updatedAt: Date.now() });
    const full = await db.messages.where("sessionId").equals(session.id).sortBy("timestamp");
    await callModelAndAppend(full, false);
  }

  async function handleContinue() {
    if (!session || sending) return;
    const full = await db.messages.where("sessionId").equals(session.id).sortBy("timestamp");
    await callModelAndAppend(full, true);
  }

  async function handleRegenerate(message: Message) {
    if (!messages || !session) return;
    const idx = messages.findIndex((m) => m.id === message.id);
    const context = messages.slice(0, idx);

    setSending(true);
    setErrorMsg(null);

    try {
      const recent = context.slice(-apiConfig!.contextWindow);
      const systemPrompt = buildSystemPrompt(character!, session, userProfile!, recent);
      const turns = messagesToTurns(recent);
      const parsed = await requestRoleplayReply(apiConfig!, systemPrompt, turns);

      const newStats = parsed.stats ?? session.currentStats;
      const newSwipes = [...message.swipes, parsed.text || "..."];

      await db.messages.update(message.id, {
        swipes: newSwipes,
        currentSwipeIndex: newSwipes.length - 1,
        innerThought: parsed.innerThought,
        statsSnapshot: newStats,
        timestamp: Date.now(),
      });
      await db.sessions.update(session.id, { currentStats: newStats, updatedAt: Date.now() });

      const toastsEnabled = session.showRelationshipToasts !== false;
      if (toastsEnabled && parsed.feelingHint && parsed.feelingHint.trim()) {
        showToast({ title: parsed.feelingHint.trim(), type: "feeling" });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Ошибка регенерации.");
    } finally {
      setSending(false);
    }
  }

  async function compressMemory() {
    if (!messages || !session || !apiConfig || !character || !userProfile) return;
    if (messages.length < 3) return;

    const targetMessages = messages.length > 20 ? messages.slice(-20) : messages;

    const transcript = targetMessages
      .map((m) => `${m.sender === "user" ? userProfile.name : character.name}: ${m.swipes[m.currentSwipeIndex]}`)
      .join("\n");

    try {
      const existingFacts = (session.extractedFacts || []).map((f) => ({
        keys: f.keys,
        content: f.content,
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

      const updatedFacts = result.activeFacts.map((f) => ({
        id: newId(),
        keys: f.keys || [],
        content: f.content,
        createdAt: Date.now(),
      }));

      const combinedSummary = session.summary
        ? `${session.summary}\n${result.summary}`
        : result.summary;

      await db.sessions.update(session.id, {
        summary: combinedSummary,
        diary: [...existingDiary, newDiaryEntry],
        extractedFacts: updatedFacts,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error("Memory extract error:", e);
    }
  }

  const stats = session.currentStats;
  const activeWallpaper = session.wallpaperUrl || character.wallpaperUrl;
  const blurVal = session.wallpaperBlur ?? 0;
  const dimVal = session.wallpaperDim ?? 0.55;

  return (
    <div className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-hidden bg-bg">
      {/* Слой фона сцены */}
      {activeWallpaper && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <img
            src={activeWallpaper}
            alt="Фон сцены"
            className="h-full w-full object-cover object-center transition-all duration-300"
            style={{
              filter: blurVal ? `blur(${blurVal}px)` : undefined,
              transform: blurVal ? "scale(1.08)" : undefined,
            }}
          />
          <div
            className="absolute inset-0 bg-bg transition-opacity duration-300"
            style={{ opacity: dimVal }}
          />
        </div>
      )}

      {/* Всплывающий тост отношений */}
      <RelationshipToast toast={toast} />

      {/* Шапка чата */}
      <header className="relative z-10 shrink-0 border-b border-border bg-surface/85 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2.5 pt-safe-top">
          <button onClick={onBack} className="icon-btn h-9 w-9 shrink-0">
            <ArrowLeft size={20} />
          </button>

          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-opacity hover:opacity-85 active:scale-[0.99]"
            title="Открыть профиль и дневник персонажа"
          >
            <Avatar src={character.avatarUrl} name={character.name} size={38} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-50">{character.name}</p>
              <p className="truncate text-[11px] text-zinc-400">
                {character.tagline?.trim() || session.currentStats?.statusTitle || "В сети"}
              </p>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <StatsBadge stats={stats} onClick={() => setStatsOpen(true)} />

            <button
              onClick={async () => {
                const next = !novelMode;
                setNovelMode(next);
                await db.sessions.update(session.id, { novelMode: next });
              }}
              className={`icon-btn h-9 w-9 ${novelMode ? "text-neon-cyan" : ""}`}
              title="Режим книги"
            >
              <BookOpen size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Тело диалога */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {novelMode ? (
          <NovelReader messages={messages} character={character} userProfile={userProfile} />
        ) : (
          <div ref={contentWrapperRef} className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4">
            {messages.map((m, idx) => {
              const prevMsg = messages[idx - 1];
              const isNewDay =
                !prevMsg ||
                new Date(m.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString();

              return (
                <React.Fragment key={m.id}>
                  {isNewDay && (
                    <div className="my-1.5 flex justify-center">
                      <span className="rounded-full border border-border/80 bg-surface-2/85 px-3 py-0.5 text-[10.5px] font-medium text-zinc-400 shadow-xs backdrop-blur-md">
                        {formatDateDivider(m.timestamp)}
                      </span>
                    </div>
                  )}

                  <MessageBubble
                    message={m}
                    character={character}
                    userProfile={userProfile}
                    isLastAssistant={m.id === lastAssistantId}
                    isLastUser={m.id === lastMsg?.id && isLastMsgUser}
                    onRetry={handleRetry}
                    onEdit={async (text) => {
                      const swipes = [...m.swipes];
                      swipes[m.currentSwipeIndex] = text;
                      await db.messages.update(m.id, { swipes });
                    }}
                    onDelete={async () => {
                      if (confirm("Удалить это и все последующие сообщения?")) {
                        await rewindToMessage(session.id, m.id, false);
                        lastExtractedMsgCountRef.current = Math.min(
                          lastExtractedMsgCountRef.current,
                          messages.length - 1
                        );
                      }
                    }}
                    onSwipe={async (dir) => {
                      const next = m.currentSwipeIndex + dir;
                      if (next < 0 || next >= m.swipes.length) return;
                      await db.messages.update(m.id, { currentSwipeIndex: next });
                    }}
                    onRegenerate={() => handleRegenerate(m)}
                    onShowThought={() => setThoughtMessage(m)}
                  />
                </React.Fragment>
              );
            })}

            {sending && (
              <div className="flex items-center gap-2 pl-11 text-zinc-500">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-neon-cyan" style={{ animationDelay: "0s" }} />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-neon-cyan" style={{ animationDelay: "0.15s" }} />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-neon-cyan" style={{ animationDelay: "0.3s" }} />
              </div>
            )}

            {errorMsg && (
              <div className="mx-auto flex max-w-md items-center justify-between gap-2 rounded-xl border border-neon-red/40 bg-neon-red/10 px-3.5 py-2.5 text-xs text-neon-red shadow-lg backdrop-blur-md">
                <div className="flex items-center gap-2 min-w-0">
                  <MessagesSquare size={14} className="shrink-0 text-neon-red" />
                  <span className="leading-snug break-words">{errorMsg}</span>
                </div>
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={sending}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neon-red/50 bg-neon-red/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-all hover:bg-neon-red/35 active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <RotateCcw size={12} /> Повторить
                </button>
              </div>
            )}

            {/* Невидимый якорный элемент */}
            <div ref={bottomAnchorRef} className="h-px w-full shrink-0" />
          </div>
        )}
      </div>

      {/* Кнопка скролла вниз */}
      {showScrollBottom && (
        <div className="pointer-events-none absolute bottom-24 left-0 right-0 z-30 mx-auto max-w-3xl px-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2/90 text-zinc-300 shadow-xl backdrop-blur-md transition-all hover:border-neon-cyan/50 hover:text-neon-cyan active:scale-90"
              title="Перейти в самый низ"
            >
              <ChevronDown size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Поле ввода */}
      <div className="relative z-10 shrink-0 border-t border-border bg-surface/95 backdrop-blur-lg">
        <div className="mx-auto max-w-3xl">
          <InputBar
            onSend={handleSend}
            onOpenDirector={() => setDirectorOpen(true)}
            onRequestSuggestions={handleGetSuggestions}
            onContinue={handleContinue}
            sending={sending}
          />
        </div>
      </div>

      {/* Модальные окна */}
      <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} stats={stats} />
      <DirectorPanel
        open={directorOpen}
        onClose={() => setDirectorOpen(false)}
        session={session}
        messageCount={messages.length}
        onUpdateNotes={(notes) => db.sessions.update(session.id, { directorNotes: notes })}
        onUpdateDim={(dim) => db.sessions.update(session.id, { wallpaperDim: dim })}
        onUpdateBlur={(blur) => db.sessions.update(session.id, { wallpaperBlur: blur })}
        onUpdateWallpaper={(url) => db.sessions.update(session.id, { wallpaperUrl: url })}
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
        onToggleToasts={(enabled) => db.sessions.update(session.id, { showRelationshipToasts: enabled })}
        onTogglePacing={(enabled) => db.sessions.update(session.id, { realisticPacing: enabled })}
        onCompressMemory={compressMemory}
      />
      <ThoughtModal
        open={!!thoughtMessage}
        onClose={() => setThoughtMessage(null)}
        thought={thoughtMessage?.innerThought ?? ""}
        characterName={character.name}
      />
      <CharacterProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        character={character}
        session={session}
        messageCount={messages.length}
        onManualExtractMemory={compressMemory}
        onDeleteFact={async (factId) => {
          const updated = (session.extractedFacts || []).filter((f) => f.id !== factId);
          await db.sessions.update(session.id, { extractedFacts: updated });
        }}
      />
    </div>
  );
}