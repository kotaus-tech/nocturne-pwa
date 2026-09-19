import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Plus,
  Search,
  X,
  LayoutGrid,
  List,
  Loader2,
  Users,
  ChevronDown,
  Pin,
  Upload,
} from "lucide-react";
import { db, sanitizeCharacter, toggleCharacterFavorite } from "../../db";
import { CharacterEditor } from "./CharacterEditor";
import { CharacterSheet } from "./CharacterSheet";
import { CharacterImportModal } from "./CharacterImportModal";
import { CharacterGeneratorModal } from "./CharacterGeneratorModal";
import { GroupSceneModal } from "./GroupSceneModal";
import {
  GROUP_SIZE_MIN,
  type GeneratedGroup,
} from "../../services/characterGenerator";
import { createGroupSession } from "../../utils/sessionActions";
import { newId } from "../../utils/id";
import { Badge } from "../common/Badge";
import { FavoriteButton } from "../common/FavoriteButton";
import { Avatar } from "../common/Avatar";
import { DEFAULT_STATS } from "../../types";
import type { Character } from "../../types";
import { cn } from "../../utils/cn";

interface CharactersPageProps {
  /** Создали персонажа в режиме «Избранное» — просьба показать библиотеку целиком. */
  onRevealCreated?: () => void;
  onOpenSession: (sessionId: string) => void;
  favoritesOnly: boolean;
  createSignal: number;
}

/** Пустая карточка: генератор заполняет только то, что придумал. */
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

type SortOrder = "recommended" | "newest" | "name";
type ViewMode = "grid" | "list";

const NAME_COLLATOR = new Intl.Collator("ru", {
  sensitivity: "base",
  numeric: true,
});

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .trim();
}

