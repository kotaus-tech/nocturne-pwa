import { useState } from "react";
import { cn } from "../../utils/cn";

interface AvatarProps {
  src?: string;
  name: string;
  size?: number;
  className?: string;
  ring?: boolean;
}

export function Avatar({
  src,
  name,
  size = 44,
  className,
  ring,
}: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const accessibleName = name.trim() || "Аватар";

  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("");

  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div
      role="img"
      aria-label={accessibleName}
      className={cn(
        "relative flex shrink-0 select-none items-center justify-center",
        "overflow-hidden rounded-full",
        "bg-[var(--avatar-background)] text-[var(--avatar-foreground)]",
        "font-semibold",
        ring &&
          "ring-2 ring-accent/50 ring-offset-2 ring-offset-surface",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        lineHeight: 1,
      }}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          draggable={false}
          className="block h-full w-full object-cover"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : (
        <span aria-hidden="true">{initials || "?"}</span>
      )}
    </div>
  );
}