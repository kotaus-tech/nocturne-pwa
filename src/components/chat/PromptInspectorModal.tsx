import { useState, useMemo } from "react";
import {
  Copy,
  Check,
  MessagesSquare,
  Cpu,
  Terminal,
  Activity,
  Info,
} from "lucide-react";
import { Modal } from "../common/Modal";
import type { Character, ChatSession, Message, UserProfile, ApiConfig } from "../../types";
import { buildSystemPrompt } from "../../services/promptBuilder";
import { isLocalEndpoint, messagesToTurns } from "../../services/apiClient";
import {
  buildCharacterIndex,
  statsForCharacter,
} from "../../services/groupScene";
import { copyTextToClipboard } from "../../utils/clipboard";
import { cn } from "../../utils/cn";

interface PromptInspectorModalProps {
  open: boolean;
  onClose: () => void;
  character: Character;
  session: ChatSession;
  userProfile: UserProfile;
  apiConfig: ApiConfig;
  contextMessages: Message[];
  lastAssistantMessage?: Message;
  /** Групповая сцена: все участники (первый — основной персонаж ветки). */
  participants?: Character[];
  /** Групповая сцена: кто сейчас за кадром — блок присутствия в промпте. */
  absent?: { character: Character; reason?: string }[];
  /** Кто отвечал в последнем запросе — для него и показывается промпт. */
  speakerId?: string;
}

type TabKey = "overview" | "system" | "turns" | "raw";

function estimateTokens(text: string): number {
  if (!text) return 0;
  // Калибровка токенизатора: в среднем 3.2 символа на токен для русского и 4.0 для латиницы
  const cyrillicCount = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const ratio = cyrillicCount > text.length * 0.4 ? 3.1 : 3.8;
  return Math.ceil(text.length / ratio);
}

