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
  Brain,
  Radio,
  Clock3,
  Crosshair,
  Users,
  X,
  GripVertical,
  Play,
  ChevronUp,
  ChevronDown,
  ArrowRight,
  Plus,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Reorder, useDragControls } from "framer-motion";
import { Modal } from "../common/Modal";
import { Avatar } from "../common/Avatar";
import { AmbientPlayer } from "./AmbientPlayer";
import { db } from "../../db";
import type {
  Character,
  ChatSession,
  ParticipantMemory,
  SceneSessionPatch,
  ThoughtMode,
} from "../../types";
import {
  MAX_INTENTION_LENGTH,
  MAX_PRIVATE_NOTE_LENGTH,
  MAX_PRIVATE_NOTES,
  OFFSCREEN_TICK_INTERVAL,
  OFFSCREEN_TICK_INTERVAL_MAX,
  OFFSCREEN_TICK_INTERVAL_MIN,
  moveItem,
} from "../../services/groupScene";
import { newId } from "../../utils/id";
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
  /** Дать ход одному конкретному персонажу сцены. */
  onRequestTurn?: (characterId: string) => void;
  /** Ввести персонажа в сцену или убрать за кадр (причина — в промпт). */
  onTogglePresence?: (characterId: string, isPresent: boolean, reason?: string) => void;
  /** «Живая сцена»: короткие реакции других героев в той же реплике. */
  onToggleLiveScene?: (enabled: boolean) => void;
  /** Ручная правка личной памяти участника. */
  onUpdateParticipantMemory?: (
    characterId: string,
    patch: Partial<ParticipantMemory>
  ) => void | Promise<unknown>;
  /** Включить/выключить фоновую жизнь отсутствующих участников. */
  onToggleOffscreenLife?: (enabled: boolean) => void;
  /** Изменить интервал offscreen-проверок в ходах. */
  onUpdateOffscreenInterval?: (interval: number) => void;
  /** Единая шина ручных изменений состава/связей из панели. */
  onApplyScenePatch?: (patch: SceneSessionPatch) => void | Promise<unknown>;
  /** Кто из состава сейчас в сцене. */
  presentIds?: string[];
  /** Идёт генерация — кнопки хода заблокированы. */
  sending?: boolean;
  messageCount: number;
}

function clampOffscreenInterval(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return OFFSCREEN_TICK_INTERVAL;
  }
  return Math.min(
    OFFSCREEN_TICK_INTERVAL_MAX,
    Math.max(OFFSCREEN_TICK_INTERVAL_MIN, Math.round(value))
  );
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

