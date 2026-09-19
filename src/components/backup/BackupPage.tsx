import { useRef, useState } from "react";
import {
  DownloadCloud,
  UploadCloud,
  AlertTriangle,
  DatabaseBackup,
  Loader2,
  CheckCircle2,
  XCircle,
  KeyRound,
  Trash2,
} from "lucide-react";
import {
  exportBackup,
  importBackup,
  wipeAllData,
  type BackupBundle,
} from "../../db";
import { cn } from "../../utils/cn";

type Operation = "export" | "import" | "wipe";

interface Status {
  type: "success" | "error";
  text: string;
}

export function BackupPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const [operation, setOperation] = useState<Operation | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const busy = operation !== null;

  const beginOperation = (next: Operation): boolean => {
    if (busyRef.current) return false;

    busyRef.current = true;
    setOperation(next);
    setStatus(null);
    return true;
  };

  const finishOperation = () => {
    busyRef.current = false;
    setOperation(null);
  };

  const handleExport = async () => {
    if (!beginOperation("export")) return;

    let objectUrl: string | null = null;

    try {
      const bundle = await exportBackup();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });

      objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `anima-rp-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      link.click();

      setStatus({
        type: "success",
        text: "Файл резервной копии подготовлен. Скачивание запрошено — проверьте загрузки браузера.",
      });
    } catch (cause) {
      setStatus({
        type: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "Ошибка при экспорте бэкапа.",
      });
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      finishOperation();
    }
  };

  const handleImport = async (file: File) => {
    if (!beginOperation("import")) return;

    let reloadScheduled = false;

    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;

      if (!bundle || typeof bundle !== "object") {
        throw new Error(
          "Файл не является корректным JSON-документом."
        );
      }

      const confirmed = confirm(
        "Импорт полностью заменит текущих персонажей, диалоги и настройки. Продолжить?"
      );

      if (!confirmed) return;

      await importBackup(bundle);

      setStatus({
        type: "success",
        text: "Данные успешно восстановлены. Перезагрузка приложения…",
      });

      /*
       * Существующая перезагрузка после импорта сохранена.
       * Блокировка операций остаётся до её выполнения.
       */
      reloadScheduled = true;
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (cause) {
      setStatus({
        type: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "Не удалось прочитать файл бэкапа. Проверьте формат.",
      });
    } finally {
      if (!reloadScheduled) finishOperation();
    }
  };

  const handleWipe = async () => {
    if (busyRef.current) return;

    const confirmed = confirm(
      "Точно удалить ВСЕ локальные данные без возможности восстановления?"
    );

    if (!confirmed || !beginOperation("wipe")) return;

    let reloading = false;

    try {
      await wipeAllData();
      window.location.reload();
      reloading = true;
    } catch (cause) {
      setStatus({
        type: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "Не удалось удалить данные.",
      });
    } finally {
      if (!reloading) finishOperation();
    }
  };

  const operationText =
    operation === "export"
      ? "Подготавливаем резервную копию…"
      : operation === "import"
        ? "Восстанавливаем данные…"
        : operation === "wipe"
          ? "Удаляем локальные данные…"
          : "";

  return (
    <div
      className={[
        "mx-auto w-full max-w-4xl",
        "pl-[max(16px,env(safe-area-inset-left))]",
        "pr-[max(16px,env(safe-area-inset-right))]",
        "pt-[max(24px,env(safe-area-inset-top))] pb-8",
        "sm:px-6",
        "md:px-8 md:pt-[max(40px,env(safe-area-inset-top))]",
        "md:pb-[max(40px,env(safe-area-inset-bottom))]",
        "xl:px-10",
      ].join(" ")}
    >
      <header className="mb-8">
        <p className="mb-5 text-xs font-semibold tracking-[0.12em] text-content-muted md:hidden">
          NOCTURNE
        </p>

        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-content sm:text-[32px]">
          Локальный бэкап
        </h1>

        <p className="mt-2 max-w-xl text-base leading-relaxed text-content-secondary">
          Сохраните ваше пространство и восстановите его из
          резервной копии.
        </p>
      </header>

      <section className="mb-6 flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent"
        >
          <DatabaseBackup size={23} strokeWidth={1.6} />
        </span>

        <div className="min-w-0">
          <h2 className="text-base font-semibold text-content">
            Данные в вашем браузере
          </h2>

          <p className="mt-2 text-sm leading-relaxed text-content-secondary">
            Персонажи, чаты, настройки и сохранённая память
            находятся в локальной базе IndexedDB. При работе с AI
            необходимый контекст отправляется выбранному API.
          </p>
        </div>
      </section>

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
        <KeyRound
          size={20}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-warning"
        />

        <div className="min-w-0">
          <p className="text-sm font-semibold text-warning">
            Резервная копия содержит приватные данные
          </p>

          <p className="mt-1 text-sm leading-relaxed text-content-secondary">
            В JSON входят переписки, настройки и сохранённый
            API-ключ. Файл не зашифрован. Храните его в безопасном
            месте и не публикуйте.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col rounded-[20px] border border-border bg-surface p-5 sm:p-6">
          <DownloadCloud
            size={25}
            strokeWidth={1.6}
            aria-hidden="true"
            className="mb-5 text-accent"
          />

          <h2 className="text-xl font-semibold tracking-tight text-content">
            Экспорт
          </h2>

          <p className="mb-6 mt-2 text-sm leading-relaxed text-content-secondary">
            Все персонажи, ветки диалогов, сообщения и настройки
            в одном JSON-файле.
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleExport()}
            className="mt-auto flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-50 motion-reduce:transition-none"
          >
            {operation === "export" ? (
              <Loader2
                size={18}
                aria-hidden="true"
                className="shrink-0 animate-spin"
              />
            ) : (
              <DownloadCloud
                size={18}
                aria-hidden="true"
                className="shrink-0"
              />
            )}
            Экспортировать всё в .json
          </button>
        </section>

        <section className="flex min-w-0 flex-col rounded-[20px] border border-border bg-surface p-5 sm:p-6">
          <UploadCloud
            size={25}
            strokeWidth={1.6}
            aria-hidden="true"
            className="mb-5 text-content-secondary"
          />

          <h2 className="text-xl font-semibold tracking-tight text-content">
            Восстановление
          </h2>

          <p className="mb-6 mt-2 text-sm leading-relaxed text-content-secondary">
            Импорт полностью заменит текущие данные содержимым
            резервной копии. Перед заменой потребуется подтверждение.
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="mt-auto flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-4 py-3 text-sm font-semibold text-content transition-colors hover:bg-surface-3 disabled:opacity-50 motion-reduce:transition-none"
          >
            {operation === "import" ? (
              <Loader2
                size={18}
                aria-hidden="true"
                className="shrink-0 animate-spin"
              />
            ) : (
              <UploadCloud
                size={18}
                aria-hidden="true"
                className="shrink-0"
              />
            )}
            Импортировать из .json
          </button>
        </section>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        aria-label="Выбрать файл полной резервной копии"
        className="hidden"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];

          if (file) void handleImport(file);
          input.value = "";
        }}
      />

      {busy && !status && (
        <p
          role="status"
          className="mt-4 text-sm leading-relaxed text-content-secondary"
        >
          {operationText}
        </p>
      )}

      {status && (
        <div
          role={status.type === "error" ? "alert" : "status"}
          className={cn(
            "mt-5 flex items-start gap-3 rounded-xl border p-4",
            status.type === "success"
              ? "border-success/30 bg-success/5"
              : "border-danger/30 bg-danger/5"
          )}
        >
          {status.type === "success" ? (
            <CheckCircle2
              size={20}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-success"
            />
          ) : (
            <XCircle
              size={20}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-danger"
            />
          )}

          <p
            className={cn(
              "min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]",
              status.type === "success"
                ? "text-success"
                : "text-danger"
            )}
          >
            {status.text}
          </p>
        </div>
      )}

      <section className="mt-10 border-t border-border pt-6">
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={22}
            strokeWidth={1.7}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-danger"
          />

          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-content">
              Опасная зона
            </h2>

            <p className="mt-2 max-w-xl text-sm leading-relaxed text-content-secondary">
              Полное удаление всех персонажей, чатов, дневников
              и настроек с этого устройства. Без резервной копии
              восстановить их не получится.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleWipe()}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-danger/50 px-4 py-3 text-sm font-semibold text-danger transition-colors hover:bg-danger/10 active:bg-danger/15 disabled:opacity-50 motion-reduce:transition-none sm:w-auto"
        >
          {operation === "wipe" ? (
            <Loader2
              size={18}
              aria-hidden="true"
              className="animate-spin"
            />
          ) : (
            <Trash2 size={18} aria-hidden="true" />
          )}
          Стереть все данные
        </button>
      </section>
    </div>
  );
}