export function PromptInspectorModal({
  open,
  onClose,
  character,
  session,
  userProfile,
  apiConfig,
  contextMessages,
  lastAssistantMessage,
  participants,
  absent,
  speakerId,
}: PromptInspectorModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isLocal = isLocalEndpoint(apiConfig.baseUrl);

  const roster = participants && participants.length > 1 ? participants : null;
  const activeSpeaker =
    (roster && speakerId && roster.find((item) => item.id === speakerId)) ||
    (roster && roster.find((item) => item.id === character.id)) ||
    character;
  const othersKey = roster
    ? roster
        .filter((item) => item.id !== activeSpeaker.id)
        .map((item) => item.id)
        .join(",")
    : "";

  const others = useMemo(
    () => roster?.filter((item) => item.id !== activeSpeaker.id) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [othersKey, roster]
  );

  const speakerStats = useMemo(() => {
    if (!roster) return undefined;

    return statsForCharacter(
      session,
      activeSpeaker.id,
      buildCharacterIndex(roster)
    );
  }, [roster, session, activeSpeaker.id]);

  // Сборка полного системного промпта, идентичного запросу к API
  const systemPrompt = useMemo(() => {
    return buildSystemPrompt(
      activeSpeaker,
      session,
      userProfile,
      contextMessages,
      isLocal,
      others.length > 0
        ? {
            others,
            currentStats: speakerStats,
            absent,
            relations: session.relations,
          }
        : undefined
    );
  }, [
    activeSpeaker,
    session,
    userProfile,
    contextMessages,
    isLocal,
    others,
    absent,
    speakerStats,
  ]);

  // Сборка массива реплик turns
  const turns = useMemo(() => {
    if (!roster) return messagesToTurns(contextMessages);

    const namesById = new Map(roster.map((item) => [item.id, item.name]));

    return messagesToTurns(contextMessages, (message) => {
      const authorId = message.characterId ?? character.id;
      if (authorId === activeSpeaker.id) return undefined;
      return namesById.get(authorId) || message.characterName;
    });
  }, [contextMessages, roster, activeSpeaker.id, character.id]);

  // Расчёт метрик токенов
  const systemTokens = useMemo(() => estimateTokens(systemPrompt), [systemPrompt]);

  const turnsText = useMemo(() => {
    return turns.map((t) => `${t.role}: ${t.content}`).join("\n\n");
  }, [turns]);

  const turnsTokens = useMemo(() => estimateTokens(turnsText), [turnsText]);

  const inputTokensTotal = systemTokens + turnsTokens;

  const outputText = lastAssistantMessage
    ? lastAssistantMessage.swipes[lastAssistantMessage.currentSwipeIndex] || ""
    : "";

  const outputTokens = useMemo(() => estimateTokens(outputText), [outputText]);

  const handleCopy = async (text: string, key: string) => {
    await copyTextToClipboard(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Инспектор контекста и токенов"
      size="lg"
      variant="sheet"
    >
      <div className="space-y-5">
        {/* Верхняя плашка метрик расхода токенов */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-3 shadow-inner">
            <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">
              Input (Контекст)
            </span>
            <p className="mt-1 text-lg font-bold tabular-nums text-zinc-100">
              ~{inputTokensTotal.toLocaleString()} <span className="text-xs font-normal text-content-muted">ток.</span>
            </p>
            <p className="text-[10px] text-content-secondary">
              {(systemPrompt.length + turnsText.length).toLocaleString()} симв.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-3 shadow-inner">
            <span className="text-[10px] font-bold uppercase tracking-wider text-accent">
              Системный промпт
            </span>
            <p className="mt-1 text-lg font-bold tabular-nums text-accent">
              ~{systemTokens.toLocaleString()} <span className="text-xs font-normal text-content-muted">ток.</span>
            </p>
            <p className="text-[10px] text-content-secondary">
              {systemPrompt.length.toLocaleString()} симв.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-3 shadow-inner">
            <span className="text-[10px] font-bold uppercase tracking-wider text-info">
              История сообщений
            </span>
            <p className="mt-1 text-lg font-bold tabular-nums text-info">
              ~{turnsTokens.toLocaleString()} <span className="text-xs font-normal text-content-muted">ток.</span>
            </p>
            <p className="text-[10px] text-content-secondary">
              {contextMessages.length} реплик в окне
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-3 shadow-inner">
            <span className="text-[10px] font-bold uppercase tracking-wider text-success">
              Output (Ответ)
            </span>
            <p className="mt-1 text-lg font-bold tabular-nums text-success">
              ~{outputTokens.toLocaleString()} <span className="text-xs font-normal text-content-muted">ток.</span>
            </p>
            <p className="text-[10px] text-content-secondary">
              {outputText.length.toLocaleString()} симв.
            </p>
          </div>
        </div>

        {/* Навигационные табы инспектора */}
        <div className="flex gap-1.5 rounded-2xl border border-white/[0.07] bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all",
              activeTab === "overview"
                ? "bg-accent/20 text-accent shadow-sm"
                : "text-content-muted hover:text-content"
            )}
          >
            <Activity size={14} />
            <span>Параметры</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("system")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all",
              activeTab === "system"
                ? "bg-accent/20 text-accent shadow-sm"
                : "text-content-muted hover:text-content"
            )}
          >
            <Cpu size={14} />
            <span>Системный промпт</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("turns")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all",
              activeTab === "turns"
                ? "bg-accent/20 text-accent shadow-sm"
                : "text-content-muted hover:text-content"
            )}
          >
            <MessagesSquare size={14} />
            <span>История ({turns.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("raw")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all",
              activeTab === "raw"
                ? "bg-accent/20 text-accent shadow-sm"
                : "text-content-muted hover:text-content"
            )}
          >
            <Terminal size={14} />
            <span>Ответ модели</span>
          </button>
        </div>

        {/* Таб 1: Параметры инференса и статус окна */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-accent">
                Конфигурация текущего запроса
              </h4>
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-xl bg-surface-2 p-2.5">
                  <span className="text-content-muted block text-[10px]">Модель:</span>
                  <span className="font-mono font-bold text-zinc-100 truncate block">
                    {apiConfig.model || "openai/gpt-4o-mini"}
                  </span>
                </div>

                <div className="rounded-xl bg-surface-2 p-2.5">
                  <span className="text-content-muted block text-[10px]">Провайдер / Режим:</span>
                  <span className="font-bold text-zinc-100 uppercase">
                    {apiConfig.mode} {isLocal ? "(Local)" : ""}
                  </span>
                </div>

                <div className="rounded-xl bg-surface-2 p-2.5">
                  <span className="text-content-muted block text-[10px]">Режим окна:</span>
                  <span className="font-bold text-success">
                    {apiConfig.steppedContextEnabled !== false ? "Ступенчатый (KV-кэш)" : "Скользящий"}
                  </span>
                </div>

                <div className="rounded-xl bg-surface-2 p-2.5">
                  <span className="text-content-muted block text-[10px]">Температура:</span>
                  <span className="font-mono font-bold text-zinc-100">{apiConfig.temperature}</span>
                </div>

                <div className="rounded-xl bg-surface-2 p-2.5">
                  <span className="text-content-muted block text-[10px]">Top-P / Top-K:</span>
                  <span className="font-mono font-bold text-zinc-100">
                    {apiConfig.topP ?? 0.9} / {apiConfig.topK ?? 40}
                  </span>
                </div>

                <div className="rounded-xl bg-surface-2 p-2.5">
                  <span className="text-content-muted block text-[10px]">Штрафы (Pres / Freq):</span>
                  <span className="font-mono font-bold text-zinc-100">
                    {apiConfig.presencePenalty ?? 0} / {apiConfig.frequencyPenalty ?? 0}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-4 space-y-2 text-xs leading-relaxed text-content-secondary">
              <div className="flex items-center gap-2 font-bold text-zinc-100">
                <Info size={15} className="text-accent" />
                <span>Как расходуются токены в этой ветке</span>
              </div>
              <p>
                • При включённом <strong>ступенчатом окне</strong> системный промпт и первые сообщения диалога сохраняют фиксированное положение в KV-памяти сервера. Ru-OpenRouter и DeepSeek считывают до 90% этого текста из кэша по тарифу со скидкой.
              </p>
              <p>
                • Каждые 8 сообщений автоматически запускается фоновый экстрактор памяти, сохраняя важные события в синопсис и дневник персонажа.
              </p>
            </div>
          </div>
        )}

        {/* Таб 2: Полный системный промпт */}
        {activeTab === "system" && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-content-muted">
                Длина: {systemPrompt.length.toLocaleString()} симв. (~{systemTokens} токенов)
              </span>

              <button
                type="button"
                onClick={() => handleCopy(systemPrompt, "system")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-xs font-semibold text-content-secondary hover:bg-surface-3 hover:text-content"
              >
                {copiedKey === "system" ? (
                  <Check size={14} className="text-success" />
                ) : (
                  <Copy size={14} />
                )}
                <span>{copiedKey === "system" ? "Скопировано" : "Скопировать промпт"}</span>
              </button>
            </div>

            <pre className="max-h-[50vh] overflow-y-auto rounded-2xl border border-white/[0.08] bg-black/60 p-4 font-mono text-xs leading-relaxed text-zinc-200 whitespace-pre-wrap select-text overscroll-contain">
              {systemPrompt}
            </pre>
          </div>
        )}

        {/* Таб 3: История реплик (Turns) */}
        {activeTab === "turns" && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-content-muted">
                Сообщений в окне: {turns.length} (~{turnsTokens} токенов)
              </span>

              <button
                type="button"
                onClick={() => handleCopy(turnsText, "turns")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-xs font-semibold text-content-secondary hover:bg-surface-3 hover:text-content"
              >
                {copiedKey === "turns" ? (
                  <Check size={14} className="text-success" />
                ) : (
                  <Copy size={14} />
                )}
                <span>{copiedKey === "turns" ? "Скопировано" : "Скопировать историю"}</span>
              </button>
            </div>

            <div className="max-h-[50vh] space-y-3 overflow-y-auto overscroll-contain pr-1">
              {turns.map((turn, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "rounded-2xl border p-3 text-xs leading-relaxed",
                    turn.role === "user"
                      ? "border-accent/30 bg-[#221b33]/80 text-zinc-100"
                      : "border-white/[0.07] bg-[#121622]/80 text-zinc-200"
                  )}
                >
                  <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-content-muted">
                    <span>
                      #{idx + 1} · {turn.role === "user" ? userProfile.name : character.name}
                    </span>
                    <span>~{estimateTokens(turn.content)} ток.</span>
                  </div>
                  <p className="whitespace-pre-wrap select-text">{turn.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Таб 4: Последний ответ модели и метаданные */}
        {activeTab === "raw" && (
          <div className="space-y-3">
            {lastAssistantMessage ? (
              <>
                {lastAssistantMessage.innerThought && (
                  <div className="rounded-2xl border border-accent/30 bg-accent/10 p-3.5 space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-accent">
                      Скрытые мысли персонажа (innerThought)
                    </span>
                    <p className="novel-font text-xs italic text-zinc-200 leading-relaxed">
                      «{lastAssistantMessage.innerThought}»
                    </p>
                  </div>
                )}

                <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-100">
                      Сгенерированная реплика
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(outputText, "output")}
                      className="inline-flex items-center gap-1 text-xs text-content-muted hover:text-content"
                    >
                      {copiedKey === "output" ? (
                        <Check size={13} className="text-success" />
                      ) : (
                        <Copy size={13} />
                      )}
                      <span>Копировать</span>
                    </button>
                  </div>
                  <pre className="max-h-48 overflow-y-auto rounded-xl bg-black/50 p-3 font-mono text-xs leading-relaxed text-zinc-200 whitespace-pre-wrap select-text">
                    {outputText}
                  </pre>
                </div>

                {lastAssistantMessage.statsSnapshot && (
                  <div className="rounded-2xl border border-white/[0.07] bg-surface-2/60 p-3 text-xs text-content-muted flex flex-wrap gap-4">
                    <span>Доверие: <strong className="text-zinc-100">{lastAssistantMessage.statsSnapshot.trust}%</strong></span>
                    <span>Симпатия: <strong className="text-zinc-100">{lastAssistantMessage.statsSnapshot.affection}%</strong></span>
                    <span>Напряжение: <strong className="text-zinc-100">{lastAssistantMessage.statsSnapshot.tension}%</strong></span>
                    <span>Статус: <strong className="text-accent">{lastAssistantMessage.statsSnapshot.statusTitle}</strong></span>
                  </div>
                )}
              </>
            ) : (
              <div className="py-8 text-center text-xs text-content-muted">
                В этой ветке пока нет ответов от персонажа.
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-white/[0.08] pt-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] bg-surface-2 px-4 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-3 hover:text-content"
          >
            Закрыть инспектор
          </button>
        </div>
      </div>
    </Modal>
  );
}