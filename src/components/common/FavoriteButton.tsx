import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Heart } from "lucide-react";
import { cn } from "../../utils/cn";

interface FavoriteButtonProps {
  isFavorite: boolean;
  onToggle: () => void;
  size?: number;
  className?: string;
  label?: string;
}

/**
 * Самостоятельная кнопка избранного.
 * Всегда останавливает всплытие клика/клавиатурных событий,
 * чтобы безопасно вкладываться в карточки-кнопки каталога.
 */
export function FavoriteButton({
  isFavorite,
  onToggle,
  size = 18,
  className,
  label,
}: FavoriteButtonProps) {
  const reducedMotion = useReducedMotion();
  const [justToggled, setJustToggled] = useState(false);

  const accessibleLabel =
    label ??
    (isFavorite ? "Убрать из избранного" : "Добавить в избранное");

  return (
    <button
      type="button"
      aria-pressed={isFavorite}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        setJustToggled(true);
        onToggle();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        "border border-white/10 bg-black/40 backdrop-blur-md",
        "text-content transition-colors duration-150",
        "hover:border-white/20 hover:bg-black/55",
        "active:bg-black/65 motion-reduce:transition-none",
        isFavorite && "text-[var(--relationship-affection)]",
        className
      )}
    >
      <motion.span
        className="flex items-center justify-center"
        animate={
          justToggled && !reducedMotion
            ? { scale: [1, 1.35, 1] }
            : { scale: 1 }
        }
        transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
        onAnimationComplete={() => setJustToggled(false)}
      >
        <Heart
          size={size}
          strokeWidth={1.8}
          aria-hidden="true"
          fill={isFavorite ? "currentColor" : "none"}
        />
      </motion.span>
    </button>
  );
}