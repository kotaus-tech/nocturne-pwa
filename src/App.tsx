import { useEffect, useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  House,
  Users,
  MessagesSquare,
  Heart,
  BookOpen,
  BrainCircuit,
  NotebookPen,
  UserCircle2,
  Plus,
  Search,
  ShieldCheck,
  ChevronRight,
  Moon,
  Settings,
} from "lucide-react";
import { BottomNav, type TabKey } from "./components/layout/BottomNav";
import { HomePage } from "./components/home/HomePage";
import { ChatsPage } from "./components/chats/ChatsPage";
import { CharactersPage } from "./components/characters/CharactersPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { PersonaPage } from "./components/profile/PersonaPage";
import { MemoryPage } from "./components/knowledge/MemoryPage";
import { DiaryPage } from "./components/knowledge/DiaryPage";
import { LorePage } from "./components/knowledge/LorePage";
import { ChatView } from "./components/chat/ChatView";
import { AmbientPlayer } from "./components/chat/AmbientPlayer";
import { Avatar } from "./components/common/Avatar";
import { PwaBanners } from "./components/common/PwaBanners";
import { db, getUserProfile } from "./db";
import { ensureSeedData } from "./seed";
import { initPwa } from "./services/pwa";
import type { UserProfile } from "./types";
import { cn } from "./utils/cn";

