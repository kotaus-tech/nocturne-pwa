import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "accent" | "outline" | "solid-dark";
  size?: "sm" | "md";
  className?: string;
  icon?: ReactNode;
}

/**
 * Пилюля-бейдж для жанров, тегов и статусов.
 * variant="outline" / "solid-dark" предназначены для использования
 * поверх изображений (обложки персонажей) — с полупрозрачным тёмным фоном.
 */
export function Badge({
  children,
  variant = "default",
  size = "sm",
  className,
  icon,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full font-medium leading-none whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        variant === "default" &&
          "border border-border-strong bg-surface-2 text-content-secondary",
        variant === "accent" &&
          "border border-accent/30 bg-accent/10 text-accent",
        variant === "outline" &&
          "border border-white/15 bg-black/35 text-content backdrop-blur-md",
        variant === "solid-dark" &&
          "border border-white/10 bg-black/55 text-content backdrop-blur-md",
        className
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}