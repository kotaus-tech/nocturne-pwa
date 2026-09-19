import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronDown, UserCircle2 } from "lucide-react";
import { getPersonaState, setActivePersona } from "../../db";
import { Avatar } from "./Avatar";
import { cn } from "../../utils/cn";

interface PersonaSwitcherProps {
  /** compact — только аватар и стрелка, для шапки чата. */
  variant?: "compact" | "full";
  /** Куда встаёт выпадающий список: вверх (низ экрана) или вниз. */
  align?: "top" | "bottom";
  className?: string;
  onOpenManager?: () => void;
}

/**
 * Быстрое переключение активной персоны без похода в «Мои персоны».
 * Список приходит живым запросом, поэтому отметка активной всегда актуальна.
 */
export function PersonaSwitcher({
  variant = "full",
  align = "bottom",
  className,
  onOpenManager,
}: PersonaSwitcherProps) {
  const state = useLiveQuery(() => getPersonaState(), []);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const personas = state?.personas ?? [];
  const active = state?.activePersona ?? personas[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!active) return null;

  const handleSelect = async (personaId: string) => {
    setOpen(false);
    if (personaId === active.id) return;
    await setActivePersona(personaId).catch(() => {});
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Сменить персону"
        className={cn(
          "flex items-center gap-2 rounded-xl transition-colors",
          variant === "compact"
            ? "h-10 w-10 justify-center border border-white/[0.07] bg-[#121622]/80 hover:bg-[#161b28]"
            : "w-full border border-white/[0.07] bg-surface-2/70 px-2.5 py-2 hover:bg-surface-2",
          open && "border-accent/40"
        )}
      >
        <Avatar src={active.avatarUrl} name={active.name} size={variant === "compact" ? 26 : 28} />

        {variant === "full" && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-content-muted">
                Ваша персона
              </span>
              <span className="block truncate text-xs font-medium text-content">
                {active.name || "Странник"}
              </span>
            </span>
            <ChevronDown
              size={14}
              className={cn("shrink-0 text-content-muted transition-transform", open && "rotate-180")}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Выбор персоны"
          className={cn(
            "absolute z-50 w-60 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0f131c]/97 p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl",
            align === "top" ? "bottom-full mb-2" : "top-full mt-2",
            variant === "compact" ? "right-0" : "left-0"
          )}
        >
          <div className="max-h-72 overflow-y-auto">
            {personas.map((persona) => {
              const isActive = persona.id === active.id;
              return (
                <button
                  key={persona.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => void handleSelect(persona.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors",
                    isActive ? "bg-accent/12 text-accent" : "text-content-secondary hover:bg-white/[0.05] hover:text-content"
                  )}
                >
                  <Avatar src={persona.avatarUrl} name={persona.name} size={26} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {persona.name || "Странник"}
                  </span>
                  {isActive && <Check size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>

          {onOpenManager && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenManager();
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-white/[0.06] px-2 py-2 pt-2.5 text-[11px] font-medium text-content-muted hover:text-accent"
            >
              <UserCircle2 size={13} />
              Управлять персонами
            </button>
          )}
        </div>
      )}
    </div>
  );
}
