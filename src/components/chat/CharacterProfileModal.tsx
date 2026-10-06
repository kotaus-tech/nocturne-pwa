import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  User,
  Sparkles,
  ScrollText,
  Heart,
  Brain,
  Calendar,
  Trash2,
  Loader2,
  Wand2,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  Pencil,
  Check,
  X,
  RotateCw,
  AlertTriangle,
  Copy,
  Info,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { Avatar } from "../common/Avatar";
import { ImagePromptModal } from "../common/ImagePromptModal";
import type { Character, ChatSession } from "../../types";
import {
  MemoryExtractionError,
  type ChronicleRefreshSummary,
  type MemoryRefreshSummary,
} from "../../services/memoryEngine";
import { copyTextToClipboard } from "../../utils/clipboard";
import { cn } from "../../utils/cn";

/**
 * Сообщение под вкладками персонажа. Общее для всех вкладок (Память, Дневник,
 * Хроника): раньше ошибка рисовалась только внутри вкладки «Память», а кнопка
 * «Актуализировать» есть ещё и в «Дневнике» — поэтому сбой выглядел как
 * «покрутилось и ничего не произошло».
 */
type MemoryFeedback = {
  kind: "error" | "success" | "info";
  text: string;
  /** Сырой ответ модели — показываем, когда он есть: причина видна без консоли. */
  raw?: string;
};

