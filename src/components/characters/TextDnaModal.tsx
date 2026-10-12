import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  LockKeyhole,
  MessageCircle,
  RotateCcw,
  Save,
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
  const [mysteryMode, setMysteryMode] = useState(false);
  const [result, setResult] = useState<TextDnaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workingLabel, setWorkingLabel] = useState("Составляем карту исходного материала…");
  const [applying, setApplying] = useState(false);
  const operationRef = useRef(false);
  const tokenRef = useRef(0);
  const wasOpenRef = useRef(false);
  const taskRef = useRef<TextDnaTask | null>(null);
  const sourceId = useId();

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setStep("mode");
      setMode("single");
      setSource("");
      setMysteryMode(false);
      setResult(null);
      setError(null);
      setApplying(false);
      taskRef.current = null;
      operationRef.current = false;
    }
    wasOpenRef.current = open;
  }, [open]);

  const handleClose = () => {
    tokenRef.current += 1;
    operationRef.current = false;
    taskRef.current = null;
    setApplying(false);
    onClose();
  };

  const resetTask = () => {
    taskRef.current = null;
    setResult(null);
    setError(null);
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
      task.evidence.length > 0 || task.index || Object.keys(task.cards).length > 0
        ? "Продолжаем только незавершённый этап…"
        : source.length > 10_000
        ? "Размечаем длинный исходник и сохраняем связи между секциями…"
        : "Извлекаем персонажа и авторские правила…"
    );

    try {
      const apiConfig = await getApiConfig();
      if (!apiConfig || (!apiConfig.apiKey && !isLocalEndpoint(apiConfig.baseUrl))) {
        throw new Error("Не указан API-ключ в Настройках приложения.");
      }

      const extracted = await extractTextDna(apiConfig, source, mode, { task });
      if (token !== tokenRef.current) return;

      setResult(extracted);
      if (mysteryMode) {
        setApplying(true);
        await onApply(extracted, true);
        if (token === tokenRef.current) onClose();
      } else {
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

          <div>
            <label htmlFor={sourceId} className="mb-2 block text-sm font-medium text-content-secondary">
              Исходный материал
            </label>
            <textarea
              id={sourceId}
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                taskRef.current = null;
                setResult(null);
                setError(null);
              }}
              placeholder="Вставьте сюда полный текст внешней LLM…"
              spellCheck={false}
              className="min-h-[44vh] w-full resize-y rounded-2xl border border-white/[0.09] bg-[#0d1119] p-4 text-sm leading-relaxed text-content outline-none transition-colors placeholder:text-content-muted focus:border-accent/60 focus:ring-1 focus:ring-accent/30 [overflow-wrap:anywhere]"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-content-muted">
              <span>{source.length.toLocaleString("ru-RU")} символов · переносы строк сохраняются</span>
              <span>Текст не обрезается автоматически</span>
            </div>
          </div>

          <div className="rounded-2xl border border-accent/25 bg-accent/5 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <LockKeyhole size={18} className="mt-0.5 shrink-0 text-accent" />
                <div>
                  <p className="text-sm font-semibold text-content">Режим тайны</p>
                  <p className="mt-1 max-w-xl text-xs leading-relaxed text-content-secondary">
                    {mysteryMode
                      ? "Включён: после обработки карточки сохранятся, и чат откроется сразу без подробного предпросмотра."
                      : "Выключен: сначала покажем полный предпросмотр, а сохранение произойдёт только после подтверждения."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mysteryMode}
                onClick={() => setMysteryMode((value) => !value)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                  mysteryMode
                    ? "border-accent/50 bg-accent/15 text-accent"
                    : "border-white/[0.1] bg-surface-2 text-content-secondary hover:bg-surface-3"
                )}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", mysteryMode ? "bg-accent" : "bg-content-muted")} />
                {mysteryMode ? "Включён" : "Выключен"}
              </button>
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
            <button type="button" onClick={() => { setError(null); setStep("mode"); }} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-3 hover:text-content sm:flex-none sm:px-4">
              <ArrowLeft size={16} /> Назад
            </button>
            <button type="button" onClick={() => void handleGenerate()} disabled={!source.trim() || operationRef.current} className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:flex-[2]">
              <FileText size={17} />
              <span>
                {taskRef.current &&
                (taskRef.current.evidence.length > 0 ||
                  taskRef.current.index ||
                  Object.keys(taskRef.current.cards).length > 0)
                  ? "Продолжить обработку"
                  : "Извлечь и подготовить"}
              </span>
            </button>
          </div>
        </div>
      )}

      {step === "working" && (
        <div className="flex min-h-[46vh] flex-col items-center justify-center gap-4 py-12 text-center">
          <Loader2 size={35} className="animate-spin text-accent" aria-hidden="true" />
          <p className="text-base font-semibold text-zinc-100">{workingLabel}</p>
          <p className="max-w-lg text-sm leading-relaxed text-content-secondary">
            Исходный текст остаётся в поле ввода. При большом объёме сервис сначала строит карту имён, фактов, отношений и секций, затем сводит её в типизированные данные.
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
                {result.sourceLength.toLocaleString("ru-RU")} символов · {result.sourceSections.length} секц.
                {result.corrected ? " · ответ модели исправлен повторным запросом" : ""}
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
