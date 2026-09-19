import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  Plus,
  Trash2,
  ImagePlus,
  Sliders,
  BookOpen,
  User,
  FileText,
  Sparkles,
  Save,
  Loader2,
  AlertCircle,
  Check,
  Palette,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { Avatar } from "../common/Avatar";
import { ImageCropperModal } from "../common/ImageCropperModal";
import { CharacterGeneratorModal } from "./CharacterGeneratorModal";
import { TAG_CATEGORIES } from "../../services/characterGenerator";
import { WALLPAPER_PRESETS } from "../../utils/wallpaperPresets";
import type {
  Character,
  LorebookEntry,
  RelationshipStats,
} from "../../types";
import { DEFAULT_STATS } from "../../types";
import { newId } from "../../utils/id";
import { cn } from "../../utils/cn";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (character: Character) => void | Promise<void>;
  initial?: Character | null;
}

const PRESET_RELATIONS: {
  label: string;
  stats: RelationshipStats;
}[] = [
  {
    label: "Незнакомцы",
    stats: {
      trust: 10,
      affection: 5,
      closeness: 0,
      tension: 30,
      conflict: 0,
      statusTitle: "Незнакомцы",
    },
  },
  {
    label: "Знакомство",
    stats: {
      trust: 40,
      affection: 25,
      closeness: 15,
      tension: 15,
      conflict: 0,
      statusTitle: "Знакомство",
    },
  },
  {
    label: "Влюбленность",
    stats: {
      trust: 80,
      affection: 85,
      closeness: 70,
      tension: 25,
      conflict: 0,
      statusTitle: "Растущая близость",
    },
  },
  {
    label: "Нерушимая связь",
    stats: {
      trust: 100,
      affection: 100,
      closeness: 100,
      tension: 35,
      conflict: 0,
      statusTitle: "Нерушимая связь",
    },
  },
];

const emptyCharacter = (): Character => ({
  id: newId(),
  name: "",
  avatarUrl: "",
  wallpaperUrl: "",
  tagline: "",
  genre: "",
  tags: [],
  description: "",
  personality: "",
  scenario: "",
  systemPrompt: "",
  firstMessage: "",
  initialStats: { ...DEFAULT_STATS },
  lorebook: [],
  createdAt: Date.now(),
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type TabType = "main" | "prompts" | "stats" | "lore";

const TABS: {
  key: TabType;
  label: string;
  icon: typeof User;
}[] = [
  { key: "main", label: "Инфо", icon: User },
  { key: "prompts", label: "Лор", icon: FileText },
  { key: "stats", label: "Статы", icon: Sliders },
  { key: "lore", label: "База", icon: BookOpen },
];

type StatKey =
  | "trust"
  | "affection"
  | "closeness"
  | "tension"
  | "conflict";

const STAT_FIELDS: {
  key: StatKey;
  label: string;
  color: string;
}[] = [
  {
    key: "trust",
    label: "Доверие (Trust)",
    color: "var(--relationship-trust)",
  },
  {
    key: "affection",
    label: "Привязанность (Affection)",
    color: "var(--relationship-affection)",
  },
  {
    key: "closeness",
    label: "Близость (Closeness)",
    color: "var(--relationship-closeness)",
  },
  {
    key: "tension",
    label: "Напряжение / Саспенс (Tension)",
    color: "var(--relationship-tension)",
  },
  {
    key: "conflict",
    label: "Конфликт / Злость (Conflict)",
    color: "var(--relationship-conflict)",
  },
];

interface EditorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  hint?: string;
}

function EditorField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 4,
  required = false,
  hint,
}: EditorFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-content-secondary"
      >
        {label}
        {required && <span className="ml-1 text-accent">*</span>}
      </label>

      {multiline ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          required={required}
          aria-describedby={hint ? hintId : undefined}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="input-field resize-y text-sm"
        />
      ) : (
        <input
          id={id}
          value={value}
          required={required}
          aria-describedby={hint ? hintId : undefined}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="input-field text-sm"
        />
      )}

      {hint && (
        <p id={hintId} className="mt-1 text-xs text-content-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

interface LoreEntryEditorProps {
  entry: LorebookEntry;
  index: number;
  onUpdate: (patch: Partial<LorebookEntry>) => void;
  onRemove: () => void;
}

function LoreEntryEditor({
  entry,
  index,
  onUpdate,
  onRemove,
}: LoreEntryEditorProps) {
  const entryTitle = `Запись ${index + 1}`;

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-surface-2 p-3.5 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs sm:text-sm font-semibold text-content">{entryTitle}</h4>

        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={entry.isActive}
            onClick={() => onUpdate({ isActive: !entry.isActive })}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-xl border px-2 py-1 text-xs font-medium transition-all",
              entry.isActive
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-white/[0.08] bg-surface text-content-muted"
            )}
          >
            <span
              className={cn(
                "flex h-3 w-3 items-center justify-center rounded border",
                entry.isActive
                  ? "border-accent bg-accent text-on-accent"
                  : "border-control-border"
              )}
            >
              {entry.isActive && <Check size={9} strokeWidth={3} />}
            </span>
            <span className="text-[11px]">{entry.isActive ? "Вкл" : "Выкл"}</span>
          </button>

          <button
            type="button"
            onClick={onRemove}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-content-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <EditorField
          label="Ключи через запятую"
          value={entry.keys.join(", ")}
          onChange={(val) =>
            onUpdate({ keys: val.split(",").map((k) => k.trim()) })
          }
          placeholder="кафе, свидание, артефакт"
        />

        <EditorField
          label="Содержание записи"
          value={entry.content}
          onChange={(content) => onUpdate({ content })}
          placeholder="Описание факта или воспоминания..."
          multiline
          rows={3}
        />
      </div>
    </section>
  );
}