export default function App() {
  const [tab, setTab] = useState<TabKey>("home");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [createSignal, setCreateSignal] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Статистика базы для бейджей сайдбара
  const charactersCount = useLiveQuery(() => db.characters.count(), []);
  const sessionsCount = useLiveQuery(() => db.sessions.count(), []);
  const favoritesCount = useLiveQuery(
    () => db.characters.filter((c) => !!c.isFavorite).count(),
    []
  );

  const sessions = useLiveQuery(() => db.sessions.toArray(), []);
  const characters = useLiveQuery(() => db.characters.toArray(), []);

  const totalFactsCount = useMemo(() => {
    return (sessions ?? []).reduce(
      (acc, s) => acc + (s.extractedFacts?.length ?? 0),
      0
    );
  }, [sessions]);

  const totalDiaryCount = useMemo(() => {
    return (sessions ?? []).reduce(
      (acc, s) => acc + (s.diary?.length ?? 0),
      0
    );
  }, [sessions]);

  const totalLoreCount = useMemo(() => {
    return (characters ?? []).reduce(
      (acc, c) => acc + (c.lorebook?.length ?? 0),
      0
    );
  }, [characters]);

  useEffect(() => {
    ensureSeedData()
      .then(() => getUserProfile())
      .then((profile) => {
        setUserProfile(profile);
        setReady(true);
      })
      .catch((err) => {
        console.error("Seed init error:", err);
        setInitError(err instanceof Error ? err.message : "Ошибка базы данных");
        setReady(true);
      });

    const disposePwa = initPwa();
    return disposePwa;
  }, []);

  const handleNavigate = (newTab: TabKey) => {
    if (newTab === "characters") {
      setFavoritesOnly(false);
    }
    setTab(newTab);
  };

  const handleNavigateFavorites = () => {
    setFavoritesOnly(true);
    setTab("characters");
  };

  const handleTriggerCreate = () => {
    setTab("characters");
    setCreateSignal((prev) => prev + 1);
  };

  if (!ready) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-bg px-6 text-content supports-[height:100dvh]:h-dvh">
        <div
          role="status"
          aria-live="polite"
          className="flex max-w-sm flex-col items-center text-center"
        >
          <div className="relative mb-6 flex h-14 w-14 items-center justify-center rounded-3xl border border-white/[0.08] bg-surface shadow-[0_0_30px_rgba(139,92,246,0.2)]">
            <Moon size={28} strokeWidth={1.5} className="text-accent" />
          </div>
          <p className="novel-font text-2xl font-semibold tracking-[0.08em] text-zinc-100">
            NOCTURNE
          </p>
          <div className="mt-5 flex items-center gap-2.5 text-xs text-content-secondary">
            <Loader2
              size={18}
              strokeWidth={1.8}
              aria-hidden="true"
              className="shrink-0 animate-spin text-accent"
            />
            <span>Открываем ваше пространство…</span>
          </div>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="flex h-screen w-full items-center justify-center overflow-y-auto bg-bg p-6 text-content supports-[height:100dvh]:h-dvh">
        <div className="my-auto w-full max-w-md rounded-3xl border border-danger/25 bg-surface p-8 shadow-2xl">
          <div
            aria-hidden="true"
            className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger"
          >
            <AlertTriangle size={24} strokeWidth={1.7} />
          </div>
          <h1 className="text-xl font-semibold text-content">Сбой инициализации</h1>
          <p className="mt-2 text-sm text-content-secondary">
            Не удалось открыть приложение. Проверьте хранилище браузера.
          </p>
          <p className="mt-4 whitespace-pre-wrap rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs leading-relaxed text-danger">
            {initError}
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
          >
            <RotateCcw size={16} />
            Перезагрузить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full min-w-0 overflow-hidden bg-bg text-content supports-[height:100dvh]:h-dvh">
      {/* Левый сайдбар студии (Desktop ≥ 1024px) */}
      <aside className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-white/[0.07] bg-[#0c0f15]/95 backdrop-blur-2xl">
        {/* Логотип */}
        <div className="p-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-surface shadow-sm">
              <Moon size={20} strokeWidth={1.6} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="novel-font text-lg font-semibold tracking-[0.06em] text-zinc-100">
                NOCTURNE
              </h1>
              <p className="truncate text-[11px] text-content-muted">
                Личное пространство
              </p>
            </div>
          </div>
        </div>

        {/* Навигация сайдбара */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-6">
          {/* Раздел: Ваша студия */}
          <div>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              Ваша студия
            </p>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => handleNavigate("home")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  tab === "home"
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
                )}
              >
                <div className="flex items-center gap-3">
                  <House size={18} strokeWidth={1.8} />
                  <span>Мой мир</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleNavigate("characters")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  tab === "characters" && !favoritesOnly
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
                )}
              >
                <div className="flex items-center gap-3">
                  <Users size={18} strokeWidth={1.8} />
                  <span>Персонажи</span>
                </div>
                {charactersCount !== undefined && charactersCount > 0 && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-content-muted">
                    {charactersCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleNavigate("chats")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  tab === "chats"
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
                )}
              >
                <div className="flex items-center gap-3">
                  <MessagesSquare size={18} strokeWidth={1.8} />
                  <span>Мои истории</span>
                </div>
                {sessionsCount !== undefined && sessionsCount > 0 && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-content-muted">
                    {sessionsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={handleNavigateFavorites}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  tab === "characters" && favoritesOnly
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
                )}
              >
                <div className="flex items-center gap-3">
                  <Heart size={18} strokeWidth={1.8} />
                  <span>Избранное</span>
                </div>
                {favoritesCount !== undefined && favoritesCount > 0 && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-content-muted">
                    {favoritesCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Раздел: Мир и память */}
          <div>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              Мир и память
            </p>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => handleNavigate("lore")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  tab === "lore"
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
                )}
              >
                <div className="flex items-center gap-3">
                  <BookOpen size={18} strokeWidth={1.7} />
                  <span>Миры и знания</span>
                </div>
                {totalLoreCount > 0 && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-content-muted">
                    {totalLoreCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleNavigate("memory")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  tab === "memory"
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
                )}
              >
                <div className="flex items-center gap-3">
                  <BrainCircuit size={18} strokeWidth={1.7} />
                  <span>Память</span>
                </div>
                {totalFactsCount > 0 && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-content-muted">
                    {totalFactsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleNavigate("diary")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  tab === "diary"
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
                )}
              >
                <div className="flex items-center gap-3">
                  <NotebookPen size={18} strokeWidth={1.7} />
                  <span>Дневники</span>
                </div>
                {totalDiaryCount > 0 && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-content-muted">
                    {totalDiaryCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleNavigate("persona")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  tab === "persona"
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
                )}
              >
                <div className="flex items-center gap-3">
                  <UserCircle2 size={18} strokeWidth={1.7} />
                  <span>Мои персоны</span>
                </div>
              </button>
            </div>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={handleTriggerCreate}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary transition-all hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
            >
              <Plus size={16} strokeWidth={2} />
              <span>Создать персонажа</span>
            </button>
          </div>
        </div>

        {/* Нижний блок: плеер, кнопка настроек и профиль */}
        <div className="p-3 border-t border-white/[0.07] space-y-2.5">
          <AmbientPlayer variant="compact" />

          {/* Прямая кнопка настроек системы */}
          <button
            type="button"
            onClick={() => handleNavigate("settings")}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
              tab === "settings"
                ? "bg-accent/15 text-accent font-semibold"
                : "text-content-secondary hover:bg-white/[0.04] hover:text-content"
            )}
          >
            <Settings size={17} strokeWidth={1.8} />
            <span>Настройки системы</span>
          </button>

          {/* Плашка персоны */}
          <button
            type="button"
            onClick={() => handleNavigate("persona")}
            className={cn(
              "group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-surface-2/60 p-2 text-left transition-all hover:border-white/[0.12] hover:bg-surface-2",
              tab === "persona" && "border-accent/40 bg-surface-2"
            )}
          >
            <Avatar
              src={userProfile?.avatarUrl}
              name={userProfile?.name || "Игрок"}
              size={36}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-content group-hover:text-accent">
                {userProfile?.name || "Странник"}
              </p>
              <p className="truncate text-[11px] text-content-muted">Ваша персона</p>
            </div>
            <ChevronRight
              size={15}
              className="shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 group-hover:text-content"
            />
          </button>
        </div>
      </aside>

      {/* Основная рабочая область */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="shrink-0 border-b border-white/[0.07] bg-[#0c0f15]/80 backdrop-blur-xl px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 lg:hidden">
                <Moon size={18} strokeWidth={1.6} className="text-accent" />
                <span className="novel-font text-base font-semibold tracking-wide text-zinc-100">
                  NOCTURNE
                </span>
              </div>
              <span className="hidden text-xs font-medium text-content-muted lg:inline-block">
                {tab === "home" && "Ваше пространство для историй"}
                {tab === "characters" && (favoritesOnly ? "Избранные персонажи" : "Библиотека персонажей")}
                {tab === "chats" && "Ваши ветки диалогов"}
                {tab === "settings" && "Настройки модели и системы"}
                {tab === "persona" && "Ваша персона и профиль игрока"}
                {tab === "memory" && "Хранилище памяти и фактов"}
                {tab === "diary" && "Тайные дневники персонажей"}
                {tab === "lore" && "Миры и база знаний"}
              </span>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => handleNavigate("characters")}
                className="hidden sm:flex items-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-xs text-content-muted transition-colors hover:border-white/[0.15] hover:text-content"
              >
                <Search size={14} />
                <span>Найти в моём мире…</span>
                <kbd className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-content-muted">
                  ⌘K
                </kbd>
              </button>

              <button
                type="button"
                onClick={handleTriggerCreate}
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent shadow-sm transition-colors hover:bg-accent-hover"
              >
                <Plus size={15} strokeWidth={2} />
                <span>Создать</span>
              </button>

              <div className="hidden md:flex items-center gap-1.5 rounded-xl border border-white/[0.07] bg-surface-2/70 px-2.5 py-1.5 text-[11px] font-medium text-content-muted">
                <ShieldCheck size={14} className="text-success" />
                <span>Local-first · Dexie</span>
              </div>

              {/* Аватар в шапке ведет напрямую в профиль игрока */}
              <button
                type="button"
                onClick={() => handleNavigate("persona")}
                title="Редактировать персону"
                className="flex rounded-full ring-1 ring-white/10 transition-all hover:ring-accent/50"
              >
                <Avatar
                  src={userProfile?.avatarUrl}
                  name={userProfile?.name || "Игрок"}
                  size={28}
                />
              </button>
            </div>
          </div>
        </header>

        {/* Главный контент */}
        <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-20 lg:pb-8">
          {tab === "home" && (
            <HomePage
              onNavigate={handleNavigate}
              onOpenSession={setActiveSessionId}
            />
          )}

          {tab === "chats" && (
            <ChatsPage onOpenSession={setActiveSessionId} />
          )}

          {tab === "characters" && (
            <CharactersPage
              onOpenSession={setActiveSessionId}
              favoritesOnly={favoritesOnly}
              onFavoritesOnlyChange={setFavoritesOnly}
              createSignal={createSignal}
            />
          )}

          {tab === "settings" && <SettingsPage initialTab="api" />}
          {tab === "backup" && <SettingsPage initialTab="backup" />}
          {tab === "persona" && <PersonaPage />}
          {tab === "memory" && <MemoryPage />}
          {tab === "diary" && <DiaryPage />}
          {tab === "lore" && <LorePage />}
        </main>
      </div>

      {!activeSessionId && (
        <BottomNav active={tab} onChange={handleNavigate} />
      )}

      {activeSessionId && (
        <ChatView
          sessionId={activeSessionId}
          onBack={() => setActiveSessionId(null)}
        />
      )}

      <PwaBanners />
    </div>
  );
}