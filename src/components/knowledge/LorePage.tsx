import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Search, Check } from "lucide-react";
import { db } from "../../db";
import { Avatar } from "../common/Avatar";
import type { LorebookEntry, Character } from "../../types";

export function LorePage() {
  const [query, setQuery] = useState("");
  const [characterFilter, setCharacterFilter] = useState<string>("all");

  const characters = useLiveQuery(() => db.characters.toArray(), []);

  const allLore = useMemo(() => {
    if (!characters) return [];
    const list: { entry: LorebookEntry; character: Character }[] = [];

    for (const character of characters) {
      for (const entry of character.lorebook ?? []) {
        list.push({ entry, character });
      }
    }
    return list;
  }, [characters]);

  const filteredLore = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allLore.filter((item) => {
      if (characterFilter !== "all" && item.character.id !== characterFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.entry.content.toLowerCase().includes(q) ||
        item.entry.keys.some((k) => k.toLowerCase().includes(q)) ||
        item.character.name.toLowerCase().includes(q)
      );
    });
  }, [allLore, query, characterFilter]);

  const toggleLoreActive = async (characterId: string, entryId: string) => {
    const char = await db.characters.get(characterId);
    if (!char) return;

    const updated = char.lorebook.map((e) =>
      e.id === entryId ? { ...e, isActive: !e.isActive } : e
    );
    await db.characters.update(characterId, { lorebook: updated });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 md:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          Справочник вселенных
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          Миры и знания (Lorebook)
        </h1>
        <p className="mt-1 text-sm text-content-secondary">
          Факты об устройстве мира, магии, организациях и ключевых терминах, активируемые по триггерам.
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
            placeholder="Поиск по ключевым словам и терминам…"
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

      {allLore.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] p-12 text-center">
          <BookOpen size={32} className="mx-auto text-content-muted" />
          <h3 className="mt-3 text-base font-semibold text-zinc-200">Записей Lorebook нет</h3>
          <p className="mt-1 text-xs text-content-muted">
            Вы можете добавить факты о мире в редакторе любого персонажа (вкладка «База»).
          </p>
        </div>
      ) : filteredLore.length === 0 ? (
        <div className="p-8 text-center text-xs text-content-muted">
          Терминов не найдено.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredLore.map(({ entry, character }) => (
            <div
              key={entry.id}
              className="flex flex-col justify-between rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4 backdrop-blur-xl transition-all hover:border-white/[0.14]"
            >
              <div>
                <div className="flex items-center justify-between gap-2 pb-2">
                  <div className="flex items-center gap-2">
                    <Avatar
                      src={character.avatarUrl}
                      name={character.name}
                      size={22}
                    />
                    <span className="truncate text-xs font-bold text-zinc-200">
                      {character.name}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleLoreActive(character.id, entry.id)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium border ${
                      entry.isActive
                        ? "border-accent/40 bg-accent/15 text-accent"
                        : "border-white/[0.06] bg-surface-2 text-content-muted"
                    }`}
                  >
                    {entry.isActive && <Check size={12} />}
                    <span>{entry.isActive ? "Вкл" : "Выкл"}</span>
                  </button>
                </div>

                <div className="mb-2 flex flex-wrap gap-1">
                  {entry.keys.map((k) => (
                    <span
                      key={k}
                      className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                    >
                      #{k}
                    </span>
                  ))}
                </div>

                <p className="text-xs leading-relaxed text-content-secondary">
                  {entry.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}