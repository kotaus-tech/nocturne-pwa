import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./Modal";

interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
  /** Пустое значение не подтверждается. */
  required?: boolean;
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
}

/**
 * Замена window.prompt: тот же сценарий ввода, но с валидацией,
 * нормальным фокусом и без блокировки потока.
 */
export function PromptDialog({
  open,
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "Сохранить",
  cancelLabel = "Отмена",
  maxLength,
  required = false,
  onConfirm,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    setValue(initialValue);
    setBusy(false);

    // Ждём, пока Modal отрисует панель, затем выделяем текст для быстрой замены.
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [open, initialValue]);

  const trimmed = value.trim();
  const canSubmit = !busy && (!required || trimmed.length > 0);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);

    try {
      await onConfirm(trimmed);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} size="sm" ariaLabel={title}>
      <form onSubmit={(event) => void handleSubmit(event)} className="p-6">
        <h2 className="text-base font-bold text-zinc-100">{title}</h2>

        {description && (
          <p
            id={descriptionId}
            className="mt-2 text-xs leading-relaxed text-content-secondary"
          >
            {description}
          </p>
        )}

        <div className="mt-4">
          {label && (
            <label
              htmlFor={inputId}
              className="mb-2 block text-xs font-semibold uppercase tracking-wider text-content-secondary"
            >
              {label}
            </label>
          )}

          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            aria-describedby={description ? descriptionId : undefined}
            className="input-field text-sm"
          />
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
            type="submit"
            disabled={!canSubmit}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50 sm:min-h-0"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