/** Склонение: 1 якорь, 2 якоря, 5 якорей. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  session: ChatSession;
  messageCount?: number;
  onManualExtractMemory?: () => Promise<MemoryRefreshSummary | null>;
  onRebuildChronicle?: () => Promise<ChronicleRefreshSummary | null>;
  onDeleteFact?: (factId: string) => void;
  onAddFact?: (content: string) => void;
  onTogglePinFact?: (factId: string) => void;
  onUpdateFact?: (factId: string, content: string) => void;
  onDeleteStoryEvent?: (eventId: string) => void;
  onDeleteDiaryEntry?: (entryId: string) => void;
}

type ProfileTab = "bio" | "story" | "diary" | "facts";

const TABS: {
  key: ProfileTab;
  label: string;
  icon: typeof User;
}[] = [
  { key: "bio", label: "Анкета", icon: User },
  { key: "story", label: "Хроника", icon: ScrollText },
  { key: "diary", label: "Дневник", icon: Heart },
  { key: "facts", label: "Память", icon: Brain },
];

function getMessageNoun(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 19) return "сообщений";
  if (mod10 === 1) return "сообщение";
  if (mod10 >= 2 && mod10 <= 4) return "сообщения";
  return "сообщений";
}

interface EmptyStateProps {
  icon: typeof User;
  title: string;
  description?: string;
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-3 py-9 text-center">
      <span
        aria-hidden="true"
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"
      >
        <Icon size={23} strokeWidth={1.6} />
      </span>

      <p className="text-base font-medium text-content-secondary">
        {title}
      </p>

      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-content-muted">
          {description}
        </p>
      )}
    </div>
  );
}

const ACTION_BUTTON = [
  "inline-flex min-h-11 items-center justify-center gap-2",
  "rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5",
  "text-sm font-medium text-content-secondary",
  "transition-colors hover:bg-surface-3 hover:text-content",
  "disabled:opacity-40 motion-reduce:transition-none",
].join(" ");

const ICON_BUTTON = [
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
  "text-content-muted transition-colors",
  "hover:bg-surface-3 hover:text-content",
  "motion-reduce:transition-none",
].join(" ");

export function CharacterProfileModal({
  open,
  onClose,
  character,
  session,
  messageCount = 0,
  onManualExtractMemory,
  onRebuildChronicle,
  onDeleteFact,
  onAddFact,
  onTogglePinFact,
  onUpdateFact,
  onDeleteStoryEvent,
  onDeleteDiaryEntry,
}: Props) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("bio");
  const [loadingExtract, setLoadingExtract] = useState(false);
  const [loadingChronicle, setLoadingChronicle] = useState(false);
  const [memoryFeedback, setMemoryFeedback] = useState<MemoryFeedback | null>(null);
  const [chronicleFeedback, setChronicleFeedback] = useState<MemoryFeedback | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [newFactContent, setNewFactContent] = useState("");

  const [editingFactId, setEditingFactId] = useState<string | null>(
    null
  );
  const [editFactContent, setEditFactContent] = useState("");

  const id = useId();
  const tabListRef = useRef<HTMLDivElement>(null);

  const diary = session.diary || [];
  const storyLog = session.storyLog || [];

  // Существующая сортировка: закреплённые факты первыми.
  const facts = [...(session.extractedFacts || [])].sort((a, b) => {
    if (Boolean(a.isPinned) === Boolean(b.isPinned)) return 0;
    return a.isPinned ? -1 : 1;
  });

  const handleExtract = async () => {
    if (!onManualExtractMemory || loadingExtract) return;

    setLoadingExtract(true);
    setMemoryFeedback(null);
    setCopiedRaw(false);

    try {
      const result = await onManualExtractMemory();

      if (!result) {
        setMemoryFeedback({
          kind: "info",
          text: "Данные этой ветки ещё не загрузились — попробуйте ещё раз.",
        });
      } else if (result.skippedReason) {
        setMemoryFeedback({ kind: "info", text: result.skippedReason });
      } else {
        const parts = [
          `${result.facts} ${plural(result.facts, "якорь", "якоря", "якорей")}`,
        ];
        if (result.diaryEntries > 0) parts.push("запись в дневник");
        if (result.hasSceneEvent) parts.push("событие сцены");
        setMemoryFeedback({
          kind: "success",
          text: `Память обновлена: ${parts.join(" · ")}.`,
        });
      }
    } catch (cause) {
      // Раньше ошибка уходила в никуда: индикатор гас, а разделы памяти
      // оставались прежними — со стороны это выглядело как «кнопка не работает».
      setMemoryFeedback({
        kind: "error",
        text:
          cause instanceof Error && cause.message
            ? cause.message
            : "Не удалось обновить память и дневник.",
        raw:
          cause instanceof MemoryExtractionError && cause.rawAnswer
            ? cause.rawAnswer
            : undefined,
      });
    } finally {
      setLoadingExtract(false);
    }
  };

  const handleRebuildChronicleClick = async () => {
    if (!onRebuildChronicle || loadingChronicle) return;

    setLoadingChronicle(true);
    setChronicleFeedback(null);
    setCopiedRaw(false);

    try {
      const result = await onRebuildChronicle();

      if (!result) {
        setChronicleFeedback({
          kind: "info",
          text: "Данные этой ветки ещё не загрузились — попробуйте ещё раз.",
        });
      } else if (result.skippedReason) {
        setChronicleFeedback({ kind: "info", text: result.skippedReason });
      } else {
        setChronicleFeedback({
          kind: "success",
          text: `Хроника обновлена: ${result.episodes} ${plural(
            result.episodes,
            "эпизод",
            "эпизода",
            "эпизодов"
          )}.`,
        });
      }
    } catch (cause) {
      setChronicleFeedback({
        kind: "error",
        text:
          cause instanceof Error && cause.message
            ? cause.message
            : "Не удалось собрать хронику по диалогу.",
        raw:
          cause instanceof MemoryExtractionError && cause.rawAnswer
            ? cause.rawAnswer
            : undefined,
      });
    } finally {
      setLoadingChronicle(false);
    }
  };

  const handleAddManualFact = (event: FormEvent) => {
    event.preventDefault();

    if (!newFactContent.trim() || !onAddFact) return;

    onAddFact(newFactContent.trim());
    setNewFactContent("");
  };

  const handleStartEdit = (factId: string, content: string) => {
    setEditingFactId(factId);
    setEditFactContent(content);
  };

  const handleCancelEdit = () => {
    setEditingFactId(null);
    setEditFactContent("");
  };

  const handleSaveEdit = (factId: string) => {
    if (!editFactContent.trim() || !onUpdateFact) return;

    onUpdateFact(factId, editFactContent.trim());
    setEditingFactId(null);
    setEditFactContent("");
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
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = TABS.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    setActiveTab(TABS[nextIndex].key);

    const buttons =
      tabListRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='tab']"
      );

    buttons?.[nextIndex]?.focus({ preventScroll: true });
  };

  const hasBio = Boolean(
    character.description ||
      character.personality ||
      character.scenario
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        variant="sheet"
        size="lg"
        title="Профиль и Память"
      >
        <div className="space-y-6">
          <header>
            <div className="flex items-start gap-4">
              <Avatar
                src={character.avatarUrl}
                name={character.name}
                size={76}
                ring
              />

              <div className="min-w-0 flex-1 py-1">
                <h3 className="text-2xl font-semibold leading-tight tracking-tight text-content [overflow-wrap:anywhere]">
                  {character.name}
                </h3>

                {character.tagline && (
                  <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                    {character.tagline}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="inline-flex items-center gap-2 text-sm text-content-muted">
                <MessageSquare
                  size={17}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <span className="tabular-nums">
                  {messageCount} {getMessageNoun(messageCount)}
                </span>
              </p>

              <button
                type="button"
                onClick={() => setPromptModalOpen(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/15 motion-reduce:transition-none"
              >
                <Wand2 size={17} aria-hidden="true" />
                Промпт для арта
              </button>
            </div>
          </header>

          <div
            ref={tabListRef}
            role="tablist"
            aria-label="Разделы профиля и памяти"
            className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1"
          >
            {TABS.map(({ key, label, icon: Icon }, index) => {
              const selected = activeTab === key;

              return (
                <button
                  key={key}
                  id={`${id}-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${id}-panel-${key}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveTab(key)}
                  onKeyDown={(event) =>
                    handleTabKeyDown(event, index)
                  }
                  className={cn(
                    "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1.5",
                    "rounded-xl px-1 py-2 text-xs font-medium",
                    "transition-colors motion-reduce:transition-none",
                    "sm:min-h-12 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm",
                    selected
                      ? "bg-surface-3 text-accent"
                      : "text-content-muted hover:bg-[var(--state-hover)] hover:text-content"
                  )}
                >
                  <Icon
                    size={18}
                    strokeWidth={1.7}
                    aria-hidden="true"
                    className="shrink-0"
                  />
                  <span className="[overflow-wrap:anywhere]">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            id={`${id}-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${activeTab}`}
            tabIndex={0}
            className="min-w-0 rounded-xl"
          >
            {/* Итог обновления виден из любой вкладки: кнопка «Актуализировать»
                есть и в «Дневнике», и в «Памяти», и в «Хронике», поэтому ошибка
                не должна прятаться в одной из них. */}
            {[chronicleFeedback, memoryFeedback]
              .filter((item): item is MemoryFeedback => Boolean(item))
              .map((item, index) => (
                <div
                  key={`${item.kind}-${index}`}
                  role={item.kind === "error" ? "alert" : "status"}
                  className={cn(
                    "mb-5 rounded-xl border p-3.5",
                    item.kind === "error" && "border-danger/30 bg-danger/5",
                    item.kind === "success" && "border-success/30 bg-success/5",
                    item.kind === "info" && "border-border bg-surface-2"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    {item.kind === "error" ? (
                      <AlertTriangle
                        size={16}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-danger"
                      />
                    ) : item.kind === "success" ? (
                      <Check
                        size={16}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-success"
                      />
                    ) : (
                      <Info
                        size={16}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-content-muted"
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm leading-relaxed",
                          item.kind === "error" ? "text-danger" : "text-content"
                        )}
                      >
                        {item.text}
                      </p>

                      {item.raw && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => {
                              void copyTextToClipboard(item.raw || "");
                              setCopiedRaw(true);
                              window.setTimeout(() => setCopiedRaw(false), 2000);
                            }}
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-content-secondary hover:bg-surface-3"
                          >
                            {copiedRaw ? (
                              <Check size={13} aria-hidden="true" className="text-success" />
                            ) : (
                              <Copy size={13} aria-hidden="true" />
                            )}
                            {copiedRaw ? "Скопировано" : "Скопировать ответ модели"}
                          </button>
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-3 p-2.5 text-xs leading-relaxed text-content-secondary">
                            {item.raw.slice(0, 4000)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

            {activeTab === "bio" && (
              <div className="space-y-6">
                {hasBio ? (
                  <>
                    {character.description && (
                      <section>
                        <h4 className="mb-3 flex items-center gap-2 text-base font-semibold text-content">
                          <User
                            size={18}
                            aria-hidden="true"
                            className="text-accent"
                          />
                          Внешность и описание
                        </h4>

                        <p className="whitespace-pre-wrap text-base leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                          {character.description}
                        </p>
                      </section>
                    )}

                    {character.personality && (
                      <section>
                        <h4 className="mb-3 flex items-center gap-2 text-base font-semibold text-content">
                          <Sparkles
                            size={18}
                            aria-hidden="true"
                            className="text-accent"
                          />
                          Характер и повадки
                        </h4>

                        <p className="whitespace-pre-wrap text-base leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                          {character.personality}
                        </p>
                      </section>
                    )}

                    {character.scenario && (
                      <section>
                        <h4 className="mb-3 flex items-center gap-2 text-base font-semibold text-content">
                          <ScrollText
                            size={18}
                            aria-hidden="true"
                            className="text-accent"
                          />
                          Сценарий
                        </h4>

                        <p className="whitespace-pre-wrap text-base leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                          {character.scenario}
                        </p>
                      </section>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={User}
                    title="Подробная анкета пока не заполнена"
                    description="Описание, характер и сценарий можно заполнить в редакторе персонажа."
                  />
                )}
              </div>
            )}

            {activeTab === "story" && (
              <div>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <h4 className="text-base font-semibold text-content">
                    Летопись сюжета
                    <span className="ml-2 text-sm font-normal tabular-nums text-content-muted">
                      {storyLog.length} эпизодов
                    </span>
                  </h4>

                  <button
                    type="button"
                    onClick={() => void handleRebuildChronicleClick()}
                    disabled={loadingChronicle || !onRebuildChronicle}
                    aria-busy={loadingChronicle}
                    className={ACTION_BUTTON}
                    title="Проанализировать весь чат и восстановить 50-70+ подробных эпизодов"
                  >
                    {loadingChronicle ? (
                      <Loader2
                        size={17}
                        aria-hidden="true"
                        className="shrink-0 animate-spin"
                      />
                    ) : (
                      <RotateCw
                        size={17}
                        aria-hidden="true"
                        className="shrink-0"
                      />
                    )}
                    Сгенерировать по диалогу
                  </button>
                </div>

                {loadingChronicle && (
                  <p
                    role="status"
                    className="mb-4 text-sm leading-relaxed text-content-secondary"
                  >
                    Формируем хронику по истории диалога…
                  </p>
                )}

                {storyLog.length === 0 ? (
                  <div>
                    <EmptyState
                      icon={ScrollText}
                      title="Хроника пока пуста"
                      description="Нейросеть может проанализировать все сообщения и сформировать подробную хронику эпизодов."
                    />

                    <button
                      type="button"
                      onClick={() =>
                        void handleRebuildChronicleClick()
                      }
                      disabled={
                        loadingChronicle || !onRebuildChronicle
                      }
                      className="mx-auto flex min-h-12 max-w-full items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/15 disabled:opacity-40 motion-reduce:transition-none"
                    >
                      {loadingChronicle ? (
                        <Loader2
                          size={18}
                          aria-hidden="true"
                          className="shrink-0 animate-spin"
                        />
                      ) : (
                        <Sparkles
                          size={18}
                          aria-hidden="true"
                          className="shrink-0"
                        />
                      )}

                      <span>
                        Сгенерировать Хронику ({messageCount} сообщ.)
                      </span>
                    </button>
                  </div>
                ) : (
                  <ol className="space-y-5">
                    {storyLog.map((event, index) => (
                      <li
                        key={event.id}
                        className="border-l-2 border-accent/25 pl-4 sm:pl-5"
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0 py-2">
                            <p className="text-sm font-semibold text-accent">
                              Эпизод #{index + 1}
                            </p>

                            {!!event.timestamp && (
                              <p className="mt-1 text-xs leading-relaxed tabular-nums text-content-muted">
                                {new Date(
                                  event.timestamp
                                ).toLocaleDateString("ru-RU", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            )}
                          </div>

                          {onDeleteStoryEvent && (
                            <button
                              type="button"
                              onClick={() =>
                                onDeleteStoryEvent(event.id)
                              }
                              aria-label={`Удалить эпизод ${index + 1} из хроники`}
                              title="Удалить запись из хроники"
                              className={cn(
                                ICON_BUTTON,
                                "hover:bg-danger/10 hover:text-danger"
                              )}
                            >
                              <Trash2 size={17} aria-hidden="true" />
                            </button>
                          )}
                        </div>

                        <p className="whitespace-pre-wrap text-base leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                          {event.text}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {activeTab === "diary" && (
              <div>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <h4 className="text-base font-semibold text-content">
                      Тайный дневник
                    </h4>

                    <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                      Мысли о вас и прошедших сценах.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleExtract()}
                    disabled={
                      loadingExtract || !onManualExtractMemory
                    }
                    aria-busy={loadingExtract}
                    className={ACTION_BUTTON}
                  >
                    {loadingExtract ? (
                      <Loader2
                        size={17}
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : (
                      <Sparkles size={17} aria-hidden="true" />
                    )}
                    Записать мысль
                  </button>
                </div>

                {loadingExtract && (
                  <p
                    role="status"
                    className="mb-4 text-sm text-content-secondary"
                  >
                    Обрабатываем память и дневник…
                  </p>
                )}

                {diary.length === 0 ? (
                  <EmptyState
                    icon={Heart}
                    title="В дневнике пока нет записей"
                    description="Они формируются автоматически каждые 8 сообщений или по кнопке «Записать мысль»."
                  />
                ) : (
                  <div className="space-y-4">
                    {diary
                      .slice()
                      .reverse()
                      .map((entry) => (
                        <section
                          key={entry.id}
                          className="rounded-2xl bg-surface-2 p-4 sm:p-5"
                        >
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <h5 className="inline-flex items-center gap-2 text-sm font-medium text-[var(--relationship-affection)]">
                              <Calendar
                                size={16}
                                aria-hidden="true"
                              />
                              Запись #{entry.entryNumber}
                            </h5>

                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              {entry.mood && (
                                <span className="max-w-full text-xs font-medium leading-relaxed text-content-muted [overflow-wrap:anywhere]">
                                  {entry.mood}
                                </span>
                              )}

                              {onDeleteDiaryEntry && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onDeleteDiaryEntry(entry.id)
                                  }
                                  aria-label={`Удалить запись дневника ${entry.entryNumber}`}
                                  title="Удалить запись"
                                  className={cn(
                                    ICON_BUTTON,
                                    "hover:bg-danger/10 hover:text-danger"
                                  )}
                                >
                                  <Trash2
                                    size={17}
                                    aria-hidden="true"
                                  />
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="novel-font whitespace-pre-wrap text-lg italic leading-[1.8] text-content [overflow-wrap:anywhere]">
                            «{entry.thought}»
                          </p>
                        </section>
                      ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "facts" && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <h4 className="text-base font-semibold text-content">
                      Активные якоря памяти
                    </h4>

                    <p className="mt-2 text-sm leading-relaxed text-content-muted">
                      До 18 фактов
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleExtract()}
                    disabled={
                      loadingExtract || !onManualExtractMemory
                    }
                    aria-busy={loadingExtract}
                    className={ACTION_BUTTON}
                  >
                    {loadingExtract ? (
                      <Loader2
                        size={17}
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : (
                      <Brain size={17} aria-hidden="true" />
                    )}
                    Актуализировать
                  </button>
                </div>

                {loadingExtract && (
                  <p
                    role="status"
                    className="text-sm text-content-secondary"
                  >
                    Обрабатываем память и дневник…
                  </p>
                )}

                <form
                  onSubmit={handleAddManualFact}
                  className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4"
                >
                  <label
                    htmlFor={`${id}-new-fact`}
                    className="block text-sm font-medium text-content-secondary"
                  >
                    Новый факт
                  </label>

                  <textarea
                    id={`${id}-new-fact`}
                    rows={3}
                    placeholder="Впишите факт или важную деталь..."
                    value={newFactContent}
                    onChange={(event) =>
                      setNewFactContent(event.target.value)
                    }
                    className="input-field resize-y"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs leading-relaxed text-content-muted">
                      Перенос строк поддерживается.
                    </p>

                    <button
                      type="submit"
                      disabled={
                        !newFactContent.trim() || !onAddFact
                      }
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 motion-reduce:transition-none"
                    >
                      <Plus size={17} aria-hidden="true" />
                      Добавить факт
                    </button>
                  </div>
                </form>

                {facts.length === 0 ? (
                  <EmptyState
                    icon={Brain}
                    title="Пока нет сохранённых фактов"
                    description="В процессе общения персонаж сохраняет важные моменты. Вы также можете добавить факт вручную."
                  />
                ) : (
                  <div className="space-y-4">
                    {facts.map((fact, index) => {
                      const isEditing = editingFactId === fact.id;
                      const editId = `${id}-edit-fact-${index}`;

                      return (
                        <section
                          key={fact.id}
                          className={cn(
                            "rounded-2xl border p-4",
                            fact.isPinned
                              ? "border-accent/35 bg-accent/5"
                              : "border-border bg-surface-2"
                          )}
                        >
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            {fact.isPinned && (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
                                <Pin size={13} aria-hidden="true" />
                                Закреплено
                              </span>
                            )}

                            {fact.keys.map((key, keyIndex) => (
                              <span
                                key={keyIndex}
                                className="max-w-full rounded-md bg-surface-3 px-2 py-1 text-xs leading-relaxed text-content-muted [overflow-wrap:anywhere]"
                              >
                                #{key}
                              </span>
                            ))}
                          </div>

                          {isEditing ? (
                            <div className="space-y-3">
                              <label
                                htmlFor={editId}
                                className="block text-sm font-medium text-content-secondary"
                              >
                                Текст факта
                              </label>

                              <textarea
                                id={editId}
                                rows={4}
                                value={editFactContent}
                                onChange={(event) =>
                                  setEditFactContent(event.target.value)
                                }
                                className="input-field resize-y"
                                autoFocus
                              />

                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={handleCancelEdit}
                                  className={ACTION_BUTTON}
                                >
                                  <X size={17} aria-hidden="true" />
                                  Отмена
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSaveEdit(fact.id)
                                  }
                                  disabled={!editFactContent.trim()}
                                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 motion-reduce:transition-none"
                                >
                                  <Check
                                    size={17}
                                    aria-hidden="true"
                                  />
                                  Сохранить
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="whitespace-pre-wrap text-base leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                                {fact.content}
                              </p>

                              <div className="mt-3 flex flex-wrap items-center gap-1">
                                {onTogglePinFact && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onTogglePinFact(fact.id)
                                    }
                                    aria-pressed={!!fact.isPinned}
                                    aria-label={
                                      fact.isPinned
                                        ? "Открепить факт"
                                        : "Закрепить факт"
                                    }
                                    title={
                                      fact.isPinned
                                        ? "Открепить"
                                        : "Закрепить навсегда"
                                    }
                                    className={cn(
                                      ICON_BUTTON,
                                      fact.isPinned &&
                                        "text-accent hover:text-accent"
                                    )}
                                  >
                                    {fact.isPinned ? (
                                      <Pin
                                        size={17}
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <PinOff
                                        size={17}
                                        aria-hidden="true"
                                      />
                                    )}
                                  </button>
                                )}

                                {onUpdateFact && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleStartEdit(
                                        fact.id,
                                        fact.content
                                      )
                                    }
                                    aria-label="Редактировать факт"
                                    title="Редактировать текст"
                                    className={ICON_BUTTON}
                                  >
                                    <Pencil
                                      size={17}
                                      aria-hidden="true"
                                    />
                                  </button>
                                )}

                                {onDeleteFact && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onDeleteFact(fact.id)
                                    }
                                    aria-label="Удалить факт"
                                    title="Удалить факт"
                                    className={cn(
                                      ICON_BUTTON,
                                      "hover:bg-danger/10 hover:text-danger"
                                    )}
                                  >
                                    <Trash2
                                      size={17}
                                      aria-hidden="true"
                                    />
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ImagePromptModal
        open={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        character={character}
      />
    </>
  );
}