import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpen,
  BrainCircuit,
  Loader2,
  MessageSquare,
  NotebookPen,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { db } from "../../db";
import type { TabKey } from "../layout/BottomNav";
import {
  searchEverything,
  type GlobalSearchHit,
  type GlobalSearchKind,
} from "../../services/globalSearch";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onNavigate: (tab: TabKey) => void;
}

const KIND_META: Record<
  GlobalSearchKind,
  { label: string; icon: typeof Search; tab: TabKey }
> = {
  character: { label: "Персонажи", icon: Sparkles, tab: "characters" },
  session: { label: "Ветки", icon: BookOpen, tab: "chats" },
  message: { label: "Реплики", icon: MessageSquare, tab: "chats" },
  lore: { label: "Миры", icon: BookOpen, tab: "lore" },
  diary: { label: "Дневники", icon: NotebookPen, tab: "diary" },
  memory: { label: "Память", icon: BrainCircuit, tab: "memory" },
};

/**
 * Поиск по всему миру игрока: персонажи, ветки, реплики, лорбуки, дневники и
 * память. Данные читаются один раз при открытии — этого хватает, а держать
 * подписку на все сообщения ради поиска слишком дорого.
 */
export function GlobalSearchModal({ open, onClose, onOpenSession, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const data = useLiveQuery(
    async () => {
      const [characters, sessions, messages] = await Promise.all([
        db.characters.toArray(),
        db.sessions.orderBy("updatedAt").reverse().toArray(),
        db.messages.toArray(),
      ]);

      return { characters, sessions, messages };
    },
    [open],
    undefined
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const hits = useMemo(
    () => (data ? searchEverything(query, data) : []),
    [data, query]
  );

  const grouped = useMemo(() => {
    const map = new Map<GlobalSearchKind, GlobalSearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.kind) ?? [];
      list.push(hit);
      map.set(hit.kind, list);
    }
    return [...map.entries()];
  }, [hits]);

  const openHit = (hit: GlobalSearchHit) => {
    onClose();

    if (hit.sessionId) {
      onOpenSession(hit.sessionId);
      return;
    }

    onNavigate(KIND_META[hit.kind].tab);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[8vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Поиск по моему миру"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/[0.09] bg-[#121622] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <Search size={16} className="shrink-0 text-content-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && hits[0]) openHit(hits[0]);
            }}
            placeholder="Найти что угодно: персонажа, реплику, якорь, мир…"
            aria-label="Поисковый запрос"
            className="min-w-0 flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-muted"
          />

          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить запрос"
              className="shrink-0 rounded-lg p-1 text-content-muted transition-colors hover:text-content"
            >
              <X size={15} />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть поиск"
            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-content-muted transition-colors hover:text-content"
          >
            Esc
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {!data && (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-content-secondary">
              <Loader2 size={16} className="animate-spin text-accent" />
              <span>Открываем вашу библиотеку…</span>
            </div>
          )}

          {data && query.trim().length < 2 && (
            <p className="px-3 py-6 text-sm text-content-muted">
              Начните вводить хотя бы два символа — поиск пройдёт по персонажам,
              веткам, репликам, мирам, дневникам и памяти.
            </p>
          )}

          {data && query.trim().length >= 2 && hits.length === 0 && (
            <p className="px-3 py-6 text-sm text-content-muted">
              Ничего не нашлось. Попробуйте другое слово или имя героя.
            </p>
          )}

          {grouped.map(([kind, list]) => {
            const meta = KIND_META[kind];
            const Icon = meta.icon;

            return (
              <section key={kind} className="mb-3">
                <h3 className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                  <Icon size={12} />
                  <span>{meta.label}</span>
                </h3>

                <ul>
                  {list.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button
                        type="button"
                        onClick={() => openHit(hit)}
                        className="w-full rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/[0.05] focus:bg-white/[0.05] focus:outline-none"
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-content">
                            {hit.title}
                          </span>
                          {hit.subtitle && (
                            <span className="shrink-0 text-[10px] text-content-muted">
                              {hit.subtitle}
                            </span>
                          )}
                        </span>

                        {hit.snippet && (
                          <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-content-secondary">
                            {hit.snippet}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
