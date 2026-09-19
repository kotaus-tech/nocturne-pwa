import { useId } from "react";
import { cn } from "../../utils/cn";

interface ProgressBarProps {
  label: string;
  value: number;
  colorClass: string;
  compact?: boolean;
}

export function ProgressBar({
  label,
  value,
  colorClass,
  compact,
}: ProgressBarProps) {
  const labelId = useId();

  const hasValidValue = Number.isFinite(value);
  const visualValue = hasValidValue
    ? Math.min(100, Math.max(0, value))
    : 0;

  const valueText = hasValidValue
    ? `${value} из 100`
    : "Значение недоступно";

  return (
    <div className="w-full min-w-0">
      <div
        className={cn(
          "flex items-start justify-between gap-3",
          compact ? "mb-2 text-xs" : "mb-2 text-sm"
        )}
      >
        <span
          id={labelId}
          className="min-w-0 text-content-secondary [overflow-wrap:anywhere]"
        >
          {label}
        </span>

        <span className="shrink-0 font-medium tabular-nums text-content">
          {hasValidValue ? value : "—"}
        </span>
      </div>

      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={visualValue}
        aria-valuetext={valueText}
        className={cn(
          "w-full overflow-hidden rounded-full bg-surface-3",
          compact ? "h-1.5" : "h-2"
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "h-full rounded-full",
            "transition-[width] duration-200 ease-out",
            "motion-reduce:transition-none",
            colorClass
          )}
          style={{ width: `${visualValue}%` }}
        />
      </div>
    </div>
  );
}