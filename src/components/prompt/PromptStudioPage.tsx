import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Check,
  Copy,
  Eraser,
  Loader2,
  MessageSquareQuote,
  Sparkles,
  Wand2,
  AlertCircle,
  RectangleHorizontal,
  RectangleVertical,
  Square,
} from "lucide-react";
import { db, getApiConfig } from "../../db";
import { requestImagePrompt } from "../../services/apiClient";
import {
  ASPECTS,
  CAMERAS,
  DEFAULT_STUDIO_SETTINGS,
  DETAILS,
  EXTRAS,
  FRAMES,
  LIGHTINGS,
  MOODS,
  STYLES,
  buildRefineRequest,
  cleanPromptText,
  composeImagePrompt,
  composeShortPrompt,
  type ComposeInput,
  type PromptStudioSettings,
} from "../../services/promptStudio";
import { Avatar } from "../common/Avatar";
import { cn } from "../../utils/cn";
import { copyTextToClipboard } from "../../utils/clipboard";
import type { Character, ChatSession, Message } from "../../types";

const STORAGE_KEY = "nocturne_prompt_studio_v1";

const ASPECT_ICONS: Record<string, typeof Square> = {
  "1:1": Square,
  "3:4": RectangleVertical,
  "2:3": RectangleVertical,
  "16:9": RectangleHorizontal,
  "9:16": RectangleVertical,
};

type ContextMode = "last" | "custom" | "none";

interface StoredState {
  settings: PromptStudioSettings;
  contextMode: ContextMode;
  notes: string;
}

function loadStored(): Partial<StoredState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<StoredState>) : {};
  } catch {
    return {};
  }
}

interface SegmentedProps<T extends string> {
  legend: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: string;
}

