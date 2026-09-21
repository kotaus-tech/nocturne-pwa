import {
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Send,
  Dices,
  Clapperboard,
  Drama,
  Loader2,
  Lightbulb,
  X,
  Sparkles,
  Play,
  Square,
} from "lucide-react";
import { rollFate } from "../../services/dice";
import { Avatar } from "../common/Avatar";
import { cn } from "../../utils/cn";

interface Props {
  onSend: (text: string) => void;
  onOpenDirector: () => void;
  onRequestSuggestions: () => Promise<string[]>;
  onContinue: () => void;
  /** Прерывает текущую генерацию, если она идёт. */
  onStop?: () => void;
  sending: boolean;
  characterName?: string;
  modelName?: string;
  /** В ветке несколько персонажей — «Продолжить» передаёт ход следующему. */
  groupScene?: boolean;
  /** Групповая сцена: присутствующие и ожидающие дистанционные контакты. */
  participants?: {
    id: string;
    name: string;
    avatarUrl?: string;
    remote?: boolean;
  }[];
  /** Выбранный адресат: его ответ ждём следующим. */
  targetId?: string | null;
  onSelectTarget?: (characterId: string) => void;
}

export function InputBar({
  onSend,
  onOpenDirector,
  onRequestSuggestions,
  onContinue,
  onStop,
  sending,
  characterName = "персонажу",
  modelName = "AI Model",
  groupScene = false,
  participants,
  targetId,
  onSelectTarget,
}: Props) {
  const [text, setText] = useState("");
  const [ooc, setOoc] = useState(false);
  const [fateRoll, setFateRoll] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);

  const autoGrow = () => {
    const element = taRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(180, Math.max(52, element.scrollHeight))}px`;
  };

  const send = () => {
    if (!text.trim() || sending) return;

    let finalText = text.trim();
    if (ooc) {
      finalText = `[OOC: ${finalText}]`;
    }
    if (fateRoll) {
      const fate = rollFate();
      finalText = `${finalText} ${fate.tag}`;
    }

    onSend(finalText);

    setText("");
    setOoc(false);
    setFateRoll(false);
    setSuggestions([]);

    if (taRef.current) {
      taRef.current.style.height = "auto";
    }
  };

  const handleFetchSuggestions = async () => {
    if (loadingSuggestions || sending) return;
    setLoadingSuggestions(true);

    try {
      const results = await onRequestSuggestions();
      setSuggestions(results);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleSelectSuggestion = (suggestion: string) => {
    setText(suggestion);
    setSuggestions([]);
    taRef.current?.focus();
    requestAnimationFrame(autoGrow);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    const isTouchDevice =
      typeof window !== "undefined" &&
      ("ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia("(pointer: coarse)").matches);

    if (event.key === "Enter" && !event.shiftKey) {
      if (isTouchDevice) return;
      event.preventDefault();
      send();
    }
  };

  const toolButtonClass = cn(
    "flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.07] bg-[#121622]/80",
    "py-2 sm:px-3 sm:py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-md transition-all",
    "hover:border-white/[0.15] hover:bg-[#161b28] hover:text-content active:scale-95 disabled:opacity-40"
  );

  return (
    <div className="px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 sm:px-6">
      {suggestions.length > 0 && (
        <section
          aria-label="Предложенные варианты ответа"
          className="mb-3 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#121622]/95 p-3.5 shadow-2xl backdrop-blur-2xl"
        >
          <div className="flex items-center justify-between pb-2.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <Sparkles size={14} className="text-accent" />
              <span>Варианты реплик</span>
            </h3>
            <button
              type="button"
              onClick={() => setSuggestions([])}
              className="rounded-lg p-1 text-content-muted hover:bg-white/[0.05] hover:text-content"
            >
              <X size={15} />
            </button>
          </div>

          <div className="max-h-[30vh] space-y-2 overflow-y-auto overscroll-contain">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSelectSuggestion(suggestion)}
                className="block w-full rounded-2xl border border-white/[0.06] bg-surface-2/70 p-3 text-left text-xs leading-relaxed text-content-secondary transition-all hover:border-accent/40 hover:bg-surface-3 hover:text-content"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </section>
      )}

      {participants && participants.length > 1 && onSelectTarget && (
        <div
          role="group"
          aria-label="Кому адресована реплика"
          className="mb-2 flex items-center gap-1.5 overflow-x-auto overscroll-contain pb-1"
        >
          <span className="shrink-0 pr-0.5 text-[10px] font-bold uppercase tracking-wider text-content-muted">
            Ответит
          </span>

          {participants.map((participant) => {
            const isTarget = targetId === participant.id;

            return (
              <button
                key={participant.id}
                type="button"
                onClick={() => onSelectTarget(participant.id)}
                disabled={sending}
                aria-pressed={isTarget}
                title={
                  isTarget
                    ? `Снять выбор: отвечает любой`
                    : participant.remote
                      ? `Ответить на дистанционное сообщение от ${participant.name}`
                      : `Адресовать реплику: ${participant.name}`
                }
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5",
                  "text-[11px] font-medium transition-all active:scale-95 disabled:opacity-40",
                  participant.remote && "border-sky-400/30 bg-sky-400/[0.08]",
                  isTarget
                    ? "border-accent/60 bg-accent/20 text-accent shadow-[0_0_16px_rgba(139,92,246,0.25)]"
                    : "border-white/[0.08] bg-[#121622]/80 text-content-secondary hover:border-accent/40 hover:bg-[#161b28] hover:text-accent"
                )}
              >
                <span className="relative shrink-0">
                  <Avatar src={participant.avatarUrl} name={participant.name} size={20} />
                  {participant.remote && (
                    <span
                      aria-label="Новое дистанционное сообщение"
                      className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-sky-300 ring-2 ring-[#121622]"
                    />
                  )}
                </span>
                <span className="max-w-[7rem] truncate">
                  {participant.name}
                  {participant.remote ? " · вне сцены" : ""}
                </span>
              </button>
            );
          })}

          {targetId && (
            <button
              type="button"
              onClick={() => onSelectTarget(targetId)}
              className="shrink-0 rounded-full px-2 py-1 text-[10px] font-medium text-content-muted hover:text-content"
            >
              любой
            </button>
          )}
        </div>
      )}

      {/* На мобильных: сетка из 5 колонок без скролла. На ПК: flex с текстом */}
      <div className="mb-2.5 grid grid-cols-5 gap-1.5 sm:flex sm:items-center sm:gap-1.5 sm:overflow-x-auto pb-1">
        <button
          type="button"
          onClick={onContinue}
          disabled={sending}
          title={
            groupScene
              ? "Продолжить — передать ход следующему персонажу"
              : "Продолжить — инициатива персонажа"
          }
          className={toolButtonClass}
        >
          <Play size={14} fill="currentColor" className="text-accent shrink-0" />
          <span className="hidden sm:inline">Продолжить</span>
        </button>

        <button
          type="button"
          onClick={() => void handleFetchSuggestions()}
          disabled={loadingSuggestions || sending}
          title="Подсказки"
          className={cn(
            toolButtonClass,
            loadingSuggestions && "border-accent/50 bg-accent/15 text-accent"
          )}
        >
          {loadingSuggestions ? (
            <Loader2 size={14} className="animate-spin text-accent shrink-0" />
          ) : (
            <Lightbulb size={14} className="text-accent shrink-0" />
          )}
          <span className="hidden sm:inline">Подсказки</span>
        </button>

        <button
          type="button"
          onClick={() => setFateRoll((prev) => !prev)}
          aria-pressed={fateRoll}
          title="Проверка судьбы"
          className={cn(
            toolButtonClass,
            fateRoll && "border-warning/50 bg-warning/15 text-warning shadow-sm"
          )}
        >
          <Dices size={14} className="shrink-0" />
          <span className="hidden sm:inline">Судьба</span>
        </button>

        <button
          type="button"
          onClick={() => setOoc((prev) => !prev)}
          aria-pressed={ooc}
          title="Вне роли (OOC)"
          className={cn(
            toolButtonClass,
            ooc && "border-warning/50 bg-warning/15 text-warning shadow-sm"
          )}
        >
          <Drama size={14} className="shrink-0" />
          <span className="hidden sm:inline">Вне роли</span>
        </button>

        <button
          type="button"
          onClick={onOpenDirector}
          title="Режиссер"
          className={toolButtonClass}
        >
          <Clapperboard size={14} className="text-accent shrink-0" />
          <span className="hidden sm:inline">Режиссер</span>
        </button>
      </div>

      <div className="relative flex items-end gap-3 rounded-3xl border border-white/[0.09] bg-[#121622]/90 p-3 shadow-2xl backdrop-blur-2xl transition-all focus-within:border-accent/50 focus-within:shadow-[0_0_24px_rgba(139,92,246,0.18)]">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            fateRoll
              ? "Опишите рискованное действие…"
              : ooc
                ? "Сообщение от автора вне роли…"
                : `Что вы скажете ${characterName}?`
          }
          className="block max-h-44 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-content-muted focus:outline-none sm:text-base"
        />

        {sending && onStop ? (
          <button
            type="button"
            onClick={onStop}
            title="Прервать генерацию"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-danger/40 bg-danger/15 text-danger transition-all hover:bg-danger/25 active:scale-95"
          >
            <Square size={16} fill="currentColor" />
            <span className="sr-only">Остановить генерацию</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-[0_0_18px_rgba(139,92,246,0.35)] transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-25 disabled:shadow-none"
          >
            {sending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-content-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span>Готов к диалогу</span>
        </span>
        <span className="hidden sm:inline-block">
          {modelName} · Shift + Enter — перенос строки
        </span>
      </div>
    </div>
  );
}