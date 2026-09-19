import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  Download,
  AlertCircle,
  Loader2,
  Pin,
  GripVertical,
} from "lucide-react";
import { db, toggleSessionPin } from "../../db";
import { Avatar } from "../common/Avatar";
import type { Character, ChatSession } from "../../types";
import {
  cloneSession,
  deleteSessionCascade,
  renameSession,
} from "../../utils/sessionActions";
import { exportChatSession } from "../../utils/chatExport";
import { cn } from "../../utils/cn";

interface Props {
  session: ChatSession;
  character?: Character;
  onOpen: () => void;
  isDraggable?: boolean;
  onDragStartHandle?: (event: React.PointerEvent) => void;
}

export function SessionRow({
  session,
  character,
  onOpen,
  isDraggable = false,
  onDragStartHandle,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const menuId = useId();
  const menuAreaRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const lastMessage = useLiveQuery(async () => {
    const all = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");

    return all[all.length - 1];
  }, [session.id]);

  const preview = lastMessage
    ? stripMeta(lastMessage.swipes[lastMessage.currentSwipeIndex] ?? "")
    : "";

  const characterName = character?.name ?? "Персонаж удалён";
  const isPinned = !!session.isPinned;

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    if (!menuOpen) return;

    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });

    const handleOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuAreaRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMenuOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };

    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [menuOpen]);

  const toggleMenu = () => {
    if (menuOpen) {
      closeMenu();
      return;
    }

    const trigger = triggerRef.current;
    if (trigger) {
      const triggerRect = trigger.getBoundingClientRect();
      const scrollContainer = trigger.closest<HTMLElement>("[role='dialog'], main");
      const containerRect = scrollContainer?.getBoundingClientRect();

      const topBoundary = Math.max(0, containerRect?.top ?? 0);
      const bottomBoundary = Math.min(
        window.innerHeight,
        containerRect?.bottom ?? window.innerHeight
      );

      const below = bottomBoundary - triggerRect.bottom;
      const above = triggerRect.top - topBoundary;

      setOpenUpward(below < 260 && above > below);
    }

    setMenuOpen(true);
  };

  const runAction = async (action: () => Promise<unknown>) => {
    closeMenu(true);
    setActionError(null);
    setBusy(true);

    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Не удалось выполнить действие."
      );
    } finally {
      setBusy(false);
    }
  };

  const actionClass =
    "flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-content-secondary transition-colors hover:bg-surface-3 hover:text-content active:bg-surface-3";

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-surface transition-all",
        isPinned
          ? "border-accent/40 bg-[#121622]/95 shadow-sm"
          : "border-border hover:border-border-strong hover:bg-surface-2",
        menuOpen && "z-20 border-accent/50"
      )}
    >
      <div className="flex items-center gap-1.5 p-3 sm:gap-3 sm:p-4">
        {/* Ручка захвата для Drag-and-Drop закрепленных веток */}
        {isDraggable && (
          <div
            onPointerDown={onDragStartHandle}
            className="touch-none flex h-10 w-6 shrink-0 cursor-grab items-center justify-center rounded-lg text-content-muted transition-colors hover:text-accent active:cursor-grabbing"
            title="Зажмите и перетащите для изменения порядка"
          >
            <GripVertical size={16} />
          </div>
        )}

        {/* Основная кликабельная область строки чата */}
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl text-left sm:gap-4"
        >
          <Avatar
            src={character?.avatarUrl}
            name={characterName}
            size={48}
            className="shrink-0"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                {isPinned && (
                  <Pin size={12} className="rotate-45 fill-accent text-accent shrink-0" />
                )}
                <span className="truncate text-sm sm:text-base font-bold text-zinc-100">
                  {characterName}
                </span>
              </div>

              <time
                dateTime={
                  Number.isFinite(session.updatedAt)
                    ? new Date(session.updatedAt).toISOString()
                    : undefined
                }
                className="shrink-0 text-[11px] tabular-nums text-content-muted"
              >
                {new Date(session.updatedAt).toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </time>
            </div>

            <p className="mt-0.5 truncate text-xs font-semibold text-accent">
              {session.title}
            </p>

            {preview && (
              <p className="mt-1 line-clamp-1 text-xs text-content-muted">
                {preview}
              </p>
            )}
          </div>
        </button>

        {/* Меню действий с сессией */}
        <div
          ref={menuAreaRef}
          className="relative shrink-0 self-center"
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;
            if (
              nextTarget instanceof Node &&
              !event.currentTarget.contains(nextTarget)
            ) {
              setMenuOpen(false);
            }
          }}
        >
          <button
            ref={triggerRef}
            type="button"
            disabled={busy}
            aria-label={`Действия с веткой «${session.title}»`}
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={toggleMenu}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl transition-all",
              menuOpen
                ? "bg-accent/20 text-accent"
                : "text-content-muted hover:bg-surface-2 hover:text-content"
            )}
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <MoreVertical size={18} strokeWidth={1.8} />
            )}
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              id={menuId}
              role="group"
              aria-label="Действия с веткой"
              className={cn(
                "absolute right-0 z-30 w-56 rounded-2xl border border-white/[0.08]",
                "bg-[#141824]/95 p-1.5 shadow-2xl backdrop-blur-2xl",
                openUpward ? "bottom-full mb-2" : "top-full mt-2"
              )}
            >
              {/* Кнопка закрепления / открепления */}
              <button
                type="button"
                className={actionClass}
                onClick={() => void runAction(() => toggleSessionPin(session.id))}
              >
                <Pin size={14} className={isPinned ? "rotate-45 fill-accent text-accent" : ""} />
                <span>{isPinned ? "Открепить ветку" : "Закрепить ветку"}</span>
              </button>

              <button
                type="button"
                className={actionClass}
                onClick={() => {
                  closeMenu(true);
                  const title = prompt("Новое название ветки:", session.title);
                  if (title) {
                    void runAction(() => renameSession(session.id, title));
                  }
                }}
              >
                <Pencil size={14} />
                <span>Переименовать</span>
              </button>

              <button
                type="button"
                className={actionClass}
                onClick={() => void runAction(() => cloneSession(session))}
              >
                <Copy size={14} />
                <span>Клонировать ветку</span>
              </button>

              <button
                type="button"
                className={actionClass}
                onClick={() => void runAction(() => exportChatSession(session.id))}
              >
                <Download size={14} />
                <span>Экспорт чата (.json)</span>
              </button>

              <div className="my-1 border-t border-white/[0.06]" />

              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-danger hover:bg-danger/10 active:bg-danger/15"
                onClick={() => {
                  closeMenu(true);
                  if (confirm("Удалить эту ветку диалога безвозвратно?")) {
                    void runAction(() => deleteSessionCascade(session.id));
                  }
                }}
              >
                <Trash2 size={14} />
                <span>Удалить ветку</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="mx-3 mb-3 flex items-start gap-2 rounded-xl bg-danger/5 p-2.5 text-xs text-danger"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <p className="min-w-0 [overflow-wrap:anywhere]">{actionError}</p>
        </div>
      )}
    </div>
  );
}

function stripMeta(text: string): string {
  return text
    .replace(/```meta[\s\S]*?```/i, "")
    .replace(/\*/g, "")
    .trim();
}