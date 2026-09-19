import { useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { cn } from "../../utils/cn";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Опасное действие: красный акцент и предупреждающая иконка. */
  tone?: "default" | "danger";
  /** Асинхронное действие: диалог остаётся открытым до завершения. */
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

/**
 * Замена window.confirm: тот же сценарий, но в стиле приложения,
 * с нормальным фокусом, клавиатурой и без блокировки потока.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  tone = "default",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  const isDanger = tone === "danger";

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);

    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="sm"
      ariaLabel={title}
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          {isDanger && (
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-danger/10 text-danger"
            >
              <AlertTriangle size={22} strokeWidth={1.7} />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className={cn(
                "text-base font-bold",
                isDanger ? "text-danger" : "text-zinc-100"
              )}
            >
              {title}
            </h2>

            {description && (
              <p
                id={descriptionId}
                className="mt-2 text-xs leading-relaxed text-content-secondary [overflow-wrap:anywhere]"
              >
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-xl border border-white/[0.09] bg-surface-2 px-4 py-2.5 text-xs font-semibold text-content-secondary transition-colors hover:bg-surface-3 hover:text-content disabled:opacity-50 sm:min-h-0"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50 sm:min-h-0",
              isDanger
                ? "border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25"
                : "bg-accent text-on-accent hover:bg-accent-hover"
            )}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
