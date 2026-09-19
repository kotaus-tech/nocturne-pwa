import {
  useState,
  useEffect,
  useId,
  useRef,
  useMemo,
} from "react";
import {
  Clapperboard,
  Sparkles,
  Loader2,
  Zap,
  HeartHandshake,
  ShieldCheck,
  Image as ImageIcon,
  Upload,
  Trash2,
  Flame,
  AlertTriangle,
  MessageCircle,
  Check,
  Save,
  Link,
  Palette,
  Terminal,
  ShieldAlert,
  Coffee,
  Crosshair,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { AmbientPlayer } from "./AmbientPlayer";
import { db } from "../../db";
import type { ChatSession, ThoughtMode } from "../../types";
import { WALLPAPER_PRESETS } from "../../utils/wallpaperPresets";
import { prepareImageFile, WALLPAPER_OPTIONS } from "../../utils/image";
import { PromptDialog } from "../common/PromptDialog";
import { cn } from "../../utils/cn";

interface Props {
  open: boolean;
  onClose: () => void;
  session: ChatSession;
  onUpdateNotes: (notes: string) => void;
  onCompressMemory: () => Promise<void>;
  onRefreshSummary?: () => Promise<void>;
  onUpdateSummary?: (summary: string) => void | Promise<unknown>;
  onUpdateDim: (dim: number) => void;
  onUpdateBlur: (blur: number) => void;
  onUpdateWallpaper: (url: string | undefined) => void;
  onToggleDynamicEvents?: (enabled: boolean) => void;
  onToggleSuspenseMode?: (enabled: boolean) => void;
  onToggleNaturalSpeech?: (enabled: boolean) => void;
  onToggleToasts?: (enabled: boolean) => void;
  onTogglePacing?: (enabled: boolean) => void;
  onUpdateThoughtMode?: (mode: ThoughtMode) => void;
  onOpenInspector?: () => void;
  messageCount: number;
}

const THOUGHT_MODES: {
  key: ThoughtMode;
  label: string;
  tagline: string;
  desc: string;
  icon: typeof ShieldAlert;
}[] = [
  {
    key: "censor",
    label: "Внутренний цензор",
    tagline: "Невысказанное",
    desc: "То, что ни за что не скажет вслух: уязвлённое самолюбие, тайное смущение или неловкость.",
    icon: ShieldAlert,
  },
  {
    key: "counterpoint",
    label: "Контрапункт",
    tagline: "Фасад vs Подтекст",
    desc: "Противоположность речи: говорит холодно — в мыслях паника; язвит — боится облажаться.",
    icon: Sparkles,
  },
  {
    key: "stream",
    label: "Поток сознания",
    tagline: "Бытовой реализм",
    desc: "Рваные мысли живого человека: самоирония, взгляд на обстановку, усталость и заземление.",
    icon: Coffee,
  },
  {
    key: "tactical",
    label: "Тактический расчёт",
    tagline: "Интрига и мотивы",
    desc: "Оценка скрытых намерений собеседника, поиск уязвимостей и планирование ответа.",
    icon: Crosshair,
  },
  {
    key: "instinct",
    label: "Импульс и тело",
    tagline: "Инстинкты момента",
    desc: "Физиология: дыхание, зажатые мышцы, мурашки, учащённый пульс и адреналин.",
    icon: Zap,
  },
];

interface SettingSwitchProps {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  icon: typeof Zap;
  warning?: boolean;
}

function SettingSwitch({
  label,
  description,
  checked,
  onToggle,
  icon: Icon,
  warning = false,
}: SettingSwitchProps) {
  const id = useId();

  return (
    <div className="flex items-start gap-3 py-4 sm:gap-4 sm:py-5">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl",
          checked
            ? warning
              ? "bg-warning/10 text-warning"
              : "bg-accent/10 text-accent"
            : "bg-surface-2 text-content-muted"
        )}
      >
        <Icon size={18} className="sm:size-5" strokeWidth={1.7} />
      </span>

      <div className="min-w-0 flex-1">
        <h4
          id={`${id}-label`}
          className="text-xs sm:text-base font-semibold leading-snug text-content"
        >
          {label}
        </h4>

        <p
          id={`${id}-description`}
          className="mt-1 text-[11px] sm:text-xs leading-relaxed text-content-secondary"
        >
          {description}
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        onClick={onToggle}
        className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl"
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative block h-5.5 w-10 sm:h-6 sm:w-11 rounded-full border",
            "transition-colors duration-150 motion-reduce:transition-none",
            checked
              ? warning
                ? "border-warning bg-warning"
                : "border-accent bg-accent"
              : "border-control-border bg-surface-3"
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full",
              "transition-transform duration-150 motion-reduce:transition-none",
              checked
                ? "translate-x-4 sm:translate-x-5 bg-on-accent text-accent"
                : "translate-x-0 bg-content-secondary"
            )}
          >
            {checked && <Check size={11} strokeWidth={3} />}
          </span>
        </span>
      </button>
    </div>
  );
}

export function DirectorPanel({
  open,
  onClose,
  session,
  onUpdateNotes,
  onCompressMemory,
  onRefreshSummary,
  onUpdateSummary,
  onUpdateDim,
  onUpdateBlur,
  onUpdateWallpaper,
  onToggleDynamicEvents,
  onToggleSuspenseMode,
  onToggleNaturalSpeech,
  onToggleToasts,
  onTogglePacing,
  onUpdateThoughtMode,
  onOpenInspector,
}: Props) {
  const [notes, setNotes] = useState(session.directorNotes || "");
  const [summaryText, setSummaryText] = useState(session.summary || "");
  const [isSummarySaved, setIsSummarySaved] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const [thoughtMode, setThoughtMode] = useState<ThoughtMode>(session.thoughtMode || "censor");
  const [dynamicEvents, setDynamicEvents] = useState(!!session.dynamicEvents);
  const [suspenseMode, setSuspenseMode] = useState(!!session.suspenseMode);
  const [naturalSpeech, setNaturalSpeech] = useState(!!session.naturalSpeech);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showToasts, setShowToasts] = useState(session.showRelationshipToasts !== false);
  const [realisticPacing, setRealisticPacing] = useState(session.realisticPacing !== false);

  const [dim, setDim] = useState(session.wallpaperDim ?? 0.55);
  const [blur, setBlur] = useState(session.wallpaperBlur ?? 0);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [failedWallpaper, setFailedWallpaper] = useState<string | null>(null);

  const [presetTab, setPresetTab] = useState<"all" | "gradients" | "vectors">("all");

  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const savingSummaryRef = useRef(false);
  const summaryRevisionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }
      setIsSummarySaved(false);
    }
  }, [open]);

  useEffect(() => {
    setNotes(session.directorNotes || "");
  }, [session.directorNotes]);

  useEffect(() => {
    setSummaryText(session.summary || "");
  }, [session.summary]);

  useEffect(() => {
    setThoughtMode(session.thoughtMode || "censor");
  }, [session.thoughtMode]);

  useEffect(() => {
    setDynamicEvents(!!session.dynamicEvents);
  }, [session.dynamicEvents]);

  useEffect(() => {
    setSuspenseMode(!!session.suspenseMode);
  }, [session.suspenseMode]);

  useEffect(() => {
    setNaturalSpeech(!!session.naturalSpeech);
  }, [session.naturalSpeech]);

  useEffect(() => {
    setShowToasts(session.showRelationshipToasts !== false);
  }, [session.showRelationshipToasts]);

  useEffect(() => {
    setRealisticPacing(session.realisticPacing !== false);
  }, [session.realisticPacing]);

  useEffect(() => {
    setDim(session.wallpaperDim ?? 0.55);
    setBlur(session.wallpaperBlur ?? 0);
  }, [session.wallpaperDim, session.wallpaperBlur]);

  const filteredPresets = useMemo(() => {
    if (presetTab === "all") return WALLPAPER_PRESETS;
    return WALLPAPER_PRESETS.filter((p) => p.category === presetTab);
  }, [presetTab]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setWallpaperError(null);
    setWallpaperBusy(true);

    try {
      // Обои сжимаются до 1920px: оригинал с телефона раздувает базу и квоту.
      const dataUrl = await prepareImageFile(file, WALLPAPER_OPTIONS);
      if (mountedRef.current) onUpdateWallpaper(dataUrl);
    } catch (cause) {
      if (mountedRef.current) {
        setWallpaperError(
          cause instanceof Error ? cause.message : "Не удалось подготовить изображение."
        );
      }
    } finally {
      if (mountedRef.current) setWallpaperBusy(false);
    }
  };

  const handleSetUrl = () => {
    setWallpaperError(null);
    setUrlDialogOpen(true);
  };

  const handleSelectThoughtMode = (mode: ThoughtMode) => {
    setThoughtMode(mode);
    if (onUpdateThoughtMode) onUpdateThoughtMode(mode);
    else void db.sessions.update(session.id, { thoughtMode: mode });
  };

  const handleToggleEvents = async () => {
    const next = !dynamicEvents;
    setDynamicEvents(next);
    if (next) {
      setSuspenseMode(false);
      if (onToggleSuspenseMode) onToggleSuspenseMode(false);
    }
    if (onToggleDynamicEvents) onToggleDynamicEvents(next);

    await db.sessions.update(session.id, {
      dynamicEvents: next,
      suspenseMode: next ? false : suspenseMode,
    });
  };

  const handleSuspenseClick = async () => {
    if (suspenseMode) {
      setSuspenseMode(false);
      if (onToggleSuspenseMode) onToggleSuspenseMode(false);
      await db.sessions.update(session.id, { suspenseMode: false });
    } else {
      setShowDisclaimer(true);
    }
  };

  const handleConfirmSuspense = async () => {
    setShowDisclaimer(false);
    setSuspenseMode(true);
    setDynamicEvents(false);
    if (onToggleSuspenseMode) onToggleSuspenseMode(true);
    if (onToggleDynamicEvents) onToggleDynamicEvents(false);

    await db.sessions.update(session.id, {
      suspenseMode: true,
      dynamicEvents: false,
    });
  };

  const handleToggleNaturalSpeech = async () => {
    const next = !naturalSpeech;
    setNaturalSpeech(next);
    if (onToggleNaturalSpeech) onToggleNaturalSpeech(next);
    else await db.sessions.update(session.id, { naturalSpeech: next });
  };

  const handleToggleToasts = async () => {
    const next = !showToasts;
    setShowToasts(next);
    if (onToggleToasts) onToggleToasts(next);
    else await db.sessions.update(session.id, { showRelationshipToasts: next });
  };

  const handleTogglePacing = async () => {
    const next = !realisticPacing;
    setRealisticPacing(next);
    if (onTogglePacing) onTogglePacing(next);
    else await db.sessions.update(session.id, { realisticPacing: next });
  };

  const handleSaveSummaryManual = async () => {
    if (!onUpdateSummary || savingSummaryRef.current) return;
    const revision = summaryRevisionRef.current;
    savingSummaryRef.current = true;
    setSavingSummary(true);
    setSummaryError(null);
    setIsSummarySaved(false);

    try {
      await onUpdateSummary(summaryText.trim());
      if (mountedRef.current && revision === summaryRevisionRef.current) {
        setIsSummarySaved(true);
        savedTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setIsSummarySaved(false);
        }, 2000);
      }
    } catch (cause) {
      if (mountedRef.current) {
        setSummaryError(cause instanceof Error ? cause.message : "Не удалось сохранить синопсис.");
      }
    } finally {
      savingSummaryRef.current = false;
      if (mountedRef.current) setSavingSummary(false);
    }
  };

  const handleRefresh = async () => {
    if (compressing) return;
    setCompressing(true);
    setSummaryError(null);

    try {
      if (onRefreshSummary) await onRefreshSummary();
      else await onCompressMemory();
    } catch (cause) {
      if (mountedRef.current) {
        setSummaryError(cause instanceof Error ? cause.message : "Ошибка актуализации.");
      }
    } finally {
      if (mountedRef.current) setCompressing(false);
    }
  };

  const charCount = summaryText.length;
  const showWallpaper = Boolean(session.wallpaperUrl) && failedWallpaper !== session.wallpaperUrl;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title="Панель режиссёра"
      >
        <div className="space-y-6 sm:space-y-7">
          {/* Секция: Заметки режиссёра */}
          <section>
            <label
              htmlFor={`${id}-notes`}
              className="mb-1.5 flex items-center gap-2 text-sm sm:text-base font-semibold text-content"
            >
              <Clapperboard size={18} className="text-accent" />
              <span>Заметки режиссёра</span>
            </label>
            <p className="mb-2.5 text-xs leading-relaxed text-content-secondary">
              Подмешиваются как контекст сцены. Пример: «Мы промокли под дождём, в комнате горит камин».
            </p>
            <textarea
              id={`${id}-notes`}
              rows={3}
              className="input-field resize-y text-xs sm:text-sm leading-relaxed"
              value={notes}
              onChange={(e) => {
                const val = e.target.value;
                setNotes(val);
                onUpdateNotes(val);
              }}
              placeholder="Введите режиссёрское указание для сцены..."
            />
          </section>

          {/* Секция: Вектор скрытых мыслей (innerThought) */}
          <section className="border-t border-white/[0.08] pt-5 sm:pt-6">
            <div className="mb-3">
              <h3 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-content">
                <Sparkles size={18} className="text-accent" />
                <span>Вектор скрытых мыслей (innerThought)</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-content-muted">
                Управляет тем, о чём персонаж думает про себя, исключая шаблонные повторы
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {THOUGHT_MODES.map((mode) => {
                const isSelected = thoughtMode === mode.key;
                const Icon = mode.icon;

                return (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => handleSelectThoughtMode(mode.key)}
                    className={cn(
                      "group relative flex flex-col p-3 rounded-2xl border text-left transition-all",
                      isSelected
                        ? "border-accent bg-accent/15 ring-1 ring-accent/40 shadow-sm"
                        : "border-white/[0.07] bg-surface-2 hover:border-white/[0.15] hover:bg-surface-3"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon
                          size={15}
                          className={isSelected ? "text-accent" : "text-content-muted group-hover:text-content"}
                        />
                        <span className="text-xs font-bold text-zinc-100 group-hover:text-accent">
                          {mode.label}
                        </span>
                      </div>
                      {isSelected && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-on-accent">
                          <Check size={10} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <span className="mt-1 text-[11px] font-medium text-accent">
                      {mode.tagline}
                    </span>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-content-secondary">
                      {mode.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Секция: Фон сцены и пресеты */}
          <section className="border-t border-white/[0.08] pt-5 sm:pt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-content">
                  <ImageIcon size={18} className="text-accent" />
                  <span>Фон сцены</span>
                </h3>
                <p className="text-[11px] sm:text-xs text-content-muted">
                  Выберите готовую тему или загрузите изображение
                </p>
              </div>

              {session.wallpaperUrl && (
                <button
                  type="button"
                  onClick={() => onUpdateWallpaper(undefined)}
                  className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
                >
                  <Trash2 size={13} />
                  <span>Сбросить</span>
                </button>
              )}
            </div>

            {/* Предпросмотр текущего фона */}
            {showWallpaper ? (
              <div className="relative aspect-[16/6] min-h-28 overflow-hidden rounded-2xl border border-white/[0.08] bg-black shadow-inner">
                <img
                  src={session.wallpaperUrl}
                  alt="Предпросмотр фона"
                  onError={() => setFailedWallpaper(session.wallpaperUrl ?? null)}
                  className="h-full w-full object-cover object-center"
                  style={{ filter: blur ? `blur(${blur}px)` : undefined }}
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[#090b10]"
                  style={{ opacity: dim }}
                />
                <span className="absolute bottom-2.5 left-2.5 rounded-lg border border-white/[0.1] bg-black/60 px-2 py-0.5 text-[10px] sm:text-[11px] font-medium text-zinc-200 backdrop-blur-md">
                  Текущий фон ветки
                </span>
              </div>
            ) : (
              <div className="flex min-h-24 items-center justify-center gap-2.5 rounded-2xl border border-dashed border-white/[0.08] bg-surface-2/40 p-3 text-center">
                <ImageIcon size={20} className="shrink-0 text-content-muted" />
                <p className="text-xs text-content-secondary">
                  Собственный фон для этой ветки не выбран (используется фон персонажа).
                </p>
              </div>
            )}

            {/* Заготовки */}
            <div className="mt-4 space-y-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-content-secondary">
                  <Palette size={14} className="text-accent shrink-0" />
                  <span>Атмосферные заготовки</span>
                </span>

                <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.06] bg-surface-2 p-1 sm:flex sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setPresetTab("all")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-center transition-all",
                      presetTab === "all"
                        ? "bg-accent/20 text-accent shadow-sm"
                        : "text-content-muted hover:text-content"
                    )}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetTab("gradients")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-center transition-all",
                      presetTab === "gradients"
                        ? "bg-accent/20 text-accent shadow-sm"
                        : "text-content-muted hover:text-content"
                    )}
                  >
                    Градиенты
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetTab("vectors")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-center transition-all",
                      presetTab === "vectors"
                        ? "bg-accent/20 text-accent shadow-sm"
                        : "text-content-muted hover:text-content"
                    )}
                  >
                    Векторные SVG
                  </button>
                </div>
              </div>

              {/* Сетка миниатюр */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {filteredPresets.map((preset) => {
                  const isSelected = session.wallpaperUrl === preset.url;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setWallpaperError(null);
                        onUpdateWallpaper(preset.url);
                      }}
                      className={cn(
                        "group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all",
                        isSelected
                          ? "border-accent ring-2 ring-accent/40 shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                          : "border-white/[0.08] hover:border-white/[0.2] hover:bg-surface-2"
                      )}
                    >
                      <div className="relative aspect-[16/9] w-full overflow-hidden bg-black">
                        <img
                          src={preset.url}
                          alt={preset.name}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        {isSelected && (
                          <span className="absolute right-1.5 top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-accent text-on-accent shadow-md">
                            <Check size={11} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="bg-surface-2/90 px-2 py-1">
                        <p className="truncate text-[11px] font-semibold text-zinc-200 group-hover:text-accent">
                          {preset.name}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Кнопки загрузки */}
            <div className="mt-3.5 grid grid-cols-2 gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                type="button"
                disabled={wallpaperBusy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-surface-3 truncate disabled:opacity-50"
              >
                {wallpaperBusy ? (
                  <Loader2 size={14} className="shrink-0 animate-spin" />
                ) : (
                  <Upload size={14} className="shrink-0" />
                )}
                <span className="truncate">
                  {wallpaperBusy ? "Обработка…" : "Загрузить файл"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleSetUrl}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-surface-3 truncate"
              >
                <Link size={14} className="shrink-0" />
                <span className="truncate">По ссылке</span>
              </button>
            </div>

            {wallpaperError && (
              <p className="mt-2 text-xs text-danger">{wallpaperError}</p>
            )}

            {/* Настройки затемнения и размытия */}
            {session.wallpaperUrl && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.06] bg-surface-2/60 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-content-secondary">Затемнение</span>
                    <span className="font-bold text-accent tabular-nums">
                      {Math.round(dim * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.9}
                    step={0.05}
                    value={dim}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setDim(val);
                      onUpdateDim(val);
                    }}
                    className="mt-1.5 block h-7 w-full accent-accent"
                  />
                </div>

                <div className="rounded-2xl border border-white/[0.06] bg-surface-2/60 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-content-secondary">Размытие</span>
                    <span className="font-bold text-accent tabular-nums">{blur} px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    value={blur}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBlur(val);
                      onUpdateBlur(val);
                    }}
                    className="mt-1.5 block h-7 w-full accent-accent"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Секция: Режимы повествования */}
          <section className="border-t border-white/[0.08] pt-5 sm:pt-6">
            <h3 className="mb-1 text-sm sm:text-base font-semibold text-content">
              Режимы повествования
            </h3>
            <div className="divide-y divide-white/[0.06]">
              <SettingSwitch
                label="Живая речь (Natural Spoken)"
                description="Разговорный стиль без книжного пафоса. Заминки, естественные интонации и эмоциональный накал."
                checked={naturalSpeech}
                onToggle={() => void handleToggleNaturalSpeech()}
                icon={MessageCircle}
              />
              <SettingSwitch
                label="Реалистичный темп (Slow Burn)"
                description="Персонаж держит границы, не ведётся на дешёвый флирт и требует постепенного завоевания доверия."
                checked={realisticPacing}
                onToggle={() => void handleTogglePacing()}
                icon={ShieldCheck}
              />
              <SettingSwitch
                label="Насыщенный режим"
                description="Уютные бытовые казусы и случайные события (звонки, курьеры, пролитый чай, забытые ключи)."
                checked={dynamicEvents}
                onToggle={() => void handleToggleEvents()}
                icon={Zap}
              />
              <SettingSwitch
                label="Режим Саспенса (Триллер)"
                description="Психологический триллер, нарастающая тревога, помехи, аномалии и саспенс."
                checked={suspenseMode}
                onToggle={() => void handleSuspenseClick()}
                icon={Flame}
                warning
              />
              <SettingSwitch
                label="Уведомления отношений"
                description="Всплывающие плашки при переходе на новые этапы связи и сближении."
                checked={showToasts}
                onToggle={() => void handleToggleToasts()}
                icon={HeartHandshake}
              />
            </div>
          </section>

          {/* Секция: Сюжетный синопсис */}
          <section className="border-t border-white/[0.08] pt-5 sm:pt-6">
            <div className="mb-2 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-content">
                <Sparkles size={16} className="text-accent" />
                <span>Сюжетный синопсис</span>
              </label>
              <span className="text-[11px] tabular-nums text-content-muted">
                {charCount.toLocaleString("ru-RU")} симв.
              </span>
            </div>

            <textarea
              rows={5}
              className="input-field resize-y text-xs leading-relaxed"
              value={summaryText}
              onChange={(e) => {
                summaryRevisionRef.current += 1;
                setSummaryText(e.target.value);
                setIsSummarySaved(false);
                setSummaryError(null);
              }}
              placeholder="Сюжетный синопсис пуст..."
            />

            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveSummaryManual()}
                disabled={savingSummary || summaryText === (session.summary || "")}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-surface-3 disabled:opacity-40"
              >
                {savingSummary ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : isSummarySaved ? (
                  <Check size={14} className="text-success" />
                ) : (
                  <Save size={14} />
                )}
                <span>Сохранить</span>
              </button>

              <button
                type="button"
                disabled={compressing}
                onClick={() => void handleRefresh()}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-on-accent shadow-sm hover:bg-accent-hover disabled:opacity-40"
              >
                {compressing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                <span>Актуализировать</span>
              </button>
            </div>

            {summaryError && (
              <p className="mt-2 text-xs text-danger">{summaryError}</p>
            )}
          </section>

          {/* Секция: Атмосфера */}
          <div className="border-t border-white/[0.08] pt-5 sm:pt-6">
            <AmbientPlayer />
          </div>

          {/* Секция: Анализ запроса "Под капотом" */}
          {onOpenInspector && (
            <div className="border-t border-white/[0.08] pt-5 sm:pt-6">
              <button
                type="button"
                onClick={onOpenInspector}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-3.5 text-left transition-all hover:border-accent hover:bg-accent/15"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent">
                    <Terminal size={18} />
                  </span>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-zinc-100">
                      Инспектор промпта и токенов
                    </h4>
                    <p className="text-[11px] text-content-secondary">
                      Посмотреть полный контекст запроса, системный промпт и расход токенов
                    </p>
                  </div>
                </div>
                <span className="rounded-lg border border-accent/30 bg-accent/20 px-2 py-1 text-[11px] font-semibold text-accent shrink-0">
                  Под капотом
                </span>
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Модалка подтверждения саспенса */}
      <Modal
        open={showDisclaimer}
        onClose={() => setShowDisclaimer(false)}
        title="Активация Режима Саспенса"
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-3.5">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-xs font-medium leading-relaxed text-content">
              Вы включаете генератор психологического триллера и мистического саспенса. В историю проникнут аномалии, тревога и загадочные происшествия.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-white/[0.08] pt-3.5">
            <button
              type="button"
              onClick={() => setShowDisclaimer(false)}
              className="rounded-xl border border-white/[0.08] px-3.5 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-3"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmSuspense()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-warning px-3.5 py-2 text-xs font-semibold text-black hover:opacity-90"
            >
              <Flame size={14} />
              <span>Включить саспенс</span>
            </button>
          </div>
        </div>
      </Modal>

      <PromptDialog
        open={urlDialogOpen}
        title="Фон по ссылке"
        description="Укажите прямую ссылку на изображение. Для офлайн-доступа надёжнее загрузить файл."
        label="Адрес изображения"
        initialValue={session.wallpaperUrl?.startsWith("http") ? session.wallpaperUrl : ""}
        placeholder="https://…"
        confirmLabel="Применить"
        onClose={() => setUrlDialogOpen(false)}
        onConfirm={(url) => onUpdateWallpaper(url.trim() || undefined)}
      />
    </>
  );
}