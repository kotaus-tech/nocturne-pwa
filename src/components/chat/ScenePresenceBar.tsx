import { Users } from "lucide-react";
import { Avatar } from "../common/Avatar";
import { cn } from "../../utils/cn";
import type { Character } from "../../types";

interface ScenePresenceBarProps {
  /** Весь состав сцены. */
  cast: Character[];
  /** Кто сейчас физически в сцене. */
  present: Character[];
  /** Идёт генерация — переключатели блокируются. */
  disabled?: boolean;
  onToggle: (character: Character, isPresent: boolean) => void;
}

/**
 * Мини-бар групповой сцены в шапке чата: 🟢 персонаж в комнате, ⚪ за кадром.
 * Один клик отправляет героя «за дверь» или возвращает его в сцену — тот, кого
 * нет в комнате, не может отвечать и не попадает в пул говорящих.
 */
export function ScenePresenceBar({
  cast,
  present,
  disabled,
  onToggle,
}: ScenePresenceBarProps) {
  if (cast.length < 2) return null;

  const presentIds = new Set(present.map((item) => item.id));

  return (
    <div
      role="group"
      aria-label="Кто сейчас в сцене"
      className="flex items-center gap-1.5 overflow-x-auto overscroll-contain px-3 pb-2 sm:px-6"
    >
      <span className="flex shrink-0 items-center gap-1 pr-0.5 text-[10px] font-bold uppercase tracking-wider text-content-muted">
        <Users size={11} strokeWidth={2.2} className="text-accent" />
        {present.length}/{cast.length}
      </span>

      {cast.map((character) => {
        const isPresent = presentIds.has(character.id);

        return (
          <button
            key={character.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(character, !isPresent)}
            aria-pressed={isPresent}
            title={
              isPresent
                ? `${character.name} в сцене — убрать за кадр`
                : `${character.name} за кадром — ввести в сцену`
            }
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5",
              "text-[11px] font-medium transition-all active:scale-95 disabled:opacity-40",
              isPresent
                ? "border-accent/35 bg-accent/12 text-content"
                : "border-white/[0.07] bg-[#121622]/70 text-content-muted opacity-70 hover:opacity-100"
            )}
          >
            <span className="relative flex items-center">
              <Avatar src={character.avatarUrl} name={character.name} size={20} />
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0c0f15]",
                  isPresent ? "bg-success" : "bg-content-muted"
                )}
              />
            </span>

            <span className="max-w-[7rem] truncate">{character.name}</span>
          </button>
        );
      })}
    </div>
  );
}
