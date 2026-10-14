import { LockKeyhole } from "lucide-react";
import { cn } from "../../utils/cn";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

/**
 * Единый выбор режима перед DNA-генерацией/импортом.
 * Сам флаг живёт у конкретного модального генератора, а визуальный контракт
 * и понятное пользователю описание не расходятся между экранами.
 */
export function MysteryModeToggle({ enabled, onChange }: Props) {
  return (
    <div className="rounded-2xl border border-accent/25 bg-accent/5 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <LockKeyhole size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-content">Режим тайны</p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-content-secondary">
              {enabled
                ? "Включён: после генерации результат сохранится, и чат откроется сразу без предпросмотра."
                : "Выключен: сначала покажем предпросмотр, а сохранение произойдёт только после подтверждения."}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Режим тайны"
          aria-checked={enabled}
          onClick={() => onChange(!enabled)}
          className={cn(
            "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
            enabled
              ? "border-accent/50 bg-accent/15 text-accent"
              : "border-white/[0.1] bg-surface-2 text-content-secondary hover:bg-surface-3"
          )}
        >
          <span className={cn("h-2.5 w-2.5 rounded-full", enabled ? "bg-accent" : "bg-content-muted")} />
          {enabled ? "Включён" : "Выключен"}
        </button>
      </div>
    </div>
  );
}
