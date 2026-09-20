import { useState, useRef, useEffect, useId } from "react";
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
  ClipboardCheck,
  Scissors,
  ChevronDown,
  ChevronUp,
  FileText,
  X,
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
  auditCard,
  compressCard,
  enrichCard,
  fixCard,
  polishCard,
  shouldCompressCard,
  translateCard,
  type CardAudit,
  type CardAiProgress,
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
  audit: "Проверяем поля",
};

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
  const [audit, setAudit] = useState<CardAudit | null>(null);
  /** Вкладки: сам импорт и лист персонажа — как карточка ляжет в базу. */
  const [tab, setTab] = useState<"import" | "sheet">("import");
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
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
      setAudit(null);
      setAiProgress(null);
      setTab("import");
      if (initialFile) {
        setFile(initialFile);
        void handleParseFile(initialFile);
      } else {
        setFile(null);
        setPreview(null);
      }
    }
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
      setAudit(null);
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
      setError(
        "Поддерживаются файлы .json и PNG-карточки персонажей (.png)."
      );
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
      audit?: CardAudit;
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
      if (result.audit) setAudit(result.audit);
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

  const handleTranslate = () =>
    void runAiJob(async (options) => {
      const { card, changed } = await translateCard(preview!.card!, options);

      return {
        card,
        note:
          changed > 0
            ? `Переведено фрагментов: ${changed}.`
            : "Перевод не потребовался: текст карточки и так на русском.",
      };
    });

  const handlePolish = () =>
    void runAiJob(async (options) => {
      const { card, changed } = await polishCard(preview!.card!, options);

      return {
        card,
        note: changed > 0 ? `Модель обработала полей: ${changed}.` : "Модель не нашла, что править.",
      };
    });

  const handleCompress = () =>
    void runAiJob(async (options) => {
      const { card, changed } = await compressCard(preview!.card!, options);

      return {
        card,
        note: changed > 0 ? `Сжато раздутых полей: ${changed}.` : "Раздутых полей не нашлось.",
      };
    });

  const handleFix = () =>
    void runAiJob(async (options) => {
      const result = await fixCard(preview!.card!, options);

      return {
        card: result.card,
        audit: result.audit ?? undefined,
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

  const handleAudit = () =>
    void runAiJob(async (options) => {
      const result = await auditCard(preview!.card!, options);

      return {
        card: preview!.card!,
        audit: result,
        note:
          result.issues.length > 0
            ? `Проверка нашла замечаний: ${result.issues.length}.`
            : "Проверка пройдена: замечаний нет.",
      };
    });

  const handleCancelAi = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleImportSubmit = async () => {
    if (!preview || saving) return;
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Импорт персонажа"
      size={tab === "sheet" ? "lg" : "md"}
      variant="sheet"
    >
      <div className="space-y-5">
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
                    "flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 transition-all",
                    selected
                      ? "bg-accent/15 text-accent shadow-sm"
                      : "text-content-muted hover:bg-white/[0.04] hover:text-content"
                  )}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="text-[11px] font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === "sheet" && preview && <ImportedCardSheet character={preview.character} />}

        {tab === "import" && (
          !preview ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "group relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-6 text-center transition-all",
              isDragOver
                ? "border-accent bg-accent/15 ring-4 ring-accent/20"
                : "border-white/[0.12] bg-[#121622]/80 hover:border-accent/60 hover:bg-[#161b28]"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.png,application/json,image/png"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-surface-2 shadow-inner transition-transform group-hover:scale-105">
              {parsing ? (
                <Loader2 size={26} className="animate-spin text-accent" />
              ) : (
                <Upload size={26} className="text-accent" />
              )}
            </div>

            <h3 className="text-sm font-bold text-zinc-100">
              {parsing ? "Анализируем файл персонажа…" : "Перетащите файл персонажа сюда"}
            </h3>
            <p className="mt-1 text-xs text-content-secondary">
              или нажмите для выбора файла на устройстве
            </p>

            <span className="mt-4 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-muted group-hover:text-content">
              Полные архивы NOCTURNE, карточки Character Card (.json) и PNG с карточкой
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Карточка предпросмотра персонажа */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-4 shadow-lg backdrop-blur-xl">
              <div className="flex items-start gap-3.5">
                <Avatar
                  src={preview.character.avatarUrl}
                  name={preview.character.name}
                  size={58}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-bold text-zinc-100">
                      {preview.character.name}
                    </h3>
                    {preview.character.genre && (
                      <Badge size="sm">{preview.character.genre}</Badge>
                    )}
                  </div>
                  {preview.character.tagline && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-accent">
                      {preview.character.tagline}
                    </p>
                  )}
                  {preview.character.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-content-secondary">
                      {preview.character.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Бейджи контента архива */}
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-4">
                <div className="flex items-center gap-1.5 rounded-xl bg-surface-2/70 px-2.5 py-1.5 text-xs">
                  <MessagesSquare size={14} className="text-accent shrink-0" />
                  <span className="text-content-secondary tabular-nums">
                    {preview.stats.sessionsCount} веток
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-xl bg-surface-2/70 px-2.5 py-1.5 text-xs">
                  <BookOpen size={14} className="text-info shrink-0" />
                  <span className="text-content-secondary tabular-nums">
                    {preview.stats.loreCount} знаний
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-xl bg-surface-2/70 px-2.5 py-1.5 text-xs">
                  <BrainCircuit size={14} className="text-success shrink-0" />
                  <span className="text-content-secondary tabular-nums">
                    {preview.stats.factsCount} фактов
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-xl bg-surface-2/70 px-2.5 py-1.5 text-xs">
                  <NotebookPen size={14} className="text-[var(--relationship-affection)] shrink-0" />
                  <span className="text-content-secondary tabular-nums">
                    {preview.stats.diaryCount} записей
                  </span>
                </div>
              </div>

              {preview.cardInfo && (
                <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge size="sm">{preview.cardInfo.label}</Badge>
                    {preview.cardInfo.creator && (
                      <span className="text-[11px] text-content-muted">
                        автор: {preview.cardInfo.creator}
                      </span>
                    )}
                    {preview.cardInfo.alternateGreetings > 0 && (
                      <span className="text-[11px] text-content-muted">
                        +{preview.cardInfo.alternateGreetings} варианта первого сообщения
                      </span>
                    )}
                  </div>

                  {preview.cardInfo.clean && (
                    <div className="rounded-xl border border-accent/20 bg-accent/[0.06] px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                        Текст карточки очищен
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {describeClean(preview.cardInfo.clean).map((line) => (
                          <li key={line} className="text-[11px] text-content-secondary">
                            • {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {preview.cardInfo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {preview.cardInfo.tags.slice(0, 8).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-lg border border-white/[0.07] bg-surface-2/70 px-2 py-0.5 text-[11px] text-content-secondary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Опции импорта */}
            <div className="space-y-3.5 rounded-2xl border border-white/[0.07] bg-surface-2/50 p-4">
              {preview.cardInfo && (
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-surface-2 p-3">
                  <div className="min-w-0 pr-3">
                    <p className="text-xs font-bold text-zinc-100">
                      Очищать текст карточки
                    </p>
                    <p className="mt-0.5 text-[11px] text-content-muted">
                      Убрать HTML, changelog и ссылки, а лист персонажа разложить по полям
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleClean}
                    aria-label="Очищать текст карточки"
                    className={cn(
                      "flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors p-0.5",
                      cleanText
                        ? "border-accent bg-accent justify-end"
                        : "border-white/[0.1] bg-surface-3 justify-start"
                    )}
                  >
                    <span className="h-4.5 w-4.5 rounded-full bg-white shadow-sm" />
                  </button>
                </div>
              )}

              <div>
                <label
                  htmlFor={nameInputId}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-content-secondary"
                >
                  Имя персонажа при импорте
                </label>
                <input
                  id={nameInputId}
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Имя персонажа..."
                  className="input-field text-xs font-semibold"
                />
              </div>

              {preview.sessions.length > 0 && (
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-surface-2 p-3">
                  <div>
                    <p className="text-xs font-bold text-zinc-100">
                      Импортировать историю общения ({preview.stats.sessionsCount} веток)
                    </p>
                    <p className="mt-0.5 text-[11px] text-content-muted">
                      Сохранить все сообщения, дневники и накопленную память
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIncludeChats((prev) => !prev)}
                    className={cn(
                      "flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors p-0.5",
                      includeChats
                        ? "border-accent bg-accent justify-end"
                        : "border-white/[0.1] bg-surface-3 justify-start"
                    )}
                  >
                    <span className="h-4.5 w-4.5 rounded-full bg-white shadow-sm" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-content-muted hover:text-content"
              >
                <RotateCcw size={13} />
                <span>Выбрать другой файл</span>
              </button>

              <span className="text-[11px] text-content-muted">
                {preview.cardInfo
                  ? `${preview.cardInfo.label}${preview.cardInfo.fromPng ? " из PNG" : ""}`
                  : preview.isFullArchive
                    ? "Полный архив экосистемы"
                    : "Одиночная карточка"}
              </span>
            </div>
          </div>

        ))}

            {preview?.card && (
              <div className="space-y-3 rounded-2xl border border-white/[0.07] bg-surface-2/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-100">Доработать моделью</p>
                    <p className="mt-0.5 text-[11px] text-content-muted">
                      {apiConfig
                        ? `Запросы идут только по кнопке · ${apiConfig.model || "модель не выбрана"}`
                        : "Подключите модель в настройках системы"}
                    </p>
                  </div>

                  {aiBusy && (
                    <button
                      type="button"
                      onClick={handleCancelAi}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-2.5 py-1.5 text-[11px] font-semibold text-content-secondary hover:text-content"
                    >
                      <X size={13} />
                      <span>Отмена</span>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={aiBusy}
                    onClick={handleTranslate}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-[11px] font-semibold text-content transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
                  >
                    <Languages size={14} />
                    <span>Перевести на русский</span>
                  </button>

                  <button
                    type="button"
                    disabled={aiBusy}
                    onClick={handleFix}
                    title="Почистить мусор, расставить перепутанные поля, заполнить пустые места и проверить результат"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[11px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
                  >
                    <Wand2 size={14} />
                    <span>Привести в порядок</span>
                  </button>

                  {preview.card && shouldCompressCard(preview.card) && (
                    <button
                      type="button"
                      disabled={aiBusy}
                      onClick={handleCompress}
                      title="Карточка очень большая: модель сожмёт самые длинные поля, сохранив факты"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] font-semibold text-warning transition-colors hover:bg-warning/20 disabled:opacity-40"
                    >
                      <Scissors size={14} />
                      <span>Сжать раздутые поля</span>
                    </button>
                  )}
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setFineTuneOpen((prev) => !prev)}
                    aria-expanded={fineTuneOpen}
                    className="flex items-center gap-1 text-[11px] font-semibold text-content-muted hover:text-content"
                  >
                    {fineTuneOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    <span>Отдельные действия</span>
                  </button>

                  {fineTuneOpen && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={aiBusy}
                        onClick={handlePolish}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-[11px] font-semibold text-content transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
                      >
                        <Wand2 size={14} />
                        <span>Только очистить</span>
                      </button>

                      <button
                        type="button"
                        disabled={aiBusy}
                        onClick={handleEnrich}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-[11px] font-semibold text-content transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
                      >
                        <Sparkles size={14} />
                        <span>Только дополнить поля</span>
                      </button>

                      <button
                        type="button"
                        disabled={aiBusy}
                        onClick={handleAudit}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-[11px] font-semibold text-content transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
                      >
                        <ClipboardCheck size={14} />
                        <span>Проверить поля</span>
                      </button>
                    </div>
                  )}
                </div>

                {aiProgress && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2.5 rounded-xl border border-accent/25 bg-accent/[0.07] px-3 py-2 text-[11px] text-content-secondary"
                  >
                    <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
                    <span>
                      {aiProgress.stage ?? AI_STAGE_LABELS[aiProgress.mode]}…
                      {aiProgress.total > 1
                        ? ` ${aiProgress.current} из ${aiProgress.total}`
                        : ""}
                    </span>
                  </div>
                )}

                {aiNotes.length > 0 && (
                  <ul className="space-y-1">
                    {aiNotes.map((note) => (
                      <li key={note} className="text-[11px] leading-relaxed text-content-muted">
                        • {note}
                      </li>
                    ))}
                  </ul>
                )}

                {audit && (
                  <div className="space-y-2 rounded-xl border border-white/[0.07] bg-surface-2/70 p-3">
                    {audit.summary && (
                      <p className="text-[11px] leading-relaxed text-content-secondary">
                        {audit.summary}
                      </p>
                    )}

                    {audit.issues.length > 0 && (
                      <ul className="space-y-1.5">
                        {audit.issues.map((issue) => (
                          <li key={`${issue.field}-${issue.problem}`} className="text-[11px]">
                            <span className="font-semibold text-warning">{issue.field}:</span>{" "}
                            <span className="text-content-secondary">{issue.problem}</span>
                            {issue.suggestion && (
                              <span className="text-content-muted"> → {issue.suggestion}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {audit.emptyFields.length > 0 && (
                      <p className="text-[11px] text-content-muted">
                        Не заполнено: {audit.emptyFields.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/5 p-3.5 text-xs text-danger leading-relaxed"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="[overflow-wrap:anywhere]">{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 border-t border-white/[0.08] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] bg-surface-2 px-4 py-2.5 text-xs font-semibold text-content-secondary hover:bg-surface-3 hover:text-content"
          >
            Отмена
          </button>

          <button
            type="button"
            disabled={!preview || saving}
            onClick={() => void handleImportSubmit()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            <span>Импортировать персонажа</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}