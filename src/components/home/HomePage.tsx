import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Users,
  Sparkles,
  BrainCircuit,
  NotebookPen,
  ShieldCheck,
  Loader2,
  AlertCircle,
  MessagesSquare,
  Play,
  Heart,
  ChevronRight,
  Wand2,
} from "lucide-react";
import { db, getUserProfile, getApiConfig } from "../../db";
import type { Character, ChatSession, DiaryEntry, ExtractedFact } from "../../types";
import type { TabKey } from "../layout/BottomNav";
import { Avatar } from "../common/Avatar";
import { Badge } from "../common/Badge";
import { MysteryPlaceholder } from "../common/MysteryPlaceholder";
import { FavoriteButton } from "../common/FavoriteButton";
import { AmbientPlayer } from "../chat/AmbientPlayer";
import { CharacterSheet } from "../characters/CharacterSheet";
import { CharacterEditor } from "../characters/CharacterEditor";
import { cn } from "../../utils/cn";

interface HomePageProps {
  onNavigate: (tab: TabKey) => void;
  onOpenSession: (sessionId: string) => void;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 18) return "Добрый день";
  if (hour >= 18 && hour < 23) return "Добрый вечер";
  return "Доброй ночи";
}

interface LatestFactInfo {
  sessionId: string;
  characterName: string;
  characterAvatar?: string;
  fact: ExtractedFact;
  /** Сессия в режиме тайны: текст факта не показывается. */
  mysteryHidden: boolean;
}

function findLatestFact(
  sessions: ChatSession[],
  characterMap: Map<string, Character>
): LatestFactInfo | null {
  let latest: LatestFactInfo | null = null;

  for (const session of sessions) {
    const character = characterMap.get(session.characterId);
    if (!character) continue;

    for (const fact of session.extractedFacts ?? []) {
      if (!latest || fact.createdAt > latest.fact.createdAt) {
        latest = {
          sessionId: session.id,
          characterName: character.name,
          characterAvatar: character.avatarUrl,
          fact,
          mysteryHidden: !!session.mysteryMode,
        };
      }
    }
  }

  return latest;
}

interface LatestDiaryInfo {
  sessionId: string;
  characterName: string;
  entry: DiaryEntry;
  /** Сессия в режиме тайны: текст записи не показывается. */
  mysteryHidden: boolean;
}

function findLatestDiaryEntry(
  sessions: ChatSession[],
  characterMap: Map<string, Character>
): LatestDiaryInfo | null {
  let latest: LatestDiaryInfo | null = null;

  for (const session of sessions) {
    const character = characterMap.get(session.characterId);
    if (!character) continue;

    for (const entry of session.diary ?? []) {
      if (!latest || entry.timestamp > latest.entry.timestamp) {
        latest = {
          sessionId: session.id,
          characterName: character.name,
          entry,
          mysteryHidden: !!session.mysteryMode,
        };
      }
    }
  }

  return latest;
}

function stripMeta(text: string): string {
  return text
    .replace(/```meta[\s\S]*?```/i, "")
    .replace(/\*/g, "")
    .trim();
}

/** Русское склонение: 1 сообщение, 2 сообщения, 5 сообщений. */
function pluralMessages(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return "сообщение";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сообщения";
  return "сообщений";
}

