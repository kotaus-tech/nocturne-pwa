import { useState, useRef, useEffect, useId, type ReactNode } from "react";
import {
  Upload,
  MessagesSquare,
  BookOpen,
  BrainCircuit,
  NotebookPen,
  AlertCircle,
  Loader2,
  Sparkles,
  RotateCcw,
  Languages,
  Wand2,
  Scissors,
  ChevronDown,
  ChevronUp,
  FileText,
  X,
  Eraser,
  Puzzle,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { ImportedCardSheet } from "./ImportedCardSheet";
import { Avatar } from "../common/Avatar";
import { Badge } from "../common/Badge";
import {
  saveImportedCharacterBundle,
  type ParsedCharacterPreview,
} from "../../utils/characterExport";
import type { CardCleanReport, NormalizedCard } from "../../services/characterCard";
import type { CardAiOptions } from "../../services/cardAi";
import {
  parseCharacterFile,
  rebuildPreviewCharacter,
  supportsCardImport,
} from "../../utils/characterCardFile";
import {
  compressCard,
  enrichCard,
  fixCard,
  polishCard,
  shouldCompressCard,
  translateCard,
  type CardAiProgress,
  type CardPassResult,
} from "../../services/cardAi";
import { getApiConfig } from "../../db";
import type { ApiConfig } from "../../types";
import { cn } from "../../utils/cn";

interface CharacterImportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (characterId: string) => void;
  initialFile?: File | null;
  /** Имя активной персоны: им заменяем `{{user}}` в тексте карточки. */
  userName?: string;
}

const AI_STAGE_LABELS: Record<CardAiProgress["mode"], string> = {
  translate: "Переводим карточку",
  polish: "Чистим текст",
  compress: "Сжимаем раздутые поля",
  repair: "Исправляем поля",
  enrich: "Дополняем поля",
};

/**
 * Общая подпись для случая, когда модель не вернула ни одного пригодного
 * фрагмента: отказ, цензурный фильтр или ответ не в том формате.
 */
const NO_ANSWER_NOTE =
  "Модель не вернула ни одного фрагмента — возможно, отказалась от этого текста или ответила не в нужном формате. Попробуйте ещё раз или выберите другую модель.";

/** Собирает понятную сводку: что чистка сделала с текстом карточки. */
function describeClean(clean: CardCleanReport): string[] {
  const parts: string[] = [];

  if (clean.blocks > 0) {
    parts.push(`лист персонажа разложен по полям: блоков — ${clean.blocks}`);
  }
  if (clean.placeholders > 0) {
    parts.push(`{{user}} и {{char}} заменены на имена: ${clean.placeholders}`);
  }
  if (clean.noise > 0) {
    parts.push(`выброшено служебных абзацев (changelog, реклама): ${clean.noise}`);
  }
  if (clean.images > 0) {
    parts.push(
      clean.avatarFromText
        ? `картинка из текста стала аватаром (убрано из текста: ${clean.images})`
        : `убрано картинок из текста: ${clean.images}`
    );
  }

  return parts;
}

// -------------------- Мелкие элементы интерфейса --------------------

/** Заголовок секции: маленькая капс-подпись с иконкой. */
function SectionTitle({ icon: Icon, children }: { icon: typeof Upload; children: ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
      <Icon size={12} className="shrink-0 text-accent/80" />
      {children}
    </h4>
  );
}

/** Переключатель-тумблер. */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors",
        checked ? "justify-end border-accent bg-accent" : "justify-start border-white/[0.1] bg-surface-3"
      )}
    >
      <span className="h-4.5 w-4.5 rounded-full bg-white shadow-sm" />
    </button>
  );
}

/** Строка настройки с описанием и тумблером справа. */
function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-surface-2/70 p-3">
      <div className="min-w-0">
        <p className="text-xs font-bold text-zinc-100">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-content-muted">{description}</p>
      </div>

      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

type AiButtonVariant = "primary" | "secondary" | "warning" | "ghost";

