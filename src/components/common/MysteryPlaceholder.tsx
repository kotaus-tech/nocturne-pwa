import { EyeOff } from "lucide-react";
import { cn } from "../../utils/cn";

/** Подпись заглушки. Текст скрытых данных в разметку не попадает вообще. */
export const MYSTERY_LABEL = "Скрыто режимом тайны";

const BAR_WIDTHS = ["92%", "74%", "86%", "58%"];

interface MysteryPlaceholderProps {
  /** Сколько «строк» показать: только форма блока, без содержимого. */
  lines?: number;
  /** Дополнительная подпись (например, счётчик символов без текста). */
  note?: string;
  className?: string;
}

/**
 * Заглушка вместо скрытого текста: полоски-«строки» и подпись. Сам текст
 * сюда не передаётся, поэтому в DOM его нет ни в каком виде (ни скрытым,
 * ни размытым), в отличие от CSS-blur.
 */
export function MysteryPlaceholder({ lines = 2, note, className }: MysteryPlaceholderProps) {
  return (
    <div
      role="note"
      aria-label={note ? `${MYSTERY_LABEL}. ${note}` : MYSTERY_LABEL}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] p-3",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-content-muted">
        <EyeOff size={12} aria-hidden="true" />
        <span>{MYSTERY_LABEL}</span>
        {note && <span className="font-normal">· {note}</span>}
      </div>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-2.5 rounded-full bg-white/[0.07]"
          style={{ width: BAR_WIDTHS[index % BAR_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}