export function CharacterEditor({
  open,
  onClose,
  onSave,
  initial,
}: Props) {
  const [draft, setDraft] = useState<Character>(
    () => initial ?? emptyCharacter()
  );
  const [activeTab, setActiveTab] = useState<TabType>("main");
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedWallpaper, setFailedWallpaper] = useState<string | null>(null);

  const [showPresetsPicker, setShowPresetsPicker] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const editorId = useId();

  useEffect(() => {
    if (open) {
      setDraft(
        initial ? { ...emptyCharacter(), ...initial } : emptyCharacter()
      );
      setActiveTab("main");
      setError(null);
      setShowPresetsPicker(false);
    }
  }, [open, initial]);

  const update = <K extends keyof Character>(key: K, value: Character[K]) => {
    setDraft((curr) => ({ ...curr, [key]: value }));
  };

  const updateStats = (patch: Partial<RelationshipStats>) => {
    setDraft((curr) => ({
      ...curr,
      initialStats: { ...curr.initialStats, ...patch },
    }));
  };

  const updateLore = (id: string, patch: Partial<LorebookEntry>) => {
    setDraft((curr) => ({
      ...curr,
      lorebook: curr.lorebook.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    }));
  };

  const addLore = () => {
    setDraft((curr) => ({
      ...curr,
      lorebook: [
        ...curr.lorebook,
        { id: newId(), keys: [], content: "", isActive: true },
      ],
    }));
  };

  const removeLore = (id: string) => {
    setDraft((curr) => ({
      ...curr,
      lorebook: curr.lorebook.filter((e) => e.id !== id),
    }));
  };

  const handleApplyGenerated = (generated: Partial<Character>) => {
    setDraft((prev) => ({
      ...prev,
      ...generated,
      avatarUrl: prev.avatarUrl || generated.avatarUrl || "",
      wallpaperUrl: prev.wallpaperUrl || generated.wallpaperUrl || "",
      tags: generated.tags && generated.tags.length > 0 ? generated.tags : prev.tags,
      genre: generated.genre || prev.genre || "",
    }));
    setActiveTab("main");
  };

  const handleAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;

    try {
      const raw = await fileToDataUrl(file);
      setCropImage(raw);
    } catch {
      setError("Не удалось прочитать изображение аватара.");
    } finally {
      e.currentTarget.value = "";
    }
  };

  const handleWallpaperFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;

    try {
      const raw = await fileToDataUrl(file);
      update("wallpaperUrl", raw);
    } catch {
      setError("Не удалось прочитать фоновое изображение.");
    } finally {
      e.currentTarget.value = "";
    }
  };

  const canSave = Boolean(draft.name.trim() && draft.firstMessage.trim());

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);

    try {
      await onSave(draft);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить персонажа."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % TABS.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + TABS.length) % TABS.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActiveTab(TABS[nextIndex].key);
  };

  const showWallpaper =
    Boolean(draft.wallpaperUrl) && failedWallpaper !== draft.wallpaperUrl;

  const settingCategory = TAG_CATEGORIES.find((c) => c.id === "setting");
  const baseGenres = settingCategory ? settingCategory.tags.map((t) => t.name) : [];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={initial ? "Редактировать персонажа" : "Создать персонажа"}
        variant="sheet"
        size="lg"
      >
        <div className="space-y-5 sm:space-y-6">
          <button
            type="button"
            onClick={() => setGeneratorOpen(true)}
            className="flex min-h-12 sm:min-h-14 w-full items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-3.5 py-2.5 sm:px-4 sm:py-3 text-left transition-all hover:border-accent hover:bg-accent/15"
          >
            <span className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent">
              <Sparkles size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-xs sm:text-sm font-bold text-zinc-100">
                AI-генератор персонажа
              </span>
              <span className="block text-[11px] sm:text-xs text-content-secondary">
                Сгенерировать образ и предысторию по задумке
              </span>
            </div>
          </button>

          {/* Вкладки: оптимизированы для мобильных, исключен перенос букв */}
          <div
            ref={tabListRef}
            role="tablist"
            className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1 border border-white/[0.06]"
          >
            {TABS.map(({ key, label, icon: Icon }, index) => {
              const selected = activeTab === key;

              return (
                <button
                  key={key}
                  id={`${editorId}-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(key)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className={cn(
                    "flex min-h-9 sm:min-h-11 items-center justify-center gap-1 sm:gap-1.5 rounded-xl px-1 sm:px-2 py-1.5 transition-all",
                    selected
                      ? "bg-accent/15 text-accent shadow-sm"
                      : "text-content-muted hover:text-content hover:bg-white/[0.04]"
                  )}
                >
                  <Icon size={14} className="sm:size-4 shrink-0" />
                  <span className="text-[11px] sm:text-xs font-semibold whitespace-nowrap">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="min-w-0">
            {activeTab === "main" && (
              <div className="space-y-4 sm:space-y-5">
                <div className="grid gap-4 sm:gap-6 sm:grid-cols-[100px_minmax(0,1fr)]">
                  <div>
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-content-secondary">
                      Аватар
                    </span>
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="group relative inline-flex rounded-full"
                    >
                      <Avatar
                        src={draft.avatarUrl}
                        name={draft.name || "?"}
                        size={80}
                      />
                      <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-xl border-2 border-surface bg-accent text-on-accent">
                        <ImagePlus size={15} />
                      </span>
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarFile}
                    />
                  </div>

                  <div className="min-w-0 space-y-3 sm:space-y-4">
                    <EditorField
                      label="Имя персонажа"
                      required
                      value={draft.name}
                      onChange={(value) => update("name", value)}
                      placeholder="Имя персонажа"
                    />

                    <EditorField
                      label="Краткий статус (Слоган)"
                      value={draft.tagline}
                      onChange={(value) => update("tagline", value)}
                      placeholder="Например: Соседка по общежитию"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-content-secondary">
                      Жанр / Сеттинг
                    </label>
                    <input
                      list={`${editorId}-genres-list`}
                      className="input-field text-sm"
                      value={draft.genre || ""}
                      onChange={(e) => update("genre", e.target.value)}
                      placeholder="Выберите или введите сеттинг..."
                    />
                    <datalist id={`${editorId}-genres-list`}>
                      {baseGenres.map((g) => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
                  </div>

                  <EditorField
                    label="Теги (через запятую)"
                    value={(draft.tags || []).join(", ")}
                    onChange={(val) =>
                      update(
                        "tags",
                        val.split(",").map((t) => t.trim()).filter(Boolean)
                      )
                    }
                    placeholder="Например: Студенчество, Друзья детства"
                  />
                </div>

                {/* Секция фона: на мобильном заголовок и кнопки разделены на строки */}
                <section className="border-t border-white/[0.07] pt-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
                      Фоновое изображение чата
                    </h3>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowPresetsPicker((p) => !p)}
                        className={cn(
                          "inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0",
                          showPresetsPicker
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-white/[0.08] bg-surface-2 text-zinc-200 hover:bg-surface-3"
                        )}
                      >
                        <Palette size={14} />
                        <span>Заготовки</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => wallpaperInputRef.current?.click()}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-surface-3 whitespace-nowrap shrink-0"
                      >
                        <ImagePlus size={14} />
                        <span>{draft.wallpaperUrl ? "Свой файл" : "Выбрать файл"}</span>
                      </button>
                    </div>
                  </div>

                  {showPresetsPicker && (
                    <div className="mb-3 rounded-2xl border border-white/[0.08] bg-surface-2 p-2.5 sm:p-3">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {WALLPAPER_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              update("wallpaperUrl", p.url);
                              setShowPresetsPicker(false);
                            }}
                            className={cn(
                              "group flex flex-col overflow-hidden rounded-xl border text-left transition-all",
                              draft.wallpaperUrl === p.url
                                ? "border-accent ring-1 ring-accent"
                                : "border-white/[0.06] hover:border-white/[0.15]"
                            )}
                          >
                            <div className="aspect-[16/9] w-full bg-black">
                              <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                            </div>
                            <span className="truncate bg-surface-3 px-2 py-1 text-[11px] font-medium text-zinc-300 group-hover:text-accent">
                              {p.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <input
                    ref={wallpaperInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleWallpaperFile}
                  />

                  {showWallpaper ? (
                    <div className="aspect-[3/1] min-h-20 overflow-hidden rounded-2xl border border-white/[0.07] bg-surface-2">
                      <img
                        src={draft.wallpaperUrl}
                        alt="Выбранный фон"
                        onError={() => setFailedWallpaper(draft.wallpaperUrl ?? null)}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/[0.08] p-3 text-center text-xs text-content-muted">
                      Фон для чата не выбран.
                    </div>
                  )}
                </section>

                <EditorField
                  label="Первое приветственное сообщение"
                  required
                  value={draft.firstMessage}
                  onChange={(val) => update("firstMessage", val)}
                  placeholder="*Входит в комнату и неловко улыбается...* — Привет, не помешаю?"
                  multiline
                  rows={4}
                />
              </div>
            )}

            {activeTab === "prompts" && (
              <div className="space-y-3.5 sm:space-y-4">
                <EditorField
                  label="1. Характер и повадки (Personality)"
                  value={draft.personality || ""}
                  onChange={(val) => update("personality", val)}
                  placeholder="Застенчивая, искренняя, говорит мягко..."
                  multiline
                  rows={3}
                />

                <EditorField
                  label="2. Сценарий и завязка (Scenario / Context)"
                  value={draft.scenario || ""}
                  onChange={(val) => update("scenario", val)}
                  placeholder="Вы живете на одном этаже общежития..."
                  multiline
                  rows={3}
                />

                <EditorField
                  label="3. Внешность (Description)"
                  value={draft.description || ""}
                  onChange={(val) => update("description", val)}
                  placeholder="Рост 165 см, темно-русые волосы..."
                  multiline
                  rows={3}
                />

                <EditorField
                  label="4. Системные правила (System Rules)"
                  value={draft.systemPrompt}
                  onChange={(val) => update("systemPrompt", val)}
                  placeholder="Пиши живо, используй естественные паузы..."
                  multiline
                  rows={3}
                />
              </div>
            )}

            {activeTab === "stats" && (
              <div className="space-y-4 sm:space-y-5">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-secondary">
                    Быстрые пресеты связи
                  </h3>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {PRESET_RELATIONS.map((preset) => (
                      <button
                        type="button"
                        key={preset.label}
                        onClick={() => updateStats(preset.stats)}
                        className="rounded-xl border border-white/[0.08] bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:border-accent/40 hover:text-accent"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <EditorField
                  label="Статус отношений"
                  value={draft.initialStats.statusTitle}
                  onChange={(val) => updateStats({ statusTitle: val })}
                  placeholder="Например: Знакомство"
                />

                <div className="space-y-3.5 border-t border-white/[0.07] pt-4">
                  {STAT_FIELDS.map(({ key, label, color }) => (
                    <div key={key}>
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-content-secondary">{label}</span>
                        <span className="font-semibold tabular-nums" style={{ color }}>
                          {draft.initialStats[key]}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={draft.initialStats[key]}
                        onChange={(e) =>
                          updateStats({ [key]: Number(e.target.value) })
                        }
                        className="block h-8 w-full"
                        style={{ accentColor: color }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "lore" && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs sm:text-sm font-bold text-zinc-100">
                    Записи Lorebook ({draft.lorebook.length})
                  </h3>
                  <button
                    type="button"
                    onClick={addLore}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
                  >
                    <Plus size={14} />
                    <span>Добавить</span>
                  </button>
                </div>

                {draft.lorebook.length > 0 ? (
                  <div className="space-y-2.5 sm:space-y-3">
                    {draft.lorebook.map((entry, index) => (
                      <LoreEntryEditor
                        key={entry.id}
                        entry={entry}
                        index={index}
                        onUpdate={(p) => updateLore(entry.id, p)}
                        onRemove={() => removeLore(entry.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/[0.08] p-6 text-center text-xs text-content-muted">
                    Факты о мире пока не добавлены.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.07] pt-3.5 sm:pt-4">
            {error && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[11px] sm:text-xs text-content-muted">
                Имя и приветствие обязательны
              </span>

              <button
                type="button"
                disabled={!canSave || saving}
                onClick={() => void handleSave()}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] hover:bg-accent-hover disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Save size={15} />
                )}
                <span>Сохранить</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ImageCropperModal
        open={!!cropImage}
        imageSrc={cropImage}
        onClose={() => setCropImage(null)}
        onCropComplete={(cropped) => {
          setCropImage(null);
          update("avatarUrl", cropped);
        }}
      />

      <CharacterGeneratorModal
        open={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        onApply={handleApplyGenerated}
      />
    </>
  );
}