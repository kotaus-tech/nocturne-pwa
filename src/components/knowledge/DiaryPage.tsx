import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  NotebookPen,
  Search,
  Trash2,
} from "lucide-react";
import { db } from "../../db";
import { Avatar } from "../common/Avatar";
import type { DiaryEntry, Character, ChatSession } from "../../types";

export function DiaryPage() {
  const [query, setQuery] = useState("");
  const [characterFilter, setCharacterFilter] = useState<string>("all");

  const characters = useLiveQuery(() => db.characters.toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);

  const characterMap = useMemo(
    () => new Map((characters ?? []).map((c) => [c.id, c])),
    [characters]
  );

  const allEntries = useMemo(() => {
    if (!sessions || !characters) return [];
    const list: {
      entry: DiaryEntry;
      session: ChatSession;
      character: Character;
    }[] = [];

    for (const session of sessions) {
      const character = characterMap.get(session.characterId);
      if (!character) continue;

      for (const entry of session.diary ?? []) {
        list.push({ entry, session, character });
      }
    }

    return list.sort((a, b) => b.entry.timestamp - a.entry.timestamp);
  }, [sessions, characters, characterMap]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEntries.filter((item) => {
      if (characterFilter !== "all" && item.character.id !== characterFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.entry.thought.toLowerCase().includes(q) ||
        (item.entry.mood && item.entry.mood.toLowerCase().includes(q)) ||
        item.character.name.toLowerCase().includes(q)
      );
    });
  }, [allEntries, query, characterFilter]);

  const deleteDiaryEntry = async (sessionId: string, entryId: string) => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;

    const updated = (session.diary || []).filter((e) => e.id !== entryId);
    await db.sessions.update(sessionId, { diary: updated });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 md:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          Сокровенные мысли
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          Тайные дневники
        </h1>
        <p className="mt-1 text-sm text-content-secondary">
          Истинные чувства и скрытые мысли, которые персонажи доверяют только своим дневникам.
        </p>
      </header>

      {/* Фильтры */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#121620]/90 p-2.5 backdrop-blur-xl">
        <div className="flex flex-1 min-w-[200px] items-center gap-2 rounded-xl border border-white/[0.06] bg-surface-2 px-3 py-2">
          <Search size={16} className="text-content-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по записям и эмоциям…"
            className="w-full bg-transparent text-xs text-content placeholder:text-content-muted focus:outline-none"
          />
        </div>

        <select
          value={characterFilter}
          onChange={(e) => setCharacterFilter(e.target.value)}
          className="rounded-xl border border-white/[0.06] bg-surface-2 px-3 py-2 text-xs text-content-secondary focus:outline-none"
        >
          <option value="all">Все персонажи</option>
          {(characters || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {allEntries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] p-12 text-center">
          <NotebookPen size={32} className="mx-auto text-content-muted" />
          <h3 className="mt-3 text-base font-semibold text-zinc-200">Дневники пока пусты</h3>
          <p className="mt-1 text-xs text-content-muted">
            Когда диалог становится эмоционально глубоким, персонажи делают записи в личном дневнике.
          </p>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="p-8 text-center text-xs text-content-muted">
          Записей не найдено.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map(({ entry, session, character }) => (
            <article
              key={entry.id}
              className="group relative rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-5 backdrop-blur-xl transition-all hover:border-white/[0.14] hover:bg-[#161b26]"
            >
              <div className="flex items-center justify-between gap-3 pb-3">
                <div className="flex items-center gap-3">
                  <Avatar
                    src={character.avatarUrl}
                    name={character.name}
                    size={32}
                  />
                  <div>
                    <h3 className="text-xs font-bold text-zinc-100">{character.name}</h3>
                    <p className="text-[10px] text-content-muted">
                      Ветка: {session.title}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {entry.mood && (
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                      {entry.mood}
                    </span>
                  )}
                  <span className="text-[11px] tabular-nums text-content-muted">
                    {new Date(entry.timestamp).toLocaleDateString("ru-RU", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteDiaryEntry(session.id, entry.id)}
                    className="p-1 text-content-muted hover:text-danger"
                    title="Удалить запись"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <blockquote className="novel-font border-l-2 border-accent/40 pl-4 text-xs italic leading-relaxed text-zinc-200">
                «{entry.thought}»
              </blockquote>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}