/** Кнопка действия модели: иконка, заголовок и короткое пояснение. */
function AiActionButton({
  icon: Icon,
  title,
  subtitle,
  onClick,
  disabled,
  variant = "secondary",
  className,
}: {
  icon: typeof Wand2;
  title: string;
  subtitle?: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: AiButtonVariant;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-xl border px-3.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" &&
          "border-transparent bg-accent text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.2)] hover:bg-accent-hover",
        variant === "secondary" &&
          "border-white/[0.08] bg-surface-2 text-content hover:border-accent/40 hover:text-accent",
        variant === "warning" &&
          "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20",
        variant === "ghost" &&
          "border-white/[0.06] bg-transparent text-content-secondary hover:border-white/[0.14] hover:text-content",
        className
      )}
    >
      <Icon size={16} className="shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{title}</span>
        {subtitle && (
          <span
            className={cn(
              "mt-0.5 block truncate text-[10px] leading-tight",
              variant === "primary" ? "text-on-accent/70" : "text-content-muted"
            )}
          >
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}

// -------------------- Окно импорта --------------------

export function CharacterImportModal({
  open,
  onClose,
  onSuccess,
  initialFile,
  userName,
}: CharacterImportModalProps) {
  const [file, setFile] = useState<File | null>(initialFile || null);
  /** Чистить служебный мусор карточки. Можно выключить и взять текст как есть. */
  const [cleanText, setCleanText] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ParsedCharacterPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [customName, setCustomName] = useState<string>("");
  const [includeChats, setIncludeChats] = useState<boolean>(true);
  const [isDragOver, setIsDragOver] = useState(false);

  // Работа модели: перевод и доработка карточки запускаются только по кнопке.
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [aiProgress, setAiProgress] = useState<CardAiProgress | null>(null);
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  /** Вкладки: сам импорт и лист персонажа — как карточка ляжет в базу. */
  const [tab, setTab] = useState<"import" | "sheet">("import");
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const [cleanReportOpen, setCleanReportOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputId = useId();

  useEffect(() => {
    if (!open) return;

    let active = true;
    getApiConfig()
      .then((config) => {
        if (active) setApiConfig(config);
      })
      .catch(() => {
        if (active) setApiConfig(null);
      });

    return () => {
      active = false;
    };
  }, [open]);

  // Закрыли окно или сменили файл — отменяем незаконченный запрос к модели.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setSaving(false);
      setAiNotes([]);
      setAiProgress(null);
      setTab("import");
      setCleanReportOpen(false);
      setFineTuneOpen(false);
      if (initialFile) {
        setFile(initialFile);
        void handleParseFile(initialFile);
      } else {
        setFile(null);
        setPreview(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  const handleParseFile = async (f: File, useClean = cleanText) => {
    setParsing(true);
    setError(null);
    try {
      const result = await parseCharacterFile(f, {
        userName,
        clean: useClean,
      });
      setPreview(result);
      setAiNotes([]);
      setCustomName(result.character.name);
      setIncludeChats(result.sessions.length > 0);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Не удалось прочитать файл персонажа.");
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.currentTarget.files?.[0];
    if (!selected) return;
    setFile(selected);
    void handleParseFile(selected);
    e.currentTarget.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && supportsCardImport(dropped)) {
      setFile(dropped);
      void handleParseFile(dropped);
    } else {
      setError("Поддерживаются файлы .json и PNG-карточки персонажей (.png).");
    }
  };

  const handleToggleClean = () => {
    const next = !cleanText;
    setCleanText(next);
    if (file) void handleParseFile(file, next);
  };

  const aiBusy = aiProgress !== null;

  /**
   * Общий запуск работы модели.
   *
   * Отмена — не ошибка: карточка просто остаётся прежней. Частичный ответ
   * модели тоже не ломает импорт: сервис применяет только то, что дошло.
   */
  const runAiJob = async (
    job: (options: CardAiOptions) => Promise<{
      card: NormalizedCard;
      note?: string;
    }>
  ) => {
    if (!preview?.card || aiBusy) return;

    if (!apiConfig) {
      setError("Настройте модель в разделе «Настройки системы» — без неё перевод и чистка недоступны.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setAiProgress({ mode: "polish", current: 0, total: 1 });

    try {
      const result = await job({
        apiConfig,
        signal: controller.signal,
        onProgress: setAiProgress,
      });

      setPreview(rebuildPreviewCharacter(preview, result.card));
      if (result.note) {
        setAiNotes((prev) => [result.note!, ...prev].slice(0, 5));
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        setAiNotes((prev) => ["Остановлено: карточка не изменилась.", ...prev].slice(0, 5));
      } else {
        setError(cause instanceof Error ? cause.message : "Модель не ответила.");
      }
    } finally {
      abortRef.current = null;
      setAiProgress(null);
    }
  };

  /**
   * Подпись результата прохода по тексту. Важно не врать: «перевод не
   * потребовался» — это когда отправлять было нечего, а не когда модель
   * ничего не вернула.
   */
  const passNote = (
    result: CardPassResult,
    phrases: { done: (changed: number) => string; idle: string; unchanged: string }
  ): string => {
    if (result.changed > 0) return phrases.done(result.changed);
    if (result.sent === 0) return phrases.idle;
    if (result.answered === 0) return NO_ANSWER_NOTE;
    return phrases.unchanged;
  };

  const handleTranslate = () =>
    void runAiJob(async (options) => {
      const result = await translateCard(preview!.card!, options);

      return {
        card: result.card,
        note: passNote(result, {
          done: (changed) => `Переведено фрагментов: ${changed}.`,
          idle: "Перевод не потребовался: текст карточки и так на русском.",
          unchanged: "Модель вернула текст без изменений.",
        }),
      };
    });

  const handlePolish = () =>
    void runAiJob(async (options) => {
      const result = await polishCard(preview!.card!, options);

      return {
        card: result.card,
        note: passNote(result, {
          done: (changed) => `Модель обработала полей: ${changed}.`,
          idle: "Чистить нечего: текстовых полей в карточке нет.",
          unchanged: "Модель не нашла, что править.",
        }),
      };
    });

  const handleCompress = () =>
    void runAiJob(async (options) => {
      const result = await compressCard(preview!.card!, options);

      return {
        card: result.card,
        note: passNote(result, {
          done: (changed) => `Сжато раздутых полей: ${changed}.`,
          idle: "Раздутых полей не нашлось.",
          unchanged: "Модель вернула текст без изменений.",
        }),
      };
    });

  const handleFix = () =>
    void runAiJob(async (options) => {
      const result = await fixCard(preview!.card!, options);

      return {
        card: result.card,
        note: result.notes.join(" "),
      };
    });

  const handleEnrich = () =>
    void runAiJob(async (options) => {
      const { card, filled } = await enrichCard(preview!.card!, options);

      return {
        card,
        note:
          filled.length > 0
            ? `Дополнено по фактам карточки: ${filled.join(", ")}.`
            : "Все поля уже заполнены — выдумывать модель не стала.",
      };
    });

  const handleCancelAi = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleImportSubmit = async () => {
    if (!preview || saving || aiBusy) return;
    setSaving(true);
    setError(null);

    try {
      const { characterId } = await saveImportedCharacterBundle({
        preview,
        customName: customName.trim() || preview.character.name,
        includeChats: includeChats && preview.sessions.length > 0,
      });

      onSuccess(characterId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка при сохранении персонажа.");
      setSaving(false);
    }
  };

  const statChips = preview
    ? [
        { icon: MessagesSquare, count: preview.stats.sessionsCount, label: "веток", tone: "text-accent" },
        { icon: BookOpen, count: preview.stats.loreCount, label: "знаний", tone: "text-info" },
        { icon: BrainCircuit, count: preview.stats.factsCount, label: "фактов", tone: "text-success" },
        { icon: NotebookPen, count: preview.stats.diaryCount, label: "записей", tone: "text-[var(--relationship-affection)]" },
      ].filter((chip) => chip.count > 0)
    : [];

  const sourceLabel = preview?.cardInfo
    ? `${preview.cardInfo.label}${preview.cardInfo.fromPng ? " из PNG" : ""}`
    : preview?.isFullArchive
      ? "Полный архив экосистемы"
      : "Одиночная карточка";

  return (
    <Modal open={open} onClose={onClose} title="Импорт персонажа" size="lg" variant="sheet">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.png,application/json,image/png"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="space-y-4">
        {/* ---------- Шаг выбора файла ---------- */}
        {!preview && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={cn(
              "group relative flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all",
              isDragOver
                ? "border-accent bg-accent/15 ring-4 ring-accent/20"
                : "border-white/[0.12] bg-[#121622]/80 hover:border-accent/60 hover:bg-[#161b28]"
            )}
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-surface-2 shadow-inner transition-transform group-hover:scale-105">
              {parsing ? (
                <Loader2 size={28} className="animate-spin text-accent" />
              ) : (
                <Upload size={28} className="text-accent" />
              )}
            </div>

            <h3 className="text-sm font-bold text-zinc-100">
              {parsing ? "Анализируем файл персонажа…" : "Перетащите файл персонажа сюда"}
            </h3>
            <p className="mt-1 text-xs text-content-secondary">
              или нажмите, чтобы выбрать файл на устройстве
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {["Архивы NOCTURNE", "Карточки Character Card (.json)", "PNG с карточкой"].map((format) => (
                <span
                  key={format}
                  className="rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-muted group-hover:text-content"
                >
                  {format}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ---------- Заголовок персонажа ---------- */}
        {preview && (
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#161b26] to-[#121620] p-4">
            <div className="flex items-start gap-4">
              <Avatar
                src={preview.character.avatarUrl}
                name={preview.character.name}
                size={64}
                className="shrink-0 ring-1 ring-white/10"
              />

              <div className="min-w-0 flex-1">
                <label
                  htmlFor={nameInputId}
                  className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted"
                >
                  Имя персонажа
                </label>
                <input
                  id={nameInputId}
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Имя персонажа…"
                  className="w-full rounded-lg border border-transparent bg-transparent px-0 text-base font-bold text-zinc-100 outline-none transition-colors placeholder:text-content-muted/60 hover:border-b-white/[0.15] focus:border-b-accent"
                />

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Badge size="sm">{sourceLabel}</Badge>

                  {preview.cardInfo?.creator && (
                    <span className="text-[11px] text-content-muted">
                      автор: {preview.cardInfo.creator}
                    </span>
                  )}

                  {preview.character.genre?.trim() && (
                    <span className="text-[11px] text-content-secondary">{preview.character.genre}</span>
                  )}

                  {parsing && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-accent">
                      <Loader2 size={12} className="animate-spin" />
                      обновляем…
                    </span>
                  )}
                </div>

                {preview.character.tagline && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-accent">
                    {preview.character.tagline}
                  </p>
                )}
              </div>
            </div>

            {/* Сводка содержимого: показываем только то, чего больше нуля */}
            {(statChips.length > 0 ||
              (preview.cardInfo?.alternateGreetings ?? 0) > 0 ||
              (preview.cardInfo?.tags.length ?? 0) > 0) && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-3">
                {statChips.map(({ icon: Icon, count, label, tone }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-surface-2/70 px-2.5 py-1 text-[11px] text-content-secondary"
                  >
                    <Icon size={13} className={cn("shrink-0", tone)} />
                    <span className="tabular-nums">
                      {count} {label}
                    </span>
                  </span>
                ))}

                {(preview.cardInfo?.alternateGreetings ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-surface-2/70 px-2.5 py-1 text-[11px] text-content-secondary">
                    <MessagesSquare size={13} className="shrink-0 text-accent" />
                    <span className="tabular-nums">
                      +{preview.cardInfo!.alternateGreetings} варианта приветствия
                    </span>
                  </span>
                )}

                {(preview.cardInfo?.tags ?? []).slice(0, 8).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-lg border border-white/[0.05] bg-white/[0.03] px-2 py-1 text-[11px] text-content-muted"
                  >
                    {tag}
                  </span>
                ))}

                {(preview.cardInfo?.tags.length ?? 0) > 8 && (
                  <span className="px-1 text-[11px] text-content-muted">
                    +{preview.cardInfo!.tags.length - 8} ещё
                  </span>
                )}
              </div>
            )}

            {/* Отчёт автоматической чистки */}
            {preview.cardInfo?.clean && (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <button
                  type="button"
                  onClick={() => setCleanReportOpen((prev) => !prev)}
                  aria-expanded={cleanReportOpen}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-success">
                    <Eraser size={13} className="shrink-0" />
                    Текст карточки очищен автоматически
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-content-muted">
                    подробнее
                    {cleanReportOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </span>
                </button>

                {cleanReportOpen && (
                  <ul className="mt-2 space-y-1 rounded-xl border border-white/[0.06] bg-surface-2/60 p-3">
                    {describeClean(preview.cardInfo.clean).map((line) => (
                      <li key={line} className="text-[11px] leading-relaxed text-content-secondary">
                        • {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------- Вкладки ---------- */}
        {preview && (
          <div
            role="tablist"
            aria-label="Режим просмотра карточки"
            className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.06] bg-surface-2 p-1"
          >
            {([
              { key: "import", label: "Импорт", icon: Upload },
              { key: "sheet", label: "Карточка", icon: FileText },
            ] as const).map(({ key, label, icon: Icon }) => {
              const selected = tab === key;

              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 py-2 transition-all",
                    selected
                      ? "bg-accent/15 text-accent shadow-sm"
                      : "text-content-muted hover:bg-white/[0.04] hover:text-content"
                  )}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="text-xs font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ---------- Вкладка «Карточка» ---------- */}
        {tab === "sheet" && preview && <ImportedCardSheet character={preview.character} />}

        {/* ---------- Вкладка «Импорт» ---------- */}
        {tab === "import" && preview && (
          <div className="space-y-5">
            {/* Доработка моделью */}
            {preview.card && (
              <section className="rounded-2xl border border-white/[0.07] bg-surface-2/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <SectionTitle icon={Sparkles}>Доработка моделью</SectionTitle>

                  <span className="max-w-[60%] truncate text-[11px] text-content-muted">
                    {apiConfig
                      ? `${apiConfig.model || "модель не выбрана"} · запросы только по кнопке`
                      : "Подключите модель в настройках системы"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <AiActionButton
                    icon={Wand2}
                    title="Привести в порядок"
                    subtitle="Мусор, перепутанные и пустые поля — за один проход"
                    onClick={handleFix}
                    disabled={aiBusy}
                    variant="primary"
                    className="sm:col-span-2"
                  />

                  <AiActionButton
                    icon={Languages}
                    title="Перевести на русский"
                    subtitle="Литературный перевод с адаптацией имён"
                    onClick={handleTranslate}
                    disabled={aiBusy}
                  />

                  {shouldCompressCard(preview.card) ? (
                    <AiActionButton
                      icon={Scissors}
                      title="Сжать раздутые поля"
                      subtitle="Карточка очень большая: сожмём длинные поля"
                      onClick={handleCompress}
                      disabled={aiBusy}
                      variant="warning"
                    />
                  ) : (
                    <AiActionButton
                      icon={Puzzle}
                      title="Дополнить пустые поля"
                      subtitle="Только по фактам карточки, без выдумок"
                      onClick={handleEnrich}
                      disabled={aiBusy}
                    />
                  )}
                </div>

                {/* Отдельные действия */}
                <div className="mt-3 border-t border-white/[0.06] pt-3">
                  <button
                    type="button"
                    onClick={() => setFineTuneOpen((prev) => !prev)}
                    aria-expanded={fineTuneOpen}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-content-muted transition-colors hover:text-content"
                  >
                    {fineTuneOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    <span>Отдельные действия</span>
                  </button>

                  {fineTuneOpen && (
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <AiActionButton
                        icon={Eraser}
                        title="Только очистить"
                        subtitle="Убрать мусор из текста"
                        onClick={handlePolish}
                        disabled={aiBusy}
                        variant="ghost"
                      />

                      <AiActionButton
                        icon={Puzzle}
                        title="Только дополнить"
                        subtitle="Заполнить пустые поля"
                        onClick={handleEnrich}
                        disabled={aiBusy}
                        variant="ghost"
                      />
                    </div>
                  )}
                </div>

                {/* Прогресс работы модели */}
                {aiProgress && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mt-3 rounded-xl border border-accent/25 bg-accent/[0.07] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-xs text-content-secondary">
                        <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
                        <span className="truncate">
                          {aiProgress.stage ?? AI_STAGE_LABELS[aiProgress.mode]}
                          {aiProgress.total > 1 ? ` — ${aiProgress.current} из ${aiProgress.total}` : "…"}
                        </span>
                      </span>

                      <button
                        type="button"
                        onClick={handleCancelAi}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.1] bg-surface-2/70 px-2 py-1 text-[11px] font-semibold text-content-secondary transition-colors hover:text-content"
                      >
                        <X size={12} />
                        <span>Остановить</span>
                      </button>
                    </div>

                    {aiProgress.total > 1 && (
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-300"
                          style={{
                            width: `${Math.min(100, Math.round((aiProgress.current / aiProgress.total) * 100))}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Отчёт модели о сделанном */}
                {aiNotes.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {aiNotes.map((note) => (
                      <li
                        key={note}
                        className="rounded-xl border border-white/[0.06] bg-surface-2/60 px-3 py-2 text-[11px] leading-relaxed text-content-secondary"
                      >
                        {note}
                      </li>
                    ))}
                  </ul>
                )}

              </section>
            )}

            {/* Параметры импорта */}
            <section className="rounded-2xl border border-white/[0.07] bg-surface-2/40 p-4">
              <SectionTitle icon={Upload}>Параметры импорта</SectionTitle>

              <div className="mt-3 space-y-2">
                {preview.cardInfo && (
                  <ToggleRow
                    title="Очищать текст карточки"
                    description="Убрать HTML, changelog и ссылки, а лист персонажа разложить по полям"
                    checked={cleanText}
                    onChange={handleToggleClean}
                  />
                )}

                {preview.sessions.length > 0 && (
                  <ToggleRow
                    title={`Импортировать историю общения (${preview.stats.sessionsCount} веток)`}
                    description="Сохранить все сообщения, дневники и накопленную память"
                    checked={includeChats}
                    onChange={() => setIncludeChats((prev) => !prev)}
                  />
                )}

                {!preview.cardInfo && preview.sessions.length === 0 && (
                  <p className="text-[11px] text-content-muted">
                    Файл будет импортирован как есть — дополнительных параметров нет.
                  </p>
                )}
              </div>
            </section>

            {/* Служебная строка */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                  setError(null);
                  setAiNotes([]);
                  setTab("import");
                  setCleanReportOpen(false);
                  fileInputRef.current?.click();
                }}
                className="inline-flex items-center gap-1.5 text-xs text-content-muted transition-colors hover:text-content"
              >
                <RotateCcw size={13} />
                <span>Выбрать другой файл</span>
              </button>

              {file && (
                <span className="max-w-[55%] truncate text-[11px] text-content-muted" title={file.name}>
                  {file.name}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ---------- Ошибка ---------- */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/5 p-3.5 text-xs leading-relaxed text-danger"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="[overflow-wrap:anywhere]">{error}</span>
          </div>
        )}

        {/* ---------- Футер ---------- */}
        <div className="flex items-center justify-end gap-2.5 border-t border-white/[0.08] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] bg-surface-2 px-4 py-2.5 text-xs font-semibold text-content-secondary transition-colors hover:bg-surface-3 hover:text-content"
          >
            Отмена
          </button>

          {preview && (
            <button
              type="button"
              disabled={saving || aiBusy}
              onClick={() => void handleImportSubmit()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              <span>Импортировать персонажа</span>
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