function StoryCard({
  session,
  character,
  onOpen,
}: {
  session: ChatSession;
  character?: Character;
  onOpen: () => void;
}) {
  const lastMessage = useLiveQuery(async () => {
    const list = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp");
    return list[list.length - 1];
  }, [session.id]);

  const messageCount = useLiveQuery(
    () => db.messages.where("sessionId").equals(session.id).count(),
    [session.id]
  );

  const preview = lastMessage
    ? stripMeta(lastMessage.swipes[lastMessage.currentSwipeIndex] ?? "")
    : "Новая глава начинается с нашей следующей реплики…";

  const charName = character?.name || "Неизвестный персонаж";
  // В режиме тайны статус не выводится даже на главной.
  const statusTitle = session.mysteryMode
    ? ""
    : session.currentStats?.statusTitle || "Осторожное знакомство";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group relative flex min-w-[300px] flex-1 cursor-pointer items-stretch gap-3.5 rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-3.5 transition-all duration-200 hover:border-white/[0.14] hover:bg-[#161b26] hover:shadow-lg"
    >
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/[0.08] bg-surface-2">
        {character?.avatarUrl ? (
          <img
            src={character.avatarUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Avatar name={charName} size={42} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-zinc-100 group-hover:text-accent">
              {charName}
            </h3>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-content-muted">
              {messageCount === undefined ? "…" : `${messageCount} сообщ.`}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-content-secondary">
            {preview}
          </p>
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-content-muted">
          <span className="flex items-center gap-1.5 truncate">
            <MessagesSquare size={13} className="shrink-0 text-accent/80" />
            <span>
              {messageCount === undefined
                ? "Загрузка…"
                : `${messageCount} ${pluralMessages(messageCount)}${statusTitle ? ` · ${statusTitle}` : ""}`}
            </span>
          </span>
          <ArrowRight
            size={14}
            className="shrink-0 text-content-muted transition-transform group-hover:translate-x-1 group-hover:text-accent"
          />
        </div>
      </div>
    </div>
  );
}

function CharacterCard({
  character,
  onOpen,
  onToggleFavorite,
}: {
  character: Character;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(character.avatarUrl) && failedSrc !== character.avatarUrl;
  const genre = character.genre?.trim() || "История";
  const tags = character.tags?.filter((t) => t.trim().length > 0) ?? [];
  const isFavorite = !!character.isFavorite;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#121620]/90 text-left transition-all duration-200 hover:border-white/[0.14] hover:bg-[#161b26] hover:shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
        {showImage ? (
          <img
            src={character.avatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailedSrc(character.avatarUrl)}
            className="h-full w-full object-cover object-[center_25%] transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Avatar name={character.name} size={64} />
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#121620] via-transparent to-black/30" />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <Badge variant="outline">{genre}</Badge>
          <span className="pointer-events-auto">
            <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-4">
        <h3 className="truncate text-base font-bold text-zinc-100 group-hover:text-accent">
          {character.name}
        </h3>

        {character.tagline && (
          <p className="mt-1 line-clamp-1 text-xs text-content-secondary">
            {character.tagline}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/[0.06] bg-surface-2/80 px-2 py-0.5 text-[10px] font-medium text-content-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HomePage({ onNavigate, onOpenSession }: HomePageProps) {
  const [greeting] = useState(getGreeting);
  const [viewing, setViewing] = useState<Character | null>(null);
  const [editing, setEditing] = useState<Character | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const result = useLiveQuery(async () => {
    try {
      const [characters, sessions, profile, apiConfig] = await Promise.all([
        db.characters.orderBy("createdAt").reverse().toArray(),
        db.sessions.orderBy("updatedAt").reverse().toArray(),
        getUserProfile(),
        getApiConfig(),
      ]);

      return {
        data: { characters, sessions, profile, apiConfig },
        error: null,
      };
    } catch (cause) {
      return {
        data: null,
        error:
          cause instanceof Error
            ? cause.message
            : "Не удалось прочитать данные главной страницы.",
      };
    }
  }, []);

  const data = result?.data;
  const characterMap = useMemo(
    () => new Map((data?.characters ?? []).map((c) => [c.id, c])),
    [data?.characters]
  );

  const recentSessions = useMemo(
    () =>
      (data?.sessions ?? [])
        .filter((session) => characterMap.has(session.characterId))
        .slice(0, 4),
    [data?.sessions, characterMap]
  );

  const latestSession = recentSessions[0];
  const allCharacters = data?.characters ?? [];

  const filteredCharacters = useMemo(() => {
    if (categoryFilter === "favorites") {
      return allCharacters.filter((c) => !!c.isFavorite);
    }
    if (categoryFilter !== "all") {
      return allCharacters.filter(
        (c) => c.genre?.toLowerCase() === categoryFilter.toLowerCase()
      );
    }
    return allCharacters.slice(0, 8);
  }, [allCharacters, categoryFilter]);

  const genres = useMemo(() => {
    const set = new Set<string>();
    allCharacters.forEach((c) => {
      if (c.genre?.trim()) set.add(c.genre.trim());
    });
    return Array.from(set);
  }, [allCharacters]);

  const profileName = data?.profile.name.trim();
  const latestFact = data ? findLatestFact(data.sessions, characterMap) : null;
  const latestDiaryEntry = data ? findLatestDiaryEntry(data.sessions, characterMap) : null;

  const saveCharacter = async (character: Character) => {
    await db.characters.put(character);
    setEditorOpen(false);
    setEditing(null);
  };

  const handleToggleFavorite = async (characterId: string) => {
    const char = await db.characters.get(characterId);
    if (char) {
      await db.characters.update(characterId, { isFavorite: !char.isFavorite });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 md:px-8">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent/90">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span>Ваша история продолжается</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          {greeting}
          {profileName ? `, ${profileName}` : ""} 🌙
        </h1>
        <p className="mt-1 text-sm text-content-secondary">
          Оставьте суету снаружи. Здесь начинается ваш мир.
        </p>
      </header>

      {result?.error && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
        >
          <AlertCircle size={18} className="shrink-0" />
          <span>{result.error}</span>
        </div>
      )}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <section
            aria-labelledby="home-hero-heading"
            className="relative isolate overflow-hidden rounded-3xl border border-white/[0.08] bg-[#121620] shadow-2xl"
          >
            <img
              src="/images/nocturne-home.svg"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover object-[center_35%]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-[#090b10]/95 via-[#090b10]/85 to-transparent"
            />

            <div className="max-w-xl p-6 sm:p-8 md:p-10">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-3 py-1 text-xs font-medium text-accent backdrop-blur-md">
                <Sparkles size={13} />
                тысячи возможностей, ваш выбор
              </span>

              <h2
                id="home-hero-heading"
                className="novel-font mt-4 text-2xl font-bold leading-tight tracking-tight text-zinc-100 sm:text-3xl md:text-4xl"
              >
                Ночь полна историй.
                <br />
                Одна из них — ваша.
              </h2>

              <p className="mt-3 max-w-md text-sm leading-relaxed text-content-secondary sm:text-base">
                Встретьте того, кто изменит сюжет.
                <br />
                И посмотрите, куда приведёт разговор.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate("characters")}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-all hover:bg-accent-hover active:bg-accent-pressed"
                >
                  <Sparkles size={16} />
                  <span>Начать историю</span>
                  <ArrowRight size={15} />
                </button>

                {latestSession && (
                  <button
                    type="button"
                    onClick={() => onOpenSession(latestSession.id)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 backdrop-blur-md transition-all hover:bg-white/[0.08]"
                  >
                    <Play size={14} fill="currentColor" />
                    <span>Продолжить диалог</span>
                  </button>
                )}
              </div>
            </div>
          </section>

          {!result ? (
            <div className="flex items-center gap-3 py-8 text-sm text-content-secondary">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span>Собираем ваше пространство…</span>
            </div>
          ) : (
            <>
              <section aria-labelledby="home-stories-heading">
                <div className="mb-4 flex items-center justify-between">
                  <h2
                    id="home-stories-heading"
                    className="flex items-center gap-2 text-base font-semibold text-zinc-100"
                  >
                    <BookOpen size={18} className="text-accent" />
                    <span>Между строк</span>
                  </h2>

                  <button
                    type="button"
                    onClick={() => onNavigate("chats")}
                    className="flex items-center gap-1.5 text-xs font-medium text-content-muted transition-colors hover:text-accent"
                  >
                    <span>Все истории</span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                {recentSessions.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {recentSessions.map((session) => (
                      <StoryCard
                        key={session.id}
                        session={session}
                        character={characterMap.get(session.characterId)}
                        onOpen={() => onOpenSession(session.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/[0.07] bg-[#121620]/80 p-5 text-center sm:text-left">
                    <p className="text-sm font-medium text-zinc-200">
                      История ещё не началась
                    </p>
                    <p className="mt-1 text-xs text-content-muted">
                      Выберите персонажа в библиотеке, чтобы запустить первую ветку диалога.
                    </p>
                  </div>
                )}
              </section>

              <section aria-labelledby="home-characters-heading">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2
                    id="home-characters-heading"
                    className="flex items-center gap-2 text-base font-semibold text-zinc-100"
                  >
                    <Users size={18} className="text-accent" />
                    <span>Кого встретите сегодня?</span>
                  </h2>

                  <button
                    type="button"
                    onClick={() => onNavigate("characters")}
                    className="flex items-center gap-1.5 text-xs font-medium text-content-muted transition-colors hover:text-accent"
                  >
                    <span>Вся библиотека</span>
                    <span className="tabular-nums">({allCharacters.length})</span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCategoryFilter("all")}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      categoryFilter === "all"
                        ? "bg-accent/20 text-accent border border-accent/40"
                        : "bg-surface-2 border border-white/[0.06] text-content-muted hover:text-content"
                    )}
                  >
                    Все
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategoryFilter("favorites")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      categoryFilter === "favorites"
                        ? "bg-accent/20 text-accent border border-accent/40"
                        : "bg-surface-2 border border-white/[0.06] text-content-muted hover:text-content"
                    )}
                  >
                    <Heart size={12} fill={categoryFilter === "favorites" ? "currentColor" : "none"} />
                    <span>Избранное</span>
                  </button>

                  {genres.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => setCategoryFilter(genre)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        categoryFilter === genre
                          ? "bg-accent/20 text-accent border border-accent/40"
                          : "bg-surface-2 border border-white/[0.06] text-content-muted hover:text-content"
                      )}
                    >
                      {genre}
                    </button>
                  ))}
                </div>

                {filteredCharacters.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {filteredCharacters.map((character) => (
                      <CharacterCard
                        key={character.id}
                        character={character}
                        onOpen={() => setViewing(character)}
                        onToggleFavorite={() => handleToggleFavorite(character.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/[0.07] bg-[#121620]/80 p-8 text-center">
                    <p className="text-sm font-medium text-zinc-300">
                      Персонажей не найдено
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setEditorOpen(true);
                      }}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                    >
                      <Sparkles size={14} />
                      <span>Создать персонажа</span>
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {data && (
          <aside
            aria-label="Контекстные виджеты"
            className="min-w-0 space-y-4"
          >
            {/* Виджет: Ваша персона (Исправлен переход на persona) */}
            <section className="rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-content-muted">
                  Ваша персона
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate("persona")}
                  className="text-content-muted hover:text-accent"
                  title="Редактировать персону"
                >
                  <ArrowUpRight size={14} />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <Avatar
                  src={data.profile.avatarUrl}
                  name={data.profile.name || "Странник"}
                  size={44}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {data.profile.name || "Странник"}
                  </p>
                  <p className="truncate text-xs text-content-muted">
                    Главный герой своих историй
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate("persona")}
                className="mt-4 flex w-full items-center justify-between rounded-xl border border-white/[0.06] bg-surface-2/60 px-3 py-2 text-xs font-medium text-content-secondary hover:bg-surface-2 hover:text-content"
              >
                <span>Моя персона</span>
                <ChevronRight size={14} />
              </button>
            </section>

            <section className="rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4">
              <div className="mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-content-muted">
                  Атмосфера
                </span>
                <p className="mt-0.5 text-xs text-content-muted">
                  Звук вашей истории
                </p>
              </div>
              <AmbientPlayer variant="full" />
            </section>

            {latestFact && (
              <section className="rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-content-muted">
                    <BrainCircuit size={13} className="text-accent" />
                    Не забыть
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate("memory")}
                    className="text-content-muted hover:text-accent"
                  >
                    <ArrowUpRight size={14} />
                  </button>
                </div>

                {latestFact.mysteryHidden ? (
                  <MysteryPlaceholder lines={2} className="mt-3" />
                ) : (
                  <blockquote className="novel-font mt-3 text-xs italic leading-relaxed text-zinc-300">
                    «{latestFact.fact.content}»
                  </blockquote>
                )}

                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-content-muted">
                  <Avatar
                    src={latestFact.characterAvatar}
                    name={latestFact.characterName}
                    size={20}
                  />
                  <span className="truncate">{latestFact.characterName}</span>
                </div>
              </section>
            )}

            {latestDiaryEntry && (
              <section className="rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-content-muted">
                    <NotebookPen size={13} className="text-accent" />
                    Невысказанное
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate("diary")}
                    className="text-content-muted hover:text-accent"
                  >
                    <ArrowUpRight size={14} />
                  </button>
                </div>

                {latestDiaryEntry.mysteryHidden ? (
                  <MysteryPlaceholder lines={2} className="mt-3" />
                ) : (
                <blockquote className="novel-font mt-3 line-clamp-3 text-xs italic leading-relaxed text-content-secondary">
                  «{latestDiaryEntry.entry.thought}»
                </blockquote>
                )}

                <button
                  type="button"
                  onClick={() => onNavigate("diary")}
                  className="mt-3 flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                >
                  <span>Заглянуть в дневник</span>
                  <ArrowRight size={13} />
                </button>
              </section>
            )}

            <button
              type="button"
              onClick={() => onNavigate("studio")}
              title="Промпты для генерации изображений"
              className="flex w-full items-center justify-between rounded-2xl border border-white/[0.07] bg-[#121620]/90 px-4 py-3 text-left text-xs transition-colors hover:border-white/[0.14] hover:bg-[#161b26]"
            >
              <span className="flex items-center gap-2">
                <Wand2 size={16} className="text-accent" />
                <span className="text-content-secondary">
                  Промпт-студия: кадр для сцены
                </span>
              </span>
              <span className="flex items-center gap-1 font-semibold text-accent">
                <span>Открыть</span>
                <ArrowRight size={13} />
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate("backup")}
              title="Резервные копии и хранилище"
              className="flex w-full items-center justify-between rounded-2xl border border-white/[0.07] bg-[#121620]/90 px-4 py-3 text-left text-xs transition-colors hover:border-white/[0.14] hover:bg-[#161b26]"
            >
              <span className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-success" />
                <span className="text-content-secondary">
                  Всё хранится только у вас
                </span>
              </span>
              <span className="flex items-center gap-1 font-semibold text-accent">
                <span>Бэкап</span>
                <ArrowRight size={13} />
              </span>
            </button>
          </aside>
        )}
      </div>

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
    </div>
  );
}