export function CharactersPage({
  onRevealCreated,
  onOpenSession,
  favoritesOnly,
  createSignal,
}: CharactersPageProps) {
  const characters = useLiveQuery(
    () => db.characters.orderBy("createdAt").toArray(),
    []
  );

  const [query, setQuery] = useState("");

  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    const saved = localStorage.getItem("nocturne_sort_order");
    return (saved as SortOrder) || "recommended";
  });

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("nocturne_view_mode");
    return (saved as ViewMode) || "grid";
  });

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Character | null>(null);
  const [viewing, setViewing] = useState<Character | null>(null);

  const [importModalOpen, setImportModalOpen] = useState(false);
  // Групповая сцена: сначала выбор готовых героев, затем (по желанию) AI-генерация.
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupGeneratorOpen, setGroupGeneratorOpen] = useState(false);
  const [draggedFile, setDraggedFile] = useState<File | null>(null);
  const [isWindowDragOver, setIsWindowDragOver] = useState(false);

  const id = useId();

  const handleSortChange = (next: SortOrder) => {
    setSortOrder(next);
    localStorage.setItem("nocturne_sort_order", next);
  };

  const handleViewModeChange = (next: ViewMode) => {
    setViewMode(next);
    localStorage.setItem("nocturne_view_mode", next);
  };

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const previousCreateSignalRef = useRef(createSignal);
  useEffect(() => {
    if (createSignal !== previousCreateSignalRef.current) {
      previousCreateSignalRef.current = createSignal;
      openCreate();
    }
  }, [createSignal]);

  const normalizedQuery = normalizeSearch(query);
  const loading = characters === undefined;

  const visibleCharacters = useMemo(() => {
    if (!characters) return [];

    const filtered = characters.filter((character) => {
      if (favoritesOnly && !character.isFavorite) return false;

      if (!normalizedQuery) return true;

      const searchableText = normalizeSearch(
        [
          character.name,
          character.tagline,
          character.description ?? "",
          (character.tags ?? []).join(" "),
        ].join("\n")
      );

      return searchableText.includes(normalizedQuery);
    });

    return filtered.sort((a, b) => {
      const aPinned = !!a.isPinned;
      const bPinned = !!b.isPinned;
      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      if (sortOrder === "name") {
        return NAME_COLLATOR.compare(a.name, b.name);
      }
      if (sortOrder === "newest") {
        return b.createdAt - a.createdAt;
      }
      return a.createdAt - b.createdAt;
    });
  }, [characters, normalizedQuery, favoritesOnly, sortOrder]);

  /** Пишет карточку в базу, подстраховывая дату создания. */
  const persistCharacter = async (character: Character) => {
    await db.characters.put(
      sanitizeCharacter({
        ...character,
        createdAt: Number.isFinite(character.createdAt)
          ? character.createdAt
          : Date.now(),
      })
    );
  };

  const saveCharacter = async (character: Character) => {
    const isNew = !editing;

    // createdAt обязан быть числом: Dexie не показывает записи без ключа индекса
    // в orderBy("createdAt"), поэтому без страховки персонаж «терялся» в списке.
    await persistCharacter(character);

    // Персонаж создан в разделе «Избранное» — показываем его, а не пустой список.
    if (isNew && favoritesOnly && !character.isFavorite) {
      onRevealCreated?.();
    }

    setEditorOpen(false);
    setEditing(null);
  };

  /** Одиночный режим генератора, открытого из библиотеки: просто сохраняем героя. */
  const handleApplySingle = async (generated: Partial<Character>) => {
    await persistCharacter({
      ...emptyCharacter(),
      ...generated,
      id: newId(),
      createdAt: Date.now(),
    } as Character);
  };

  /**
   * AI-группа: сохраняем всех героев в библиотеку и сразу открываем общую
   * ветку — опенинг становится первым сообщением сцены.
   */
  const handleApplyGroup = async (group: GeneratedGroup) => {
    const now = Date.now();

    const saved: Character[] = group.characters.map((draft, index) =>
      sanitizeCharacter({
        ...emptyCharacter(),
        ...draft,
        id: newId(),
        firstMessage: draft.firstMessage || "*Молчит, глядя на тебя.*",
        initialStats: draft.initialStats ?? { ...DEFAULT_STATS },
        lorebook: draft.lorebook ?? [],
        createdAt: now + index,
      } as Character)
    );

    if (saved.length < GROUP_SIZE_MIN) {
      throw new Error("Модель вернула слишком мало персонажей для сцены.");
    }

    await db.characters.bulkPut(saved);

    const [leader, ...rest] = saved;
    const session = await createGroupSession(leader, rest, {
      opening: group.opening,
    });

    onOpenSession(session.id);
  };

  const handleToggleFavorite = (characterId: string) => {
    void toggleCharacterFavorite(characterId).catch((err) => {
      console.error("Favorite toggle failed:", err);
    });
  };

  const handleTogglePin = async (characterId: string) => {
    const char = await db.characters.get(characterId);
    if (char) {
      await db.characters.update(characterId, { isPinned: !char.isPinned });
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!isWindowDragOver) setIsWindowDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsWindowDragOver(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsWindowDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.name.endsWith(".json")) {
      setDraggedFile(dropped);
      setImportModalOpen(true);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative min-h-[calc(100vh-80px)] mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 md:px-8"
    >
      {/* Оверлей при Drag-and-Drop файла на библиотеку */}
      {isWindowDragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-md">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent bg-[#121622] p-8 text-center shadow-2xl">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
              <Upload size={32} />
            </div>
            <p className="text-base font-bold text-zinc-100">
              Отпустите JSON-файл для импорта персонажа
            </p>
            <p className="text-xs text-content-secondary">
              Загрузится анкета со всеми ветками, дневниками и воспоминаниями
            </p>
          </div>
        </div>
      )}

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
            Лица ваших историй
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Библиотека персонажей
          </h1>
          <p className="mt-1 text-sm text-content-secondary">
            У каждого есть прошлое. Будущее вы напишете вместе.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setDraggedFile(null);
              setImportModalOpen(true);
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-surface-2 px-4 py-2.5 text-sm font-semibold text-content transition-all hover:bg-surface-3 hover:border-accent/40 hover:text-accent"
          >
            <Upload size={16} strokeWidth={1.8} />
            <span>Импорт</span>
          </button>

          <button
            type="button"
            onClick={() => setGroupPickerOpen(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-surface-2 px-4 py-2.5 text-sm font-semibold text-content transition-all hover:border-accent/40 hover:bg-surface-3 hover:text-accent"
          >
            <Users size={16} strokeWidth={1.8} />
            <span>Групповая сцена</span>
          </button>

          <button
            type="button"
            onClick={openCreate}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-all hover:bg-accent-hover"
          >
            <Plus size={17} strokeWidth={2} />
            <span>Создать персонажа</span>
          </button>
        </div>
      </header>

      {/* Панель поиска и сортировки */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#121620]/90 p-2.5 backdrop-blur-xl">
        <div className="relative flex min-h-11 min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-white/[0.06] bg-surface-2 px-3 focus-within:border-accent/60">
          <Search size={16} className="text-content-muted shrink-0" />
          <input
            id={`${id}-search`}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя, статус или описание персонажа…"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-content placeholder:text-content-muted focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-content-muted hover:text-content"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="relative min-w-[180px]">
          <select
            value={sortOrder}
            onChange={(e) => handleSortChange(e.target.value as SortOrder)}
            className="w-full appearance-none rounded-xl border border-white/[0.06] bg-surface-2 px-3 py-2.5 pr-8 text-xs font-medium text-content-secondary focus:border-accent/60 focus:outline-none"
          >
            <option value="recommended">Рекомендованный порядок</option>
            <option value="newest">Сначала новые</option>
            <option value="name">По имени: А–Я</option>
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-content-muted"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => handleViewModeChange("grid")}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
              viewMode === "grid"
                ? "bg-surface-3 text-accent"
                : "text-content-muted hover:text-content"
            )}
            title="Сетка"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange("list")}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
              viewMode === "list"
                ? "bg-surface-3 text-accent"
                : "text-content-muted hover:text-content"
            )}
            title="Список"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      ) : visibleCharacters.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] p-12 text-center">
          <Users size={32} className="mx-auto text-content-muted" />
          <h3 className="mt-4 text-base font-semibold text-zinc-100">
            Персонажи не найдены
          </h3>
          <p className="mt-1 text-xs text-content-muted">
            Попробуйте изменить поисковый запрос, создайте нового персонажа или импортируйте архив.
          </p>

          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setDraggedFile(null);
                setImportModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-surface-2 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-surface-3 hover:text-accent"
            >
              <Upload size={14} />
              <span>Импортировать (.json)</span>
            </button>

            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-on-accent hover:bg-accent-hover"
            >
              <Plus size={14} />
              <span>Создать</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-4",
            viewMode === "grid"
              ? "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4"
              : "grid-cols-1"
          )}
        >
          {visibleCharacters.map((char) => {
            const genre = char.genre?.trim();
            const tags = char.tags?.filter((t) => t.trim().length > 0) ?? [];
            const isPinned = !!char.isPinned;

            if (viewMode === "list") {
              return (
                <div
                  key={char.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewing(char)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setViewing(char);
                    }
                  }}
                  className={cn(
                    "group flex cursor-pointer items-center justify-between gap-4 rounded-2xl border p-3.5 transition-all hover:bg-[#161b26]",
                    isPinned
                      ? "border-accent/40 bg-[#141824]/95 shadow-sm"
                      : "border-white/[0.07] bg-[#121620]/90"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                      {char.avatarUrl ? (
                        <img
                          src={char.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Avatar name={char.name} size={64} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isPinned && (
                          <Pin size={13} className="rotate-45 text-accent fill-accent shrink-0" />
                        )}
                        <h3 className="truncate text-sm font-bold text-zinc-100 group-hover:text-accent">
                          {char.name}
                        </h3>
                        {genre && <Badge size="sm">{genre}</Badge>}
                      </div>
                      {char.tagline && (
                        <p className="mt-1 line-clamp-1 text-xs text-content-secondary">
                          {char.tagline}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleTogglePin(char.id);
                      }}
                      title={isPinned ? "Открепить" : "Закрепить вверху"}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full border transition-all",
                        isPinned
                          ? "border-accent/40 bg-accent/20 text-accent"
                          : "border-white/10 bg-surface-2 text-content-muted hover:text-content"
                      )}
                    >
                      <Pin size={13} className={isPinned ? "rotate-45 fill-accent" : ""} />
                    </button>
                    <FavoriteButton
                      isFavorite={!!char.isFavorite}
                      onToggle={() => handleToggleFavorite(char.id)}
                    />
                  </div>
                </div>
              );
            }

            return (
              <div
                key={char.id}
                role="button"
                tabIndex={0}
                onClick={() => setViewing(char)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setViewing(char);
                  }
                }}
                className={cn(
                  "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border text-left transition-all duration-300 hover:border-white/[0.18] hover:bg-[#161b26] hover:shadow-[0_12px_36px_rgba(0,0,0,0.55)]",
                  isPinned
                    ? "border-accent/40 bg-[#131724]/95 ring-1 ring-accent/30"
                    : "border-white/[0.07] bg-[#121620]/90"
                )}
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
                  {char.avatarUrl ? (
                    <img
                      src={char.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover object-[center_25%] transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Avatar name={char.name} size={64} />
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#121620] via-transparent to-black/35" />

                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
                    {genre ? <Badge variant="outline">{genre}</Badge> : <span />}
                    <div className="pointer-events-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleTogglePin(char.id);
                        }}
                        title={isPinned ? "Открепить" : "Закрепить вверху"}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md transition-all",
                          isPinned
                            ? "border-accent/50 bg-accent/25 text-accent shadow-sm"
                            : "border-white/10 bg-black/40 text-content-muted hover:border-white/25 hover:text-content"
                        )}
                      >
                        <Pin size={13} className={isPinned ? "rotate-45 fill-accent" : ""} />
                      </button>

                      <FavoriteButton
                        isFavorite={!!char.isFavorite}
                        onToggle={() => handleToggleFavorite(char.id)}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col p-4">
                  <div className="flex items-center gap-1.5">
                    {isPinned && (
                      <Pin size={12} className="rotate-45 text-accent fill-accent shrink-0" />
                    )}
                    <h3 className="truncate text-base font-bold text-zinc-100 group-hover:text-accent">
                      {char.name}
                    </h3>
                  </div>

                  {char.tagline && (
                    <p className="mt-1 line-clamp-1 text-xs text-content-secondary">
                      {char.tagline}
                    </p>
                  )}

                  {tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-white/[0.06] bg-surface-2 px-2.5 py-0.5 text-[10px] font-medium text-content-muted"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CharacterSheet
        character={viewing}
        onClose={() => setViewing(null)}
        onEdit={(char) => {
          setViewing(null);
          setEditing(char);
          setEditorOpen(true);
        }}
        onOpenSession={onOpenSession}
      />

      <CharacterEditor
        open={editorOpen}
        initial={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={saveCharacter}
      />

      <GroupSceneModal
        open={groupPickerOpen}
        onClose={() => setGroupPickerOpen(false)}
        onOpenGenerator={() => setGroupGeneratorOpen(true)}
        onCreated={(sessionId) => onOpenSession(sessionId)}
      />

      <CharacterGeneratorModal
        open={groupGeneratorOpen}
        onClose={() => setGroupGeneratorOpen(false)}
        onApply={handleApplySingle}
        onApplyGroup={handleApplyGroup}
        initialMode="group"
      />

      <CharacterImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        initialFile={draggedFile}
        onSuccess={async (characterId) => {
          setImportModalOpen(false);
          const importedChar = await db.characters.get(characterId);
          if (importedChar) {
            setViewing(importedChar);
          }
        }}
      />
    </div>
  );
}