import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  MessageCircle,
  RotateCcw,
  Save,
  Upload,
  Users,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { getApiConfig } from "../../db";
import { isLocalEndpoint } from "../../services/apiClient";
import {
  createTextDnaTask,
  extractTextDna,
  isTextDnaTaskCompatible,
  type TextDnaMode,
  type TextDnaPreparedGroup,
  type TextDnaPreparedSingle,
  type TextDnaResult,
  type TextDnaTask,
} from "../../services/textDna";
import { cn } from "../../utils/cn";
import {
  isTextDnaTextFile,
  readTextDnaFile,
  toggleTextDnaSourceVisibility,
} from "../../utils/textDnaFile";
import { MysteryModeToggle } from "./MysteryModeToggle";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Результат уже извлечён и готов к атомарному сохранению в родительском потоке. */
  onApply: (result: TextDnaResult, mysteryMode: boolean) => void | Promise<void>;
}

type Step = "mode" | "input" | "working" | "preview";

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/5 p-3.5 text-sm text-danger"
    >
      <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
        {message}
      </p>
    </div>
  );
}

function TextBlock({ title, value }: { title: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-surface-2/45 p-3.5">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
        {title}
      </h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-content [overflow-wrap:anywhere]">
        {value}
      </p>
    </section>
  );
}

function StatsLine({ stats }: { stats: TextDnaPreparedSingle["character"]["initialStats"] }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px] text-content-secondary">
      <span className="rounded-lg border border-white/[0.07] bg-surface-2 px-2 py-1">Доверие {stats.trust}</span>
      <span className="rounded-lg border border-white/[0.07] bg-surface-2 px-2 py-1">Привязанность {stats.affection}</span>
      <span className="rounded-lg border border-white/[0.07] bg-surface-2 px-2 py-1">Близость {stats.closeness}</span>
      <span className="rounded-lg border border-white/[0.07] bg-surface-2 px-2 py-1">Напряжение {stats.tension}</span>
      <span className="rounded-lg border border-white/[0.07] bg-surface-2 px-2 py-1">Конфликт {stats.conflict}</span>
      {stats.attraction !== undefined && (
        <span className="rounded-lg border border-white/[0.07] bg-surface-2 px-2 py-1">Влечение {stats.attraction}</span>
      )}
      {stats.statusTitle && (
        <span className="rounded-lg border border-accent/25 bg-accent/10 px-2 py-1 text-accent">
          {stats.statusTitle}
        </span>
      )}
    </div>
  );
}

function CharacterPreview({
  character,
  index,
}: {
  character: TextDnaPreparedSingle["character"];
  index?: number;
}) {
  const labels = [character.age, character.genre].filter(Boolean).join(" · ");
  return (
    <article className="space-y-3 rounded-3xl border border-white/[0.08] bg-[#121622]/75 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <span className="text-sm font-bold">{index !== undefined ? index + 1 : "✦"}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            Импортированный персонаж
          </p>
          <h3 className="mt-0.5 text-xl font-bold text-zinc-100 [overflow-wrap:anywhere]">
            {character.name}
          </h3>
          {labels && <p className="mt-1 text-xs text-content-secondary">{labels}</p>}
          {character.tagline && <p className="mt-1 text-sm text-content-secondary">{character.tagline}</p>}
        </div>
      </div>

      {(character.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(character.tags ?? []).map((tag) => (
            <span key={tag} className="rounded-full border border-white/[0.08] bg-surface-2 px-2.5 py-1 text-[11px] text-content-secondary">
              {tag}
            </span>
          ))}
        </div>
      )}

      <StatsLine stats={character.initialStats} />

      <div className="grid gap-3 sm:grid-cols-2">
        <TextBlock title="Первое впечатление" value={character.firstImpression} />
        <TextBlock title="Стартовая точка" value={character.startingPoint} />
        <TextBlock title="Цитата персонажа" value={character.summaryQuote} />
        <TextBlock title="Внешность и описание" value={character.description} />
        <TextBlock title="Личность и поведение" value={character.personality} />
        <TextBlock title="Предыстория и сценарий" value={character.scenario} />
        <TextBlock title="Системные инструкции" value={character.systemPrompt} />
      </div>

      <TextBlock title="Первое сообщение" value={character.firstMessage} />

      {character.alternateGreetings && character.alternateGreetings.length > 0 && (
        <section className="rounded-2xl border border-accent/20 bg-accent/5 p-3.5">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
            Альтернативные приветствия · свайпы
          </h4>
          <div className="space-y-2">
            {character.alternateGreetings.map((greeting, greetingIndex) => (
              <p key={`${greetingIndex}-${greeting.slice(0, 20)}`} className="whitespace-pre-wrap text-sm leading-relaxed text-content [overflow-wrap:anywhere]">
                {greeting}
              </p>
            ))}
          </div>
        </section>
      )}

      {character.lorebook.length > 0 && (
        <section className="rounded-2xl border border-white/[0.07] bg-surface-2/35 p-3.5">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
            Лорбук · {character.lorebook.length}
          </h4>
          <div className="space-y-3">
            {character.lorebook.map((entry, entryIndex) => (
              <div key={`${entryIndex}-${entry.content.slice(0, 20)}`}>
                {entry.keys.length > 0 && (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {entry.keys.map((key) => (
                      <span key={key} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] text-content-muted">
                        {key}
                      </span>
                    ))}
                  </div>
                )}
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                  {entry.content}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

function SinglePreview({ prepared }: { prepared: TextDnaPreparedSingle }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-accent/25 bg-accent/5 p-3.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Готово к созданию одиночной сцены</p>
        <p className="mt-1 text-sm leading-relaxed text-content-secondary">
          Ниже показаны именно поля карточки и сессии, которые будут сохранены. Ничего не записано до подтверждения.
        </p>
      </div>
      <CharacterPreview character={prepared.character} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextBlock title="Название новой сессии" value={prepared.title} />
        <TextBlock title="Синопсис сессии" value={prepared.summary} />
        <div className="sm:col-span-2">
          <TextBlock title="Правила и дополнительные сведения сессии" value={prepared.directorNotes} />
        </div>
      </div>
    </div>
  );
}

function GroupPreview({ prepared }: { prepared: TextDnaPreparedGroup }) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-accent/25 bg-accent/5 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Общая сцена</p>
        <h3 className="mt-1 text-xl font-bold text-zinc-100 [overflow-wrap:anywhere]">
          {prepared.title || "Импортированная сцена"}
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
          {prepared.summary || "Общие обстоятельства не были выделены отдельно."}
        </p>
      </section>

      <section className="rounded-2xl border border-accent/25 bg-accent/5 p-4">
        <div className="mb-2 flex items-center gap-2">
          <MessageCircle size={15} className="text-accent" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-accent">Общий опенинг</h4>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-content [overflow-wrap:anywhere]">
          {prepared.opening || "В исходнике общий опенинг не найден."}
        </p>
      </section>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Users size={16} className="text-accent" />
          <h4 className="text-sm font-semibold text-content">Основные участники · {prepared.characters.length}</h4>
        </div>
        <div className="space-y-3">
          {prepared.characters.map((character, index) => (
            <CharacterPreview key={character.id} character={character} index={index} />
          ))}
        </div>
      </div>

      {prepared.relations.length > 0 && (
        <section className="rounded-2xl border border-white/[0.08] bg-surface-2/35 p-4">
          <h4 className="mb-3 text-sm font-semibold text-content">Отношения участников</h4>
          <div className="space-y-2">
            {prepared.relations.map((relation) => (
              <div key={relation.id} className="rounded-xl border border-white/[0.07] bg-[#0f131d]/70 p-3">
                <p className="text-xs font-semibold text-accent">
                  {prepared.characters.find((item) => item.id === relation.from)?.name ?? "Участник"}
                  <span className="px-1 text-content-muted">→</span>
                  {prepared.characters.find((item) => item.id === relation.to)?.name ?? "Участник"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                  {relation.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <TextBlock title="Общие правила и дополнительные сведения сцены" value={prepared.directorNotes} />
    </div>
  );
}

function ModeCard({
  mode,
  selected,
  title,
  description,
  onClick,
}: {
  mode: TextDnaMode;
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-36 min-w-0 flex-col items-start rounded-2xl border p-4 text-left transition-all",
        selected
          ? "border-accent/60 bg-accent/10 shadow-[0_0_20px_rgba(139,92,246,0.12)]"
          : "border-white/[0.08] bg-surface-2/55 hover:border-accent/35 hover:bg-surface-3"
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", selected ? "bg-accent/20 text-accent" : "bg-surface-3 text-content-secondary")}>
          {mode === "single" ? <FileText size={19} /> : <Users size={19} />}
        </span>
        {selected && <Check size={18} className="text-accent" aria-hidden="true" />}
      </div>
      <span className={cn("mt-4 text-sm font-semibold", selected ? "text-accent" : "text-content")}>{title}</span>
      <span className="mt-1 text-xs leading-relaxed text-content-secondary">{description}</span>
    </button>
  );
}

export function TextDnaModal({ open, onClose, onApply }: Props) {
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<TextDnaMode>("single");
  const [source, setSource] = useState("");
  const [sourceVisible, setSourceVisible] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [mysteryMode, setMysteryMode] = useState(false);
  const [result, setResult] = useState<TextDnaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workingLabel, setWorkingLabel] = useState("Отправляем полный исходник одним запросом…");
  const [applying, setApplying] = useState(false);
  const operationRef = useRef(false);
  const tokenRef = useRef(0);
  const fileReadTokenRef = useRef(0);
  const wasOpenRef = useRef(false);
  const taskRef = useRef<TextDnaTask | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sourceId = useId();

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setStep("mode");
      setMode("single");
      setSource("");
      setSourceVisible(true);
      setIsDragging(false);
      setFileName(null);
      setFileNotice(null);
      setMysteryMode(false);
      setResult(null);
      setError(null);
      setApplying(false);
      taskRef.current = null;
      fileReadTokenRef.current += 1;
      operationRef.current = false;
    }
    wasOpenRef.current = open;
  }, [open]);

  const handleClose = () => {
    tokenRef.current += 1;
    fileReadTokenRef.current += 1;
    operationRef.current = false;
    taskRef.current = null;
    setIsDragging(false);
    setApplying(false);
    onClose();
  };

  const resetTask = () => {
    taskRef.current = null;
    setResult(null);
    setError(null);
  };

  const handleSourceChange = (nextSource: string) => {
    setSource(nextSource);
    setFileName(null);
    setFileNotice(null);
    resetTask();
  };

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (!isTextDnaTextFile(file)) {
      setError("Выберите обычный текстовый файл с расширением .txt. Другие форматы не импортируются.");
      setFileNotice(null);
      return;
    }

    const readToken = ++fileReadTokenRef.current;
    setError(null);
    setFileNotice(null);
    try {
      const text = await readTextDnaFile(file);
      if (readToken !== fileReadTokenRef.current) return;
      if (!text.trim()) {
        setError("TXT-файл пуст. Текущий исходный текст не изменён.");
        return;
      }
      const replacesExisting = source.trim().length > 0;
      setSource(text);
      setFileName(file.name);
      setFileNotice(
        replacesExisting
          ? `Текущий текст заменён содержимым «${file.name}».`
          : `Загружен файл «${file.name}».`
      );
      resetTask();
    } catch (cause) {
      if (readToken !== fileReadTokenRef.current) return;
      setError(cause instanceof Error ? cause.message : "Не удалось прочитать TXT-файл.");
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      setError("Перетащите один .txt-файл за раз. Текущий текст не изменён.");
      return;
    }
    void handleFile(files[0]);
  };

  const handleGenerate = async () => {
    if (operationRef.current || !source.trim()) return;
    operationRef.current = true;
    const token = ++tokenRef.current;
    const task = isTextDnaTaskCompatible(taskRef.current, source, mode)
      ? taskRef.current
      : createTextDnaTask(source, mode);
    taskRef.current = task;
    setError(null);
    setStep("working");
    setWorkingLabel(
      task.payload
        ? "Показываем уже проверенный результат…"
        : "Отправляем полный исходник одним запросом…"
    );

    try {
      const apiConfig = await getApiConfig();
      if (!apiConfig || (!apiConfig.apiKey && !isLocalEndpoint(apiConfig.baseUrl))) {
        throw new Error("Не указан API-ключ в Настройках приложения.");
      }

      const extracted = await extractTextDna(apiConfig, source, mode, { task });
      if (token !== tokenRef.current) return;

      if (mysteryMode) {
        setApplying(true);
        await onApply(extracted, true);
        if (token === tokenRef.current) onClose();
      } else {
        setResult(extracted);
        setStep("preview");
      }
    } catch (cause) {
      if (token !== tokenRef.current) return;
      setError(cause instanceof Error ? cause.message : "Не удалось обработать исходный текст.");
      setStep("input");
      setResult(null);
    } finally {
      if (token === tokenRef.current) {
        operationRef.current = false;
        setApplying(false);
      }
    }
  };

  const handleApplyPreview = async () => {
    if (!result || operationRef.current) return;
    operationRef.current = true;
    setApplying(true);
    setError(null);
    try {
      await onApply(result, false);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить импортированный результат.");
    } finally {
      operationRef.current = false;
      setApplying(false);
    }
  };

  const goToInput = () => {
    if (operationRef.current) return;
    setResult(null);
    setError(null);
    setStep("input");
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      variant="sheet"
      size="lg"
      title="Создать из промпта · Text DNA"
    >
      {step === "mode" && (
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <FileText size={21} strokeWidth={1.7} />
            </div>
            <p className="min-w-0 text-sm leading-relaxed text-content-secondary sm:text-base">
              Вставьте готовый материал другой LLM. Text DNA не придумывает героя по пресетам, а переносит факты, правила, связи, секреты и исходные сообщения в формат NOCTURNE.
            </p>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-content-secondary">Что создаём?</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeCard
                mode="single"
                selected={mode === "single"}
                title="Одиночный персонаж"
                description="Одна полноценная карточка и новая личная сцена."
                onClick={() => {
                  if (mode !== "single") resetTask();
                  setMode("single");
                }}
              />
              <ModeCard
                mode="group"
                selected={mode === "group"}
                title="Групповая сцена"
                description="Основной состав 2–4 участников, общая сцена и отношения."
                onClick={() => {
                  if (mode !== "group") resetTask();
                  setMode("group");
                }}
              />
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.07] pt-4">
            <button type="button" onClick={handleClose} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium text-content-muted hover:bg-surface-2 hover:text-content">
              Закрыть
            </button>
            <button type="button" onClick={() => { setError(null); setStep("input"); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover">
              Продолжить
              <ArrowLeft size={16} className="rotate-180" />
            </button>
          </div>
        </div>
      )}

      {step === "input" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                {mode === "single" ? "Одиночный персонаж" : "Групповая сцена"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-content-secondary">
                Вставьте текст как есть: карточку, системный промпт, сценарий, диалоги или их комбинацию.
              </p>
            </div>
            <button type="button" onClick={() => { setError(null); setStep("mode"); }} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-xs font-medium text-content-secondary hover:bg-surface-3 hover:text-content">
              <ArrowLeft size={14} /> Режим
            </button>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "rounded-2xl border p-3 transition-colors sm:p-4",
              isDragging
                ? "border-accent bg-accent/10"
                : "border-white/[0.08] bg-surface-2/25"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={sourceId} className="text-sm font-medium text-content-secondary">
                Исходный материал
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    void handleFile(file);
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-xs font-medium text-content-secondary hover:bg-surface-3 hover:text-content"
                >
                  <Upload size={14} />
                  Выбрать .txt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = toggleTextDnaSourceVisibility({ source, visible: sourceVisible });
                    setSource(next.source);
                    setSourceVisible(next.visible);
                    setError(null);
                  }}
                  aria-pressed={sourceVisible}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-xs font-medium text-content-secondary hover:bg-surface-3 hover:text-content"
                >
                  {sourceVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  {sourceVisible ? "Скрыть текст" : "Показать текст"}
                </button>
              </div>
            </div>

            <div className="relative mt-3">
              <textarea
                id={sourceId}
                value={source}
                onChange={(event) => handleSourceChange(event.target.value)}
                placeholder="Вставьте сюда полный текст внешней LLM…"
                spellCheck={false}
                aria-label={sourceVisible ? "Исходный материал" : "Скрытый исходный материал"}
                className={cn(
                  "min-h-[40vh] w-full resize-y rounded-2xl border border-white/[0.09] bg-[#0d1119] p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-content-muted focus:border-accent/60 focus:ring-1 focus:ring-accent/30 [overflow-wrap:anywhere]",
                  sourceVisible
                    ? "text-content"
                    : "text-transparent caret-accent selection:bg-accent/30 selection:text-transparent placeholder:text-transparent"
                )}
              />
              {!sourceVisible && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border border-dashed border-white/[0.09] p-6 text-center">
                  <p className="max-w-md text-sm leading-relaxed text-content-muted">
                    Исходник скрыт визуально, но сохранён без изменений: {source.length.toLocaleString("ru-RU")} символов.
                    Вставка, редактирование, загрузка файла и запуск доступны в этом состоянии.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-content-muted">
              <span>
                {source.length.toLocaleString("ru-RU")} символов · переносы строк сохраняются
                {fileName ? ` · ${fileName}` : ""}
              </span>
              <span>Перетащите сюда один .txt или выберите файл · текст не обрезается</span>
            </div>
            {fileNotice && <p className="mt-2 text-xs text-success">{fileNotice}</p>}
          </div>

          <MysteryModeToggle enabled={mysteryMode} onChange={setMysteryMode} />

          {error && <ErrorBanner message={error} />}

          <div className="flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
            <button type="button" onClick={() => { setError(null); setStep("mode"); }} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-3 hover:text-content sm:flex-none sm:px-4">
              <ArrowLeft size={16} /> Назад
            </button>
            <button type="button" onClick={() => void handleGenerate()} disabled={!source.trim() || operationRef.current} className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:flex-[2]">
              <FileText size={17} />
              <span>Извлечь и подготовить</span>
            </button>
          </div>
        </div>
      )}

      {step === "working" && (
        <div className="flex min-h-[46vh] flex-col items-center justify-center gap-4 py-12 text-center">
          <Loader2 size={35} className="animate-spin text-accent" aria-hidden="true" />
          <p className="text-base font-semibold text-zinc-100">{workingLabel}</p>
          <p className="max-w-lg text-sm leading-relaxed text-content-secondary">
            Полный исходный текст отправляется одним structured-JSON запросом. Промежуточные фрагменты и частичные данные не сохраняются; при технической ошибке повтор проверяет только ответ модели.
          </p>
          <p className="text-xs text-content-muted">{source.length.toLocaleString("ru-RU")} символов · частичные данные не сохраняются</p>
        </div>
      )}

      {step === "preview" && result && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">Предпросмотр импорта</p>
              <h3 className="mt-1 text-xl font-bold text-zinc-100">Данные извлечены без сохранения</h3>
              <p className="mt-1 text-xs text-content-muted">
                {result.sourceLength.toLocaleString("ru-RU")} символов · полный источник
                {result.corrected ? " · ответ модели исправлен техническим повтором" : ""}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
              <Check size={13} /> Проверено
            </span>
          </div>

          {result.prepared.mode === "single" ? (
            <SinglePreview prepared={result.prepared} />
          ) : (
            <GroupPreview prepared={result.prepared} />
          )}

          {error && <ErrorBanner message={error} />}

          <div className="space-y-3 border-t border-white/[0.07] pt-5">
            <button type="button" onClick={() => void handleApplyPreview()} disabled={applying} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">
              {applying ? <Loader2 size={19} className="animate-spin" /> : <Save size={19} />}
              {applying ? "Создаём персонажей и чат…" : "Создать персонажей и открыть чат"}
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={goToInput} disabled={applying} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-3 hover:text-content disabled:opacity-50">
                <ArrowLeft size={16} /> К исходному тексту
              </button>
              <button type="button" onClick={goToInput} disabled={applying} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-content-muted hover:bg-surface-2 hover:text-content disabled:opacity-50">
                <RotateCcw size={16} /> Обработать снова
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