function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = "grid-cols-2 sm:grid-cols-3",
}: SegmentedProps<T>) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
        {legend}
      </legend>
      <div className={cn("grid gap-2", columns)}>
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.id)}
              className={cn(
                "min-h-10 rounded-xl border px-2.5 py-2 text-xs font-medium transition-colors duration-150",
                active
                  ? "border-accent/50 bg-accent/12 text-accent"
                  : "border-white/[0.07] bg-surface-2 text-content-secondary hover:bg-surface-3 hover:text-content"
              )}
            >
              <span className="block truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PromptStudioPage() {
  const stored = useMemo(loadStored, []);
  const id = useId();

  const [characterId, setCharacterId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<ContextMode>(
    stored.contextMode ?? "last"
  );
  const [sceneText, setSceneText] = useState("");
  const [notes, setNotes] = useState(stored.notes ?? "");
  const [settings, setSettings] = useState<PromptStudioSettings>({
    ...DEFAULT_STUDIO_SETTINGS,
    ...(stored.settings ?? {}),
  });

  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState<"prompt" | "short" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);

  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const characters = useLiveQuery<Character[]>(
    () => db.characters.orderBy("createdAt").toArray(),
    []
  );

  const sessions = useLiveQuery<ChatSession[]>(
    () =>
      characterId
        ? db.sessions
            .where("characterId")
            .equals(characterId)
            .sortBy("updatedAt")
            .then((items) => items.reverse())
        : Promise.resolve([]),
    [characterId]
  );

  const lastMessages = useLiveQuery<Message[]>(
    () =>
      sessionId
        ? db.messages.where("sessionId").equals(sessionId).toArray()
        : Promise.resolve([]),
    [sessionId]
  );

  const character: Character | undefined = useMemo(
    () => characters?.find((item) => item.id === characterId),
    [characters, characterId]
  );

  const lastMessageText = useMemo(() => {
    if (!lastMessages?.length) return "";
    const sorted = [...lastMessages].sort((a, b) => a.timestamp - b.timestamp);
    const last = sorted[sorted.length - 1];
    return cleanPromptText(last.swipes[last.currentSwipeIndex] ?? last.swipes[0] ?? "");
  }, [lastMessages]);

  // Первый персонаж подставляется автоматически, чтобы студия была не пустой.
  useEffect(() => {
    if (!characterId && characters && characters.length > 0) {
      setCharacterId(characters[0].id);
    }
  }, [characters, characterId]);

  useEffect(() => {
    if (!sessions) return;
    setSessionId((current) =>
      current && sessions.some((session) => session.id === current)
        ? current
        : (sessions[0]?.id ?? null)
    );
  }, [sessions]);

  useEffect(() => {
    if (contextMode === "last" && lastMessageText) {
      setSceneText(lastMessageText);
    }
  }, [contextMode, lastMessageText]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const payload: StoredState = { settings, contextMode, notes };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // приватный режим браузера — просто не сохраняем черновик
    }
  }, [settings, contextMode, notes]);

  const composeInput: ComposeInput = useMemo(() => {
    const appearance = character
      ? [character.description, character.personality].filter(Boolean).join(". ")
      : "";

    return {
      characterName: character?.name ?? "",
      appearance,
      scene: contextMode === "none" ? "" : sceneText,
      notes,
      settings,
    };
  }, [character, contextMode, sceneText, notes, settings]);

  const preview = useMemo(() => composeImagePrompt(composeInput), [composeInput]);
  const shortPreview = useMemo(() => composeShortPrompt(composeInput), [composeInput]);

  const handleCompose = () => {
    setError(null);
    setPrompt(preview);
  };

  const handleRefine = async () => {
    if (!character) {
      setError("Сначала выберите персонажа.");
      return;
    }

    setRefining(true);
    setError(null);

    try {
      const apiConfig = await getApiConfig();
      const refined = await requestImagePrompt(
        apiConfig,
        character,
        buildRefineRequest(composeInput),
        settings.frame === "scene" ? "wallpaper" : "avatar"
      );
      if (mountedRef.current) setPrompt(refined.trim());
    } catch (cause) {
      if (mountedRef.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось обратиться к модели. Промпт можно собрать и без неё."
        );
      }
    } finally {
      if (mountedRef.current) setRefining(false);
    }
  };

  const handleCopy = async (text: string, which: "prompt" | "short") => {
    if (!text.trim()) return;
    try {
      await copyTextToClipboard(text);
      if (!mountedRef.current) return;
      setCopied(which);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopied(null);
      }, 2000);
    } catch {
      if (mountedRef.current) {
        setError("Не удалось скопировать — выделите текст и скопируйте вручную.");
      }
    }
  };

  const toggleExtra = (extraId: string) => {
    setSettings((current) => ({
      ...current,
      extras: current.extras.includes(extraId)
        ? current.extras.filter((item) => item !== extraId)
        : [...current.extras, extraId],
    }));
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent"
          >
            <Wand2 size={21} strokeWidth={1.7} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-content">Промпт-студия</h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-content-secondary">
              Собирает английскую подсказку для моделей генерации изображений:
              внешность персонажа, контекст сцены и точные настройки кадра.
              Промпт собирается мгновенно и вручную — модель нужна только для
              «Улучшить».
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        {/* ── Настройки ───────────────────────────────────────── */}
        <div className="space-y-5">
          <section className="rounded-3xl border border-white/[0.07] bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-content">Персонаж</h2>

            {characters === undefined ? (
              <p className="text-xs text-content-muted">Загрузка…</p>
            ) : characters.length === 0 ? (
              <p className="text-xs leading-relaxed text-content-secondary">
                Пока нет персонажей. Создайте первого в разделе «Персонажи» —
                студия подхватит его автоматически.
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {characters.map((item) => {
                  const active = item.id === characterId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCharacterId(item.id)}
                      className={cn(
                        "flex w-[92px] shrink-0 flex-col items-center gap-2 rounded-2xl border px-2 py-3 transition-colors duration-150",
                        active
                          ? "border-accent/50 bg-accent/10"
                          : "border-white/[0.07] bg-surface-2 hover:bg-surface-3"
                      )}
                    >
                      <Avatar src={item.avatarUrl} name={item.name} size={44} />
                      <span
                        className={cn(
                          "w-full truncate text-center text-[11px] font-medium",
                          active ? "text-accent" : "text-content-secondary"
                        )}
                      >
                        {item.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-white/[0.07] bg-surface p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-content">Контекст сцены</h2>
              <div className="flex gap-1.5">
                {(
                  [
                    { id: "last", label: "Из чата" },
                    { id: "custom", label: "Своё" },
                    { id: "none", label: "Без сцены" },
                  ] as { id: ContextMode; label: string }[]
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={contextMode === option.id}
                    onClick={() => setContextMode(option.id)}
                    className={cn(
                      "min-h-9 rounded-xl border px-2.5 text-xs font-medium transition-colors duration-150",
                      contextMode === option.id
                        ? "border-accent/50 bg-accent/12 text-accent"
                        : "border-white/[0.07] bg-surface-2 text-content-secondary hover:bg-surface-3"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {contextMode === "last" && (
              <div className="mb-3">
                {sessions && sessions.length > 0 ? (
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                      Ветка диалога
                    </span>
                    <select
                      value={sessionId ?? ""}
                      onChange={(event) => setSessionId(event.target.value || null)}
                      className="input-field"
                    >
                      {sessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.title || "Без названия"}
                          {session.summary ? " · есть синопсис" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-xs text-content-muted">
                    У этого персонажа ещё нет веток диалога — напишите первую сцену
                    или переключитесь на «Своё».
                  </p>
                )}
              </div>
            )}

            {contextMode !== "none" && (
              <>
                <label htmlFor={`${id}-scene`} className="sr-only">
                  Описание сцены
                </label>
                <textarea
                  id={`${id}-scene`}
                  rows={5}
                  value={sceneText}
                  onChange={(event) => setSceneText(event.target.value)}
                  placeholder="Что происходит в кадре: место, действие, детали обстановки."
                  className="input-field resize-y"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={!lastMessageText}
                    onClick={() => setSceneText(lastMessageText)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-2.5 text-xs font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content disabled:opacity-40"
                  >
                    <MessageSquareQuote size={14} />
                    Подставить последнее сообщение
                  </button>
                  <span className="text-[11px] tabular-nums text-content-muted">
                    {sceneText.length.toLocaleString("ru-RU")} симв.
                  </span>
                </div>
              </>
            )}
          </section>

          <section className="space-y-4 rounded-3xl border border-white/[0.07] bg-surface p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-content">Кадр и стиль</h2>

            <Segmented
              legend="Тип кадра"
              options={FRAMES}
              value={settings.frame}
              onChange={(frame) => setSettings((c) => ({ ...c, frame }))}
              columns="grid-cols-2 sm:grid-cols-4"
            />

            <Segmented
              legend="Художественный стиль"
              options={STYLES}
              value={settings.style}
              onChange={(style) => setSettings((c) => ({ ...c, style }))}
              columns="grid-cols-2 sm:grid-cols-4"
            />

            <Segmented
              legend="Свет"
              options={LIGHTINGS}
              value={settings.lighting}
              onChange={(lighting) => setSettings((c) => ({ ...c, lighting }))}
              columns="grid-cols-2 sm:grid-cols-3"
            />

            <Segmented
              legend="Настроение"
              options={MOODS}
              value={settings.mood}
              onChange={(mood) => setSettings((c) => ({ ...c, mood }))}
              columns="grid-cols-2 sm:grid-cols-4"
            />

            <Segmented
              legend="Оптика и ракурс"
              options={CAMERAS}
              value={settings.camera}
              onChange={(camera) => setSettings((c) => ({ ...c, camera }))}
              columns="grid-cols-2 sm:grid-cols-3"
            />

            <Segmented
              legend="Детализация"
              options={DETAILS}
              value={settings.detail}
              onChange={(detail) => setSettings((c) => ({ ...c, detail }))}
              columns="grid-cols-3"
            />

            <fieldset className="min-w-0">
              <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                Формат
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {ASPECTS.map((option) => {
                  const Icon = ASPECT_ICONS[option.id] ?? Square;
                  const active = option.id === settings.aspect;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSettings((c) => ({ ...c, aspect: option.id }))}
                      className={cn(
                        "flex min-h-10 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition-colors duration-150",
                        active
                          ? "border-accent/50 bg-accent/12 text-accent"
                          : "border-white/[0.07] bg-surface-2 text-content-secondary hover:bg-surface-3"
                      )}
                    >
                      <Icon size={14} className="shrink-0" />
                      <span className="truncate">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </section>

          <section className="rounded-3xl border border-white/[0.07] bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-content">
              Детали обстановки
            </h2>
            <div className="flex flex-wrap gap-2">
              {EXTRAS.map((extra) => {
                const active = settings.extras.includes(extra.id);
                return (
                  <button
                    key={extra.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleExtra(extra.id)}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150",
                      active
                        ? "border-accent/50 bg-accent/12 text-accent"
                        : "border-white/[0.07] bg-surface-2 text-content-secondary hover:bg-surface-3"
                    )}
                  >
                    {active && <Check size={13} />}
                    {extra.label}
                  </button>
                );
              })}
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                Свои детали (необязательно)
              </span>
              <textarea
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Например: старый шрам на брови, зелёное пальто, чашка остывшего кофе"
                className="input-field resize-y"
              />
            </label>

            <label className="mt-3 flex items-center gap-2 text-xs text-content-secondary">
              <input
                type="checkbox"
                checked={settings.includeNegative}
                onChange={(event) =>
                  setSettings((c) => ({ ...c, includeNegative: event.target.checked }))
                }
                className="h-4 w-4 rounded border-white/20 bg-surface-2 accent-accent"
              />
              Добавлять строку NEGATIVE с типичными артефактами
            </label>
          </section>
        </div>

        {/* ── Результат ───────────────────────────────────────── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-3xl border border-white/[0.07] bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-content">Готовый промпт</h2>
              {prompt && (
                <span className="text-[11px] tabular-nums text-content-muted">
                  {prompt.length.toLocaleString("ru-RU")} симв.
                </span>
              )}
            </div>

            <textarea
              rows={12}
              lang="en"
              spellCheck={false}
              readOnly
              value={prompt}
              placeholder="Нажмите «Собрать промпт» — он появится здесь."
              className="input-field resize-y font-mono text-[12px] leading-relaxed"
            />

            <p className="mt-3 rounded-2xl border border-white/[0.05] bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-content-muted">
              Ручная сборка оставляет описания на русском — это быстрый черновик.
              Кнопка «Улучшить моделью» переведёт всё в чистый английский и
              отшлифует формулировки.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleCompose}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
              >
                <Sparkles size={17} />
                Собрать промпт
              </button>

              <button
                type="button"
                onClick={() => void handleRefine()}
                disabled={refining || !character}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-4 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content disabled:opacity-40"
              >
                {refining ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Wand2 size={17} />
                )}
                {refining ? "Улучшаем…" : "Улучшить моделью"}
              </button>

              <button
                type="button"
                onClick={() => void handleCopy(prompt, "prompt")}
                disabled={!prompt}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-4 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content disabled:opacity-40"
              >
                {copied === "prompt" ? <Check size={17} /> : <Copy size={17} />}
                {copied === "prompt" ? "Скопировано" : "Копировать"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setPrompt("");
                  setError(null);
                }}
                disabled={!prompt}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-4 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content disabled:opacity-40"
              >
                <Eraser size={17} />
                Очистить
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-2xl border border-danger/25 bg-danger/5 px-3 py-2 text-[11px] leading-relaxed text-danger"
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span className="flex-1">{error}</span>
              </div>
            )}
          </section>

          <section className="mt-4 rounded-3xl border border-white/[0.07] bg-surface p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-content">
                Короткая версия
              </h2>
              <button
                type="button"
                onClick={() => void handleCopy(shortPreview, "short")}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-surface-2 px-2 text-[11px] font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content"
              >
                {copied === "short" ? <Check size={12} /> : <Copy size={12} />}
                {copied === "short" ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-content-muted">
              Для моделей с лимитом символов и быстрых черновиков.
            </p>
            <p className="mt-2 rounded-2xl border border-white/[0.05] bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
              {shortPreview || "—"}
            </p>
          </section>

          <p className="mt-3 px-1 text-[11px] leading-relaxed text-content-muted">
            Промпт собирается локально: интернет и API-ключ нужны только для
            кнопки «Улучшить моделью».
          </p>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {copied ? "Промпт скопирован" : ""}
      </span>
    </div>
  );
}
