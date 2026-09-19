import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  BrainCircuit,
  Check,
  X,
  Copy,
  Dices,
  Sparkles,
  AlertCircle,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { Avatar } from "../common/Avatar";
import { renderRoleplayText } from "../../utils/textRenderer";
import { parseFateTag, type FateOutcome } from "../../services/dice";
import { formatMessageTime } from "../../utils/date";
import type { Character, Message, UserProfile } from "../../types";
import { cn } from "../../utils/cn";
import { copyTextToClipboard } from "../../utils/clipboard";

interface Props {
  message: Message;
  character: Character;
  userProfile: UserProfile;
  isLastAssistant: boolean;
  isLastUser?: boolean;
  disableTypewriter?: boolean;
  onRetry?: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  onSwipe: (direction: -1 | 1) => void;
  onRegenerate: () => void;
  onShowThought: () => void;
}

export function MessageBubble({
  message,
  character,
  userProfile,
  isLastAssistant,
  isLastUser,
  disableTypewriter = false,
  onRetry,
  onEdit,
  onDelete,
  onSwipe,
  onRegenerate,
  onShowThought,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const reducedMotion = useReducedMotion();

  const isUser = message.sender === "user";
  const fullText = message.swipes[message.currentSwipeIndex] ?? "";
  const fateInfo = parseFateTag(fullText);
  const cleanDisplayContent = fateInfo ? fateInfo.cleanText : fullText;

  const isOOC =
    cleanDisplayContent.startsWith("[OOC:") ||
    cleanDisplayContent.startsWith("[Вне роли:");

  const timeString = formatMessageTime(message.timestamp);
  const senderName = isUser ? userProfile.name : character.name;

  const isBrandNew =
    !isUser &&
    isLastAssistant &&
    !disableTypewriter &&
    Date.now() - message.timestamp < 4000;

  const shouldReveal = isBrandNew && !reducedMotion;

  const [isTyping, setIsTyping] = useState(shouldReveal);
  const [displayedLength, setDisplayedLength] = useState(
    shouldReveal ? 0 : cleanDisplayContent.length
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!shouldReveal) {
      setDisplayedLength(cleanDisplayContent.length);
      setIsTyping(false);
      return;
    }

    setDisplayedLength(0);
    setIsTyping(true);

    let current = 0;
    const step = Math.max(1, Math.floor(cleanDisplayContent.length / 50));

    const interval = setInterval(() => {
      current += step;
      if (current >= cleanDisplayContent.length) {
        setDisplayedLength(cleanDisplayContent.length);
        setIsTyping(false);
        clearInterval(interval);
      } else {
        setDisplayedLength(current);
      }
    }, 16);

    return () => clearInterval(interval);
  }, [cleanDisplayContent, shouldReveal]);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(cleanDisplayContent);
      if (!mountedRef.current) return;
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopied(false);
      }, 2000);
    } catch {}
  };

  const handleSaveEdit = () => {
    const tagMatch = fullText.match(/\[🎲 Проверка судьбы:[\s\S]*?\]/i);
    const newFullText = tagMatch
      ? `${draft.trim()} ${tagMatch[0]}`
      : draft.trim();

    onEdit(newFullText);
    setEditing(false);
  };

  const visibleText = isTyping
    ? cleanDisplayContent.slice(0, displayedLength)
    : cleanDisplayContent;

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "flex w-full min-w-0 gap-3 scroll-mt-24",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <Avatar
        src={isUser ? userProfile.avatarUrl : character.avatarUrl}
        name={senderName}
        size={36}
        className="mt-0.5 ring-1 ring-white/10"
      />

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5",
          "max-w-[92%] sm:max-w-[85%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "flex max-w-full items-baseline gap-2 px-1 text-xs",
            isUser && "justify-end"
          )}
        >
          <span className="font-semibold text-zinc-200">{senderName}</span>
          <span className="tabular-nums text-content-muted text-[11px]">{timeString}</span>
        </div>

        <div
          className={cn(
            "relative min-w-0 max-w-full rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-md backdrop-blur-xl transition-all sm:px-4.5 sm:py-3 sm:text-[15px]",
            editing && "w-full",
            isOOC
              ? "border border-dashed border-warning/40 bg-surface-2/90 text-zinc-200"
              : isUser
                ? "rounded-tr-xs border border-accent/25 bg-[#221b33]/90 text-zinc-100 shadow-[0_2px_16px_rgba(139,92,246,0.1)]"
                : "rounded-tl-xs border border-white/[0.07] bg-[#121622]/90 text-zinc-100"
          )}
        >
          {isOOC && !editing && (
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
              Вне роли · OOC
            </p>
          )}

          {fateInfo && !editing && (
            <div className="mb-2">
              <FateBadge outcome={fateInfo.outcome} label={fateInfo.label} />
            </div>
          )}

          {editing ? (
            <div className="space-y-3">
              <textarea
                autoFocus
                rows={4}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="input-field text-sm leading-relaxed"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex items-center gap-1 rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs text-content-secondary hover:bg-surface-3"
                >
                  <X size={14} />
                  <span>Отмена</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="flex items-center gap-1 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                >
                  <Check size={14} />
                  <span>Сохранить</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="rp-text leading-relaxed">
              {renderRoleplayText(visibleText)}
              {isTyping && (
                <span className="ml-1 inline-block h-3.5 w-1 translate-y-0.5 rounded-full bg-accent animate-pulse" />
              )}
            </div>
          )}
        </div>

        {!editing && !isTyping && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-1 pt-1",
              isUser ? "justify-end" : "justify-start"
            )}
          >
            {!isUser && message.innerThought && (
              <button
                type="button"
                onClick={onShowThought}
                className="flex items-center gap-1.5 rounded-xl border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-all hover:bg-accent/20 active:scale-95"
              >
                <BrainCircuit size={15} />
                <span>Мысль</span>
              </button>
            )}

            {isUser && isLastUser && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning transition-all hover:bg-warning/20 active:scale-95"
              >
                <RotateCcw size={14} />
                <span>Повторить</span>
              </button>
            )}

            {message.swipes.length > 1 && !isUser && (
              <div className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-[#121622]/80 px-1.5 py-1 text-content-muted">
                <button
                  type="button"
                  onClick={() => onSwipe(-1)}
                  disabled={message.currentSwipeIndex <= 0}
                  className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-white/[0.08] hover:text-content disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-1 text-xs font-semibold tabular-nums text-zinc-300">
                  {message.currentSwipeIndex + 1}/{message.swipes.length}
                </span>
                <button
                  type="button"
                  onClick={() => onSwipe(1)}
                  disabled={message.currentSwipeIndex >= message.swipes.length - 1}
                  className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-white/[0.08] hover:text-content disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {!isUser && isLastAssistant && (
              <button
                type="button"
                onClick={onRegenerate}
                title="Перегенерировать ответ"
                className="flex h-8.5 w-8.5 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-white/[0.08] hover:text-accent active:scale-95"
              >
                <RefreshCw size={16} />
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleCopy()}
              title="Скопировать текст"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content active:scale-95"
            >
              {copied ? (
                <Check size={16} className="text-success" />
              ) : (
                <Copy size={16} />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setDraft(cleanDisplayContent);
                setEditing(true);
              }}
              title="Редактировать реплику"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content active:scale-95"
            >
              <Pencil size={16} />
            </button>

            <button
              type="button"
              onClick={onDelete}
              title="Удалить реплику"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-danger/10 hover:text-danger active:scale-95"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FateBadge({
  outcome,
  label,
}: {
  outcome: FateOutcome;
  label: string;
}) {
  const configs = {
    triumph: {
      className: "border-success/30 bg-success/10 text-success",
      icon: Sparkles,
    },
    success: {
      className: "border-info/30 bg-info/10 text-info",
      icon: CheckCircle2,
    },
    twist: {
      className: "border-warning/30 bg-warning/10 text-warning",
      icon: AlertCircle,
    },
    fail: {
      className: "border-danger/30 bg-danger/10 text-danger",
      icon: XCircle,
    },
  };

  const config = configs[outcome] || configs.success;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold backdrop-blur-md",
        config.className
      )}
    >
      <Dices size={13} className="shrink-0" />
      <span>{label}</span>
      <Icon size={13} className="shrink-0" />
    </div>
  );
}