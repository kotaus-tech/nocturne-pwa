import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BrainCircuit,
  Search,
  Pin,
  Trash2,
  Plus,
} from "lucide-react";
import { db } from "../../db";
import { Avatar } from "../common/Avatar";
import { MysteryPlaceholder } from "../common/MysteryPlaceholder";
import { newId } from "../../utils/id";
import type { ExtractedFact, Character, ChatSession } from "../../types";

export function MemoryPage() {
  const [query, setQuery] = useState("");
  const [characterFilter, setCharacterFilter] = useState<string>("all");
  const [newFactContent, setNewFactContent] = useState("");
  const [selectedCharId, setSelectedCharId] = useState<string>("");
  const [addingOpen, setAddingOpen] = useState(false);

  const characters = useLiveQuery(() => db.characters.toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);

  const characterMap = useMemo(
    () => new Map((characters ?? []).map((c) => [c.id, c])),
    [characters]
  );

  // Сбор всех фактов из всех сессий
  const allFacts = useMemo(() => {
    if (!sessions || !characters) return [];
    const list: {
      fact: ExtractedFact;
      session: ChatSession;
      character: Character;
    }[] = [];

    for (const session of sessions) {
      const character = characterMap.get(session.characterId);
      if (!character) continue;

      for (const fact of session.extractedFacts ?? []) {
        list.push({ fact, session, character });
      }
    }

    return list.sort((a, b) => {
      if (a.fact.isPinned && !b.fact.isPinned) return -1;
      if (!a.fact.isPinned && b.fact.isPinned) return 1;
      return b.fact.createdAt - a.fact.createdAt;
    });
  }, [sessions, characters, characterMap]);

  const filteredFacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allFacts.filter((item) => {
      if (characterFilter !== "all" && item.character.id !== characterFilter) {
        return false;
      }
      if (!q) return true;
      // В режиме тайны текст и ключи скрыты: поиск по ним не работает,
      // иначе список раскрыл бы содержимое косвенно.
      const searchable = !item.session.mysteryMode;
      return (
        (searchable && item.fact.content.toLowerCase().includes(q)) ||
        (searchable && item.fact.keys.some((k) => k.toLowerCase().includes(q))) ||
        item.character.name.toLowerCase().includes(q)
      );
    });
  }, [allFacts, query, characterFilter]);

  const togglePin = async (sessionId: string, factId: string) => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;

    const updated = (session.extractedFacts || []).map((f) =>
      f.id === factId ? { ...f, isPinned: !f.isPinned } : f
    );
    await db.sessions.update(sessionId, { extractedFacts: updated });
  };

  const deleteFact = async (sessionId: string, factId: string) => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;

    const updated = (session.extractedFacts || []).filter((f) => f.id !== factId);
    await db.sessions.update(sessionId, { extractedFacts: updated });
  };

  const handleCreateFact = async () => {
    if (!newFactContent.trim() || !selectedCharId) return;
    const session = (sessions || []).find((s) => s.characterId === selectedCharId);
    if (!session) return;

    const newFact: ExtractedFact = {
      id: newId(),
      keys: ["Заметка"],
      content: newFactContent.trim(),
      createdAt: Date.now(),
      isPinned: true,
    };

    const updated = [...(session.extractedFacts || []), newFact];
    await db.sessions.update(session.id, { extractedFacts: updated });
    setNewFactContent("");
    setAddingOpen(false);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
            Нейросетевая память
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Хранилище памяти
          </h1>
          <p className="mt-1 text-sm text-content-secondary">
            Факты, обещания и воспоминания, автоматически извлеченные моделью из ваших диалогов.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (characters && characters.length > 0) {
              setSelectedCharId(characters[0].id);
              setAddingOpen(true);
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent shadow-sm hover:bg-accent-hover"
        >
          <Plus size={16} />
          <span>Добавить факт</span>
        </button>
      </header>

      {/* Панель поиска и фильтров */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#121620]/90 p-2.5 backdrop-blur-xl">
        <div className="flex flex-1 min-w-[200px] items-center gap-2 rounded-xl border border-white/[0.06] bg-surface-2 px-3 py-2">
          <Search size={16} className="text-content-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по воспоминаниям и персонажам…"
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

      {addingOpen && (
        <div className="mb-6 rounded-3xl border border-accent/40 bg-[#121620]/95 p-5 shadow-2xl backdrop-blur-xl">
          <h3 className="text-sm font-bold text-zinc-100">Новое воспоминание</h3>
          <div className="mt-3 space-y-3">
            <select
              value={selectedCharId}
              onChange={(e) => setSelectedCharId(e.target.value)}
              className="input-field text-xs"
            >
              {(characters || []).map((c) => (
                <option key={c.id} value={c.id}>
                  Персонаж: {c.name}
                </option>
              ))}
            </select>
            <textarea
              rows={3}
              value={newFactContent}
              onChange={(e) => setNewFactContent(e.target.value)}
              placeholder="Что персонаж должен навсегда помнить? (Например: Алекс подарил мне серебряный кулон)"
              className="input-field text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddingOpen(false)}
                className="rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs text-content-muted hover:bg-surface-3"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleCreateFact}
                className="rounded-xl bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent"
              >
                Сохранить в память
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Список фактов */}
      {allFacts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] p-12 text-center">
          <BrainCircuit size={32} className="mx-auto text-content-muted" />
          <h3 className="mt-3 text-base font-semibold text-zinc-200">Память пуста</h3>
          <p className="mt-1 text-xs text-content-muted">
            По мере развития диалогов искусственный интеллект автоматически извлекает важные факты и фиксирует их здесь.
          </p>
        </div>
      ) : filteredFacts.length === 0 ? (
        <div className="p-8 text-center text-xs text-content-muted">
          Нет совпадений по текущему фильтру.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredFacts.map(({ fact, session, character }) => (
            <div
              key={fact.id}
              className="group relative flex flex-col justify-between rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4 backdrop-blur-xl transition-all hover:border-white/[0.14] hover:bg-[#161b26]"
            >
              <div>
                <div className="flex items-center justify-between gap-2 pb-2">
                  <div className="flex items-center gap-2">
                    <Avatar
                      src={character.avatarUrl}
                      name={character.name}
                      size={24}
                    />
                    <span className="truncate text-xs font-bold text-zinc-200">
                      {character.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => togglePin(session.id, fact.id)}
                      title={fact.isPinned ? "Открепить" : "Закрепить"}
                      className={`p-1.5 rounded-lg transition-colors ${
                        fact.isPinned
                          ? "text-accent bg-accent/15"
                          : "text-content-muted hover:text-content"
                      }`}
                    >
                      <Pin size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteFact(session.id, fact.id)}
                      title="Удалить воспоминание"
                      className="p-1.5 rounded-lg text-content-muted hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {session.mysteryMode ? (
                  <MysteryPlaceholder lines={2} />
                ) : (
                  <blockquote className="novel-font text-xs italic leading-relaxed text-zinc-300">
                    «{fact.content}»
                  </blockquote>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2 text-[10px] text-content-muted">
                <span className="truncate">Ветка: {session.title}</span>
                <span>{new Date(fact.createdAt).toLocaleDateString("ru-RU")}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}