/** Строка участника сцены: перетаскивание за ручку, стрелки и «дать ход». */
function ParticipantRow({
  item,
  index,
  total,
  disabled,
  isPresent,
  onRemove,
  onMove,
  onRequestTurn,
  onTogglePresence,
}: {
  item: Character;
  index: number;
  total: number;
  disabled?: boolean;
  isPresent: boolean;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onRequestTurn?: () => void;
  onTogglePresence?: (isPresent: boolean) => void;
}) {
  const dragControls = useDragControls();

  const rowButtonClass =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={dragControls}
      className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-[#121622]/80 p-2"
    >
      <span
        role="button"
        tabIndex={-1}
        aria-label={`Перетащить ${item.name}`}
        title="Зажмите и перетащите, чтобы изменить порядок"
        onPointerDown={(event) => dragControls.start(event)}
        className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-content-muted hover:text-content active:cursor-grabbing"
      >
        <GripVertical size={15} />
      </span>

      <span className="w-3 text-center text-[11px] font-semibold tabular-nums text-content-muted">
        {index + 2}
      </span>

      <Avatar src={item.avatarUrl} name={item.name} size={30} />

      <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
        {item.name}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        {onTogglePresence && (
          <button
            type="button"
            onClick={() => onTogglePresence(!isPresent)}
            disabled={disabled}
            aria-pressed={isPresent}
            aria-label={
              isPresent
                ? `Убрать ${item.name} из сцены`
                : `Ввести ${item.name} в сцену`
            }
            title={isPresent ? "В сцене — убрать за кадр" : "За кадром — ввести в сцену"}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[10px] font-semibold transition-colors disabled:opacity-30",
              isPresent
                ? "text-success hover:bg-success/10"
                : "text-content-muted hover:bg-white/[0.06] hover:text-content"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 rounded-full",
                isPresent ? "bg-success" : "bg-content-muted"
              )}
            />
            {isPresent ? "в сцене" : "за кадром"}
          </button>
        )}

        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={`Поднять ${item.name} выше`}
          title="Выше"
          className={rowButtonClass}
        >
          <ChevronUp size={14} />
        </button>

        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label={`Опустить ${item.name} ниже`}
          title="Ниже"
          className={rowButtonClass}
        >
          <ChevronDown size={14} />
        </button>

        {onRequestTurn && isPresent && (
          <button
            type="button"
            onClick={onRequestTurn}
            disabled={disabled}
            aria-label={`Дать ход: ${item.name}`}
            title={`Дать ход: ${item.name}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-accent transition-colors hover:bg-accent/15 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Play size={13} fill="currentColor" />
          </button>
        )}

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Убрать ${item.name} из сцены`}
          title="Убрать из сцены"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-white/[0.06] hover:text-danger"
        >
          <X size={14} />
        </button>
      </div>
    </Reorder.Item>
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
  onRequestTurn,
  onTogglePresence,
  onToggleLiveScene,
  onUpdateParticipantMemory,
  onToggleOffscreenLife,
  onUpdateOffscreenInterval,
  onApplyScenePatch,
  presentIds,
  sending = false,
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
  const [expandedMemory, setExpandedMemory] = useState<Record<string, boolean>>({});
  const [newMemoryNote, setNewMemoryNote] = useState<Record<string, string>>({});
  const [offscreenIntervalDraft, setOffscreenIntervalDraft] = useState(() =>
    String(clampOffscreenInterval(session.offscreenTickInterval))
  );

  useEffect(() => {
    setOffscreenIntervalDraft(
      String(clampOffscreenInterval(session.offscreenTickInterval))
    );
  }, [session.id, session.offscreenTickInterval]);

  const commitOffscreenInterval = (rawValue: string) => {
    const parsed = Number(rawValue);
    const next = clampOffscreenInterval(
      rawValue.trim() === "" || !Number.isFinite(parsed)
        ? session.offscreenTickInterval
        : parsed
    );
    setOffscreenIntervalDraft(String(next));
    if (next !== clampOffscreenInterval(session.offscreenTickInterval)) {
      onUpdateOffscreenInterval?.(next);
    }
  };

  const [dim, setDim] = useState(session.wallpaperDim ?? 0.55);
  const [blur, setBlur] = useState(session.wallpaperBlur ?? 0);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);

  const character = useLiveQuery(
    () => db.characters.get(session.characterId),
    [session.characterId]
  );

  // Групповая сцена: дополнительные участники.
  const allCharacters = useLiveQuery(() => db.characters.toArray(), []);
  const [characterToAdd, setCharacterToAdd] = useState("");
  const participantIds = session.characterIds ?? [];
  const participantCharacters = participantIds
    .map((id) => allCharacters?.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const memoryCharacters = [
    character,
    ...participantCharacters,
  ].filter((item): item is Character => Boolean(item));
  const availableCharacters = (allCharacters ?? [])
    .filter(
      (item) =>
        item.id !== session.characterId && !participantIds.includes(item.id)
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  /** Присутствие приходит из чата: там же считаются состав и пул говорящих. */
  const isPresent = (id: string) =>
    !presentIds || presentIds.length === 0 || presentIds.includes(id);

  const updateParticipants = async (ids: string[]) => {
    // Состав меняется — синхронизируем и «кто в сцене»: новый участник сразу
    // входит в комнату, ушедшие из состава пропадают из списка присутствия.
    let nextActive: string[] | undefined;

    if (session.activeCharacterIds) {
      const prevCast = new Set(session.characterIds ?? []);
      const added = ids.filter((id) => !prevCast.has(id));
      nextActive = ids.filter(
        (id) => session.activeCharacterIds!.includes(id) || added.includes(id)
      );
    }

    const allowedMemoryIds = new Set([session.characterId, ...ids]);
    const nextMemory = Object.fromEntries(
      Object.entries(session.participantMemory ?? {}).filter(([id]) =>
        allowedMemoryIds.has(id)
      )
    );

    const patch: SceneSessionPatch = {
      compositionPatch: { characterIds: ids, isGroup: ids.length > 0 },
      ...(nextActive
        ? { presencePatch: { activeCharacterIds: nextActive } }
        : {}),
      sourceKind: "user_turn",
      sourceSnapshotAt: Date.now(),
    };

    if (onApplyScenePatch) {
      await onApplyScenePatch(patch);
      return;
    }

    await db.sessions.update(session.id, {
      characterIds: ids,
      isGroup: ids.length > 0,
      participantMemory: nextMemory,
      ...(nextActive ? { activeCharacterIds: nextActive } : {}),
      updatedAt: Date.now(),
    });
  };

  const addParticipant = async () => {
    if (!characterToAdd) return;
    await updateParticipants([...participantIds, characterToAdd]);
    setCharacterToAdd("");
  };

  const relations = session.relations ?? [];
  const castOptions = [
    { id: session.characterId, name: character?.name || "Основной" },
    ...participantCharacters.map((item) => ({ id: item.id, name: item.name })),
  ];

  const updateRelations = async (
    updater: (list: NonNullable<ChatSession["relations"]>) => NonNullable<
      ChatSession["relations"]
    >
  ) => {
    const nextRelations = updater(relations);
    if (onApplyScenePatch) {
      await onApplyScenePatch({
        relationsReplace: nextRelations,
        sourceKind: "user_turn",
        sourceSnapshotAt: Date.now(),
      });
      return;
    }

    await db.sessions.update(session.id, {
      relations: nextRelations,
      updatedAt: Date.now(),
    });
  };

  const memoryFor = (characterId: string): ParticipantMemory => ({
    characterId,
    privateNotes: [],
    intention: null,
    lastExtractedMessageId: null,
    absentSinceMessageId: null,
    ticksSinceLastSignificant: 0,
    significantSinceLastContact: 0,
    ...(session.participantMemory?.[characterId] ?? {}),
  });

  const updateMemory = async (
    characterId: string,
    patch: Partial<ParticipantMemory>
  ) => {
    await onUpdateParticipantMemory?.(characterId, patch);
  };

  const addManualNote = async (characterId: string) => {
    const text = (newMemoryNote[characterId] ?? "").trim();
    if (!text) return;

    const current = memoryFor(characterId);
    const notes = [
      text.slice(0, MAX_PRIVATE_NOTE_LENGTH),
      ...current.privateNotes,
    ].slice(0, MAX_PRIVATE_NOTES);
    await updateMemory(characterId, { privateNotes: notes });
    setNewMemoryNote((state) => ({ ...state, [characterId]: "" }));
  };

  const favoriteCandidates = availableCharacters.filter(
    (item) => item.isFavorite
  );

  const addFavorites = async () => {
    if (favoriteCandidates.length === 0) return;
    await updateParticipants([
      ...participantIds,
      ...favoriteCandidates.map((item) => item.id),
    ]);
  };

  const clearParticipants = async () => {
    await updateParticipants([]);
    if (onApplyScenePatch) return;
    await db.sessions.update(session.id, {
      participantStats: {},
      participantMemory: {},
      activeCharacterIds: undefined,
      absentReasons: {},
      relations: [],
      isGroup: false,
    });
  };

  const removeParticipant = async (id: string) => {
    const nextIds = participantIds.filter((item) => item !== id);
    const nextStats = { ...(session.participantStats ?? {}) };
    delete nextStats[id];
    const nextMemory = { ...(session.participantMemory ?? {}) };
    delete nextMemory[id];

    await updateParticipants(nextIds);
    if (onApplyScenePatch) return;
    await db.sessions.update(session.id, {
      participantStats: nextStats,
      participantMemory: nextMemory,
    });
  };
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

          {/* Секция: участники групповой сцены */}
          <section className="border-t border-white/[0.08] pt-5 sm:pt-6">
            <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-content sm:text-base">
              <Users size={18} className="text-accent" />
              <span>Групповая сцена</span>
            </h3>
            <p className="mb-2.5 text-xs leading-relaxed text-content-secondary">
              Персонажи рядом с {character?.name || "основным"}. Каждый отвечает
              своим ходом по порядку списка (отдельный запрос на участника) и
              видит уже сказанное остальными.
            </p>

            <ul className="mb-2 space-y-2">
              <li className="flex items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-[#121622]/60 p-2">
                <span className="w-5 text-center text-[11px] font-semibold tabular-nums text-content-muted">
                  1
                </span>
                <Avatar
                  src={character?.avatarUrl}
                  name={character?.name || "Персонаж"}
                  size={30}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
                  {character?.name || "Основной персонаж"}
                </span>
                <span className="shrink-0 pr-1 text-[10px] uppercase tracking-wider text-content-muted">
                  основной
                </span>
                {onRequestTurn && (
                  <button
                    type="button"
                    onClick={() => onRequestTurn(session.characterId)}
                    disabled={sending}
                    aria-label={`Дать ход: ${character?.name || "основной персонаж"}`}
                    title={`Дать ход: ${character?.name || "основной персонаж"}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-accent transition-colors hover:bg-accent/15 disabled:opacity-30"
                  >
                    <Play size={13} fill="currentColor" />
                  </button>
                )}
              </li>
            </ul>

            {participantCharacters.length > 0 && (
              <Reorder.Group
                axis="y"
                values={participantCharacters}
                onReorder={(order) =>
                  void updateParticipants(order.map((item) => item.id))
                }
                className="mb-2 space-y-2"
              >
                {participantCharacters.map((item, index) => (
                  <ParticipantRow
                    key={item.id}
                    item={item}
                    index={index}
                    total={participantCharacters.length}
                    disabled={sending}
                    isPresent={isPresent(item.id)}
                    onTogglePresence={
                      onTogglePresence
                        ? (nextPresent) =>
                            onTogglePresence(item.id, nextPresent, undefined)
                        : undefined
                    }
                    onRemove={() => void removeParticipant(item.id)}
                    onMove={(direction) =>
                      void updateParticipants(
                        moveItem(participantCharacters, index, direction).map(
                          (row) => row.id
                        )
                      )
                    }
                    onRequestTurn={
                      onRequestTurn ? () => onRequestTurn(item.id) : undefined
                    }
                  />
                ))}
              </Reorder.Group>
            )}

            {participantCharacters.length > 1 && (
              <p className="mb-2 text-[11px] text-content-muted">
                Порядок = очередь ходов. Перетаскивайте за ручку или двигайте
                стрелками.
              </p>
            )}

            <div className="flex items-center gap-2">
              <select
                value={characterToAdd}
                onChange={(event) => setCharacterToAdd(event.target.value)}
                aria-label="Добавить персонажа в сцену"
                className="input-field min-w-0 flex-1 text-xs sm:text-sm"
              >
                <option value="">
                  {availableCharacters.length > 0
                    ? "Добавить персонажа…"
                    : "Все персонажи уже в сцене"}
                </option>
                {availableCharacters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => void addParticipant()}
                disabled={!characterToAdd}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 px-3 text-xs font-semibold text-accent transition-all hover:bg-accent/25 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.03] disabled:text-content-muted"
              >
                Добавить
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {favoriteCandidates.length > 0 && (
                <button
                  type="button"
                  onClick={() => void addFavorites()}
                  title="Добавить всех избранных персонажей в сцену"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#121622]/80 px-2.5 py-1.5 text-[11px] font-medium text-content-secondary transition-colors hover:border-accent/40 hover:text-accent"
                >
                  <Sparkles size={12} className="text-accent" />
                  Добавить избранных ({favoriteCandidates.length})
                </button>
              )}

              {participantCharacters.length > 0 && (
                <button
                  type="button"
                  onClick={() => void clearParticipants()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#121622]/80 px-2.5 py-1.5 text-[11px] font-medium text-content-secondary transition-colors hover:border-danger/40 hover:text-danger"
                >
                  <X size={12} />
                  Очистить сцену
                </button>
              )}
            </div>

            {participantCharacters.length > 1 && onToggleLiveScene && (
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-white/[0.08] bg-[#121622]/70 p-2.5">
                  <input
                    type="checkbox"
                    checked={session.liveScene !== false}
                    onChange={(event) => onToggleLiveScene(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-content">
                      Живая сцена
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-content-muted">
                      Отвечает по-прежнему один герой, но в конце реплики он может
                      дать 1–2 короткие реакции остальных — так сцена звучит живее.
                    </span>
                  </span>
                </label>
              )}

              {participantCharacters.some((item) => !isPresent(item.id)) && (
              <p className="mt-2 text-[11px] leading-relaxed text-content-muted">
                За кадром персонаж продолжает жить независимо от того, кто сейчас
                говорит в кадре. Фоновая проверка не раскрывает его приватные мысли
                другим героям и не блокирует основную генерацию.
              </p>
            )}

            {participantCharacters.length > 0 && onToggleOffscreenLife && (
              <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#121622]/70 p-3">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={session.offscreenLifeEnabled !== false}
                    onChange={(event) => onToggleOffscreenLife(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-content">
                      <Radio size={13} className="text-accent" />
                      Жизнь за кадром
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-content-muted">
                      Отсутствующие персонажи иногда думают, принимают решения и
                      могут выйти на связь. Проверки редкие и не задерживают ответ.
                    </span>
                  </span>
                </label>
                {session.offscreenLifeEnabled !== false && onUpdateOffscreenInterval && (
                  <label className="mt-2.5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-2.5 text-[11px] text-content-secondary">
                    <span className="flex items-center gap-1.5">
                      <Clock3 size={12} className="text-content-muted" />
                      Проверять каждые ходы
                    </span>
                    <input
                      type="number"
                      min={OFFSCREEN_TICK_INTERVAL_MIN}
                      max={OFFSCREEN_TICK_INTERVAL_MAX}
                      step={1}
                      inputMode="numeric"
                      value={offscreenIntervalDraft}
                      onChange={(event) => {
                        const rawValue = event.target.value;
                        // Не отправляем пустую строку или промежуточное
                        // значение вроде «2» в редьюсер: иначе min=4 тут же
                        // возвращает число и мобильная клавиатура не даёт
                        // набрать 20.
                        if (!/^\d*$/.test(rawValue)) return;
                        setOffscreenIntervalDraft(rawValue);

                        const parsed = Number(rawValue);
                        if (
                          rawValue !== "" &&
                          Number.isFinite(parsed) &&
                          parsed >= OFFSCREEN_TICK_INTERVAL_MIN &&
                          parsed <= OFFSCREEN_TICK_INTERVAL_MAX
                        ) {
                          onUpdateOffscreenInterval(parsed);
                        }
                      }}
                      onBlur={() => commitOffscreenInterval(offscreenIntervalDraft)}
                      className="input-field input-field--compact w-20 text-center"
                      aria-label="Интервал жизни за кадром"
                    />
                  </label>
                )}
              </div>
            )}

            {participantCharacters.length > 0 && onUpdateParticipantMemory && (
              <section className="mt-4 rounded-2xl border border-white/[0.08] bg-[#121622]/50 p-3">
                <div className="mb-2.5 flex items-start gap-2">
                  <Brain size={16} className="mt-0.5 shrink-0 text-accent" />
                  <div>
                    <h4 className="text-xs font-semibold text-content">Внутренний мир персонажей</h4>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-content-muted">
                      Что каждый персонаж думает и помнит, но не обязан говорить вслух.
                      Можно исправить модель или добавить мысль вручную.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {memoryCharacters.map((member) => {
                    const memory = memoryFor(member.id);
                    const expanded = expandedMemory[member.id] ?? member.id === session.characterId;

                    return (
                      <div key={member.id} className="rounded-2xl border border-white/[0.07] bg-[#0f131d]/80">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMemory((state) => ({
                              ...state,
                              [member.id]: !expanded,
                            }))
                          }
                          className="flex w-full items-center gap-2 p-2.5 text-left"
                          aria-expanded={expanded}
                        >
                          <Avatar src={member.avatarUrl} name={member.name} size={26} />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-content">
                            {member.name}
                            {member.id === session.characterId ? " · лидер" : ""}
                          </span>
                          <span className="text-[10px] text-content-muted">
                            {memory.privateNotes.length}/{MAX_PRIVATE_NOTES} заметок
                          </span>
                          {expanded ? <ChevronUp size={14} className="text-content-muted" /> : <ChevronDown size={14} className="text-content-muted" />}
                        </button>

                        {expanded && (
                          <div className="space-y-2 border-t border-white/[0.06] p-2.5">
                            {memory.privateNotes.map((note, index) => (
                              <div key={`${member.id}-${index}`} className="flex items-start gap-1.5">
                                <input
                                  value={note}
                                  maxLength={MAX_PRIVATE_NOTE_LENGTH}
                                  onChange={(event) => {
                                    const next = [...memory.privateNotes];
                                    next[index] = event.target.value;
                                    void updateMemory(member.id, { privateNotes: next });
                                  }}
                                  aria-label={`Личная заметка ${index + 1} персонажа ${member.name}`}
                                  className="input-field input-field--compact min-w-0 flex-1 text-[11px]"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    void updateMemory(member.id, {
                                      privateNotes: memory.privateNotes.filter((_, itemIndex) => itemIndex !== index),
                                    })
                                  }
                                  aria-label={`Удалить заметку персонажа ${member.name}`}
                                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-content-muted hover:bg-danger/10 hover:text-danger"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ))}

                            {memory.privateNotes.length < MAX_PRIVATE_NOTES && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={newMemoryNote[member.id] ?? ""}
                                  maxLength={MAX_PRIVATE_NOTE_LENGTH}
                                  onChange={(event) =>
                                    setNewMemoryNote((state) => ({
                                      ...state,
                                      [member.id]: event.target.value,
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void addManualNote(member.id);
                                    }
                                  }}
                                  placeholder="Добавить мысль вручную…"
                                  aria-label={`Добавить мысль для ${member.name}`}
                                  className="input-field input-field--compact min-w-0 flex-1 text-[11px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => void addManualNote(member.id)}
                                  disabled={!newMemoryNote[member.id]?.trim()}
                                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2 text-[10px] font-semibold text-accent disabled:opacity-40"
                                >
                                  <Plus size={12} />
                                  Добавить
                                </button>
                              </div>
                            )}

                            <div className="border-t border-white/[0.06] pt-2">
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-content-muted">
                                Активное намерение
                              </label>
                              <textarea
                                value={memory.intention?.text ?? ""}
                                maxLength={MAX_INTENTION_LENGTH}
                                onChange={(event) => {
                                  const text = event.target.value;
                                  void updateMemory(member.id, {
                                    intention: text.trim()
                                      ? {
                                          text,
                                          scope: memory.intention?.scope ?? "scene",
                                          createdAtMessageId: memory.intention?.createdAtMessageId ?? "",
                                          origin: memory.intention?.origin ?? "scene",
                                        }
                                      : null,
                                  });
                                }}
                                placeholder="Нет активного намерения"
                                aria-label={`Намерение персонажа ${member.name}`}
                                rows={2}
                                className="input-field mt-1.5 min-h-0 resize-y text-[11px]"
                              />
                              {memory.intention && (
                                <div className="mt-1.5 flex items-center justify-between gap-2">
                                  <select
                                    value={memory.intention.scope}
                                    onChange={(event) =>
                                      void updateMemory(member.id, {
                                        intention: {
                                          ...memory.intention!,
                                          scope: event.target.value as NonNullable<typeof memory.intention>["scope"],
                                        },
                                      })
                                    }
                                    className="input-field input-field--compact text-[11px]"
                                    aria-label={`Срок намерения ${member.name}`}
                                  >
                                    <option value="location">до смены места</option>
                                    <option value="time">до скачка времени</option>
                                    <option value="scene">до смены сцены</option>
                                    <option value="persistent">долгосрочное</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void updateMemory(member.id, { intention: null })}
                                    className="text-[10px] font-medium text-content-muted hover:text-danger"
                                  >
                                    Завершить
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {participantCharacters.length === 0 && (
              <p className="mt-2 text-[11px] leading-relaxed text-content-muted">
                Пока сцена обычная: отвечает один персонаж. Добавьте второго —
                и он подключится к сцене.
              </p>
            )}

            {participantCharacters.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-content-secondary">
                  <HeartHandshake size={13} className="text-accent" />
                  <span>Взаимоотношения в группе</span>
                </h4>
                <p className="mb-2 text-[11px] leading-relaxed text-content-muted">
                  Кто как относится к кому: спор, старая обида, тайная симпатия.
                  Это топливо для живого полилога — модель играет связи через
                  подтекст, а не пересказ. Если по ходу сцены кто-то обиделся или
                  потеплел, связь обновится сама — такую строку можно поправить
                  руками.
                </p>

                {relations.length > 0 && (
                  <div className="mb-2 space-y-2">
                    {relations.map((relation) => (
                      <div
                        key={relation.id}
                        className="space-y-1.5 rounded-2xl border border-white/[0.08] bg-[#121622]/70 p-2"
                      >
                        <div className="flex items-center gap-1.5">
                          <select
                            value={relation.from}
                            onChange={(event) =>
                              void updateRelations((list) =>
                                list.map((row) =>
                                  row.id === relation.id
                                    ? { ...row, from: event.target.value }
                                    : row
                                )
                              )
                            }
                            aria-label="Кто думает"
                            className="input-field input-field--compact min-w-0 flex-1"
                          >
                            {castOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>

                          <ArrowRight
                            size={12}
                            className="shrink-0 text-content-muted"
                            aria-hidden="true"
                          />

                          <select
                            value={relation.to ?? ""}
                            onChange={(event) =>
                              void updateRelations((list) =>
                                list.map((row) =>
                                  row.id === relation.id
                                    ? {
                                        ...row,
                                        to: event.target.value || undefined,
                                      }
                                    : row
                                )
                              )
                            }
                            aria-label="О ком"
                            className="input-field input-field--compact min-w-0 flex-1"
                          >
                            <option value="">вся группа</option>
                            {castOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>

                        </div>

                        <div className="flex items-center gap-1.5">
                          <input
                            value={relation.text}
                            title={
                              relation.updatedAt
                                ? "Обновлено по ходу сцены — можно поправить вручную"
                                : undefined
                            }
                            onChange={(event) =>
                              void updateRelations((list) =>
                                list.map((row) =>
                                  row.id === relation.id
                                    ? { ...row, text: event.target.value }
                                    : row
                                )
                              )
                            }
                            placeholder="считает его баловнем, но тайно переживает"
                            aria-label="Отношение"
                            className="input-field input-field--compact min-w-0 flex-1"
                          />

                          <button
                            type="button"
                            onClick={() =>
                              void updateRelations((list) =>
                                list.filter((row) => row.id !== relation.id)
                              )
                            }
                            aria-label="Удалить связь"
                            title="Удалить связь"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-white/[0.06] hover:text-danger"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        {relation.updatedAt && (
                          <p className="text-[10px] text-content-muted">
                            обновлено по ходу сцены
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() =>
                    void updateRelations((list) => [
                      ...list,
                      {
                        id: newId(),
                        from: session.characterId,
                        to: participantCharacters[0]?.id,
                        text: "",
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#121622]/80 px-2.5 py-1.5 text-[11px] font-medium text-content-secondary transition-colors hover:border-accent/40 hover:text-accent"
                >
                  <Plus size={12} />
                  Добавить связь
                </button>
              </div>
            )}
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