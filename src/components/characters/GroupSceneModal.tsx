import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Loader2, Search, Sparkles, Users, Wand2, X } from "lucide-react";
import { Modal } from "../common/Modal";
import { Avatar } from "../common/Avatar";
import { db } from "../../db";
import { createGroupSession } from "../../utils/sessionActions";
import { GROUP_SIZE_MAX, GROUP_SIZE_MIN } from "../../services/characterGenerator";
import { cn } from "../../utils/cn";
import type { Character } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Открывает AI-генератор группы (создание героев с нуля). */
  onOpenGenerator?: () => void;
  /** Персонаж, который уже выбран лидером сцены и не снимается. */
  lockedId?: string;
  onCreated: (sessionId: string) => void;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
}

/**
 * Сборка групповой сцены из готовых персонажей библиотеки.
 * Первый выбранный становится лидером сцены (к нему же привязана ветка).
 */
export function GroupSceneModal({
  open,
  onClose,
  onOpenGenerator,
  lockedId,
  onCreated,
}: Props) {
  const characters = useLiveQuery(() => db.characters.toArray(), []);

  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(lockedId ? [lockedId] : []);
    setQuery("");
    setError(null);
  }, [open, lockedId]);

  const sorted = useMemo(
    () =>
      [...(characters ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, "ru", { sensitivity: "base" })
      ),
    [characters]
  );

  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return sorted;
    return sorted.filter((item) =>
      normalize(
        [item.name, item.tagline, item.description, item.genre]
          .filter(Boolean)
          .join(" ")
      ).includes(needle)
    );
  }, [sorted, query]);

  const toggle = (character: Character) => {
    if (character.id === lockedId) return;

    setSelected((prev) => {
      if (prev.includes(character.id)) {
        return prev.filter((id) => id !== character.id);
      }
      if (prev.length >= GROUP_SIZE_MAX) return prev;
      return [...prev, character.id];
    });
  };

  const handleCreate = async () => {
    if (creating || selected.length < GROUP_SIZE_MIN || !characters) return;

    const picked = selected
      .map((id) => characters.find((item) => item.id === id))
      .filter((item): item is Character => Boolean(item));

    if (picked.length < GROUP_SIZE_MIN) {
      setError("Выберите хотя бы двух персонажей.");
      return;
    }

    const [leader, ...rest] = picked;

    setCreating(true);
    setError(null);
    try {
      const session = await createGroupSession(leader, rest);
      onCreated(session.id);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось создать сцену."
      );
    } finally {
      setCreating(false);
    }
  };

  const selectedCharacters = selected
    .map((id) => sorted.find((item) => item.id === id))
    .filter((item): item is Character => Boolean(item));

  const enough = selected.length >= GROUP_SIZE_MIN;

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      size="lg"
      title="Групповая сцена"
    >
      <div className="space-y-4">
        <p className="text-xs sm:text-sm leading-relaxed text-content-secondary">
          Соберите сцену из {GROUP_SIZE_MIN}–{GROUP_SIZE_MAX} персонажей: они
          окажутся в одной истории, будут отвечать по очереди и видеть реплики
          друг друга.
        </p>

        {onOpenGenerator && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenGenerator();
            }}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-accent/35 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 sm:text-sm"
          >
            <Wand2 size={15} strokeWidth={1.9} />
            <span>Сгенерировать новую группу с AI</span>
            <Sparkles size={13} strokeWidth={1.9} />
          </button>
        )}

        {sorted.length > 6 && (
          <div className="relative">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти персонажа…"
              aria-label="Поиск персонажа для сцены"
              className="input-field input-field--icon-left input-field--icon-right"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Очистить поиск"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-content-muted hover:text-content"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {selectedCharacters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-accent/25 bg-accent/[0.07] p-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
              <Users size={13} strokeWidth={2} />
              {selectedCharacters.length}/{GROUP_SIZE_MAX}
            </span>
            {selectedCharacters.map((item, index) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.09] bg-[#121622]/80 py-0.5 pl-0.5 pr-1.5"
              >
                <Avatar src={item.avatarUrl} name={item.name} size={20} />
                <span className="max-w-[9rem] truncate text-[11px] font-medium text-zinc-200">
                  {item.name}
                </span>
                {index === 0 ? (
                  <span className="text-[10px] uppercase tracking-wider text-content-muted">
                    лидер
                  </span>
                ) : (
                  item.id !== lockedId && (
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      aria-label={`Убрать ${item.name}`}
                      className="rounded-full p-0.5 text-content-muted transition-colors hover:text-danger"
                    >
                      <X size={11} />
                    </button>
                  )
                )}
              </span>
            ))}
          </div>
        )}

        <div className="max-h-[320px] overflow-y-auto pr-1">
          {characters === undefined ? (
            <p className="text-xs text-content-muted">Загрузка…</p>
          ) : sorted.length === 0 ? (
            <p className="text-xs leading-relaxed text-content-secondary">
              В библиотеке пока нет персонажей. Создайте их в разделе
              «Персонажи» или сгенерируйте группу с AI.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-content-muted">
              По запросу «{query}» никого не нашлось.
            </p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((character) => {
                const isSelected = selected.includes(character.id);
                const isLocked = character.id === lockedId;
                const full =
                  !isSelected && selected.length >= GROUP_SIZE_MAX;

                return (
                  <li key={character.id}>
                    <button
                      type="button"
                      onClick={() => toggle(character)}
                      disabled={full || isLocked}
                      aria-pressed={isSelected}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors",
                        isSelected
                          ? "border-accent/45 bg-accent/[0.09]"
                          : "border-white/[0.07] bg-[#121622]/70 hover:border-accent/30",
                        (full || isLocked) && !isSelected && "opacity-45"
                      )}
                    >
                      <Avatar
                        src={character.avatarUrl}
                        name={character.name}
                        size={38}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-100">
                          {character.name}
                        </span>
                        <span className="block truncate text-[11px] text-content-secondary">
                          {character.tagline || character.genre || "Без описания"}
                        </span>
                      </span>
                      {isSelected && (
                        <Check
                          size={16}
                          strokeWidth={2.4}
                          className="shrink-0 text-accent"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
          <span className="text-[11px] text-content-muted">
            {enough
              ? `В сцене будет ${selected.length} героя`
              : `Нужно минимум ${GROUP_SIZE_MIN} героя`}
          </span>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!enough || creating}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
          >
            {creating ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Users size={15} strokeWidth={2} />
            )}
            <span>Собрать сцену</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
