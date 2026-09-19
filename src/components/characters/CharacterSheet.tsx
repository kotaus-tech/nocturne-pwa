import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Trash2,
  Copy,
  Download,
  Upload,
  Loader2,
  AlertCircle,
  MessagesSquare,
  Sparkles,
  Pin,
  Wand2,
} from "lucide-react";
import { db, toggleCharacterFavorite } from "../../db";
import type { Character } from "../../types";
import {
  createSession,
  deleteCharacterCascade,
} from "../../utils/sessionActions";
import { exportCharacterFullBundle } from "../../utils/characterExport";
import { SessionRow } from "../chats/SessionRow";
import { Badge } from "../common/Badge";
import { FavoriteButton } from "../common/FavoriteButton";
import { Avatar } from "../common/Avatar";
import { ImagePromptModal } from "../common/ImagePromptModal";
import { ChatImportModal } from "../chats/ChatImportModal";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { renderRoleplayText } from "../../utils/textRenderer";
import { newId } from "../../utils/id";
import { cn } from "../../utils/cn";

interface CharacterSheetProps {
  character: Character | null;
  onClose: () => void;
  onEdit: (character: Character) => void;
  onOpenSession: (sessionId: string) => void;
}

export function CharacterSheet({
  character,
  onClose,
  onEdit,
  onOpenSession,
}: CharacterSheetProps) {
  const sessions = useLiveQuery(async () => {
    if (!character) return [];
    const list = await db.sessions
      .where("characterId")
      .equals(character.id)
      .sortBy("updatedAt");
    return list.reverse();
  }, [character?.id]);

  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [pending, setPending] = useState<"create" | "delete" | "duplicate" | "export" | null>(
    null
  );
  const [operationError, setOperationError] = useState<string | null>(null);

  if (!character) return null;

  const handleCreateSession = async () => {
    if (pending) return;
    setPending("create");
    setOperationError(null);

    try {
      const session = await createSession(character);
      onOpenSession(session.id);
      onClose();
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "Не удалось создать ветку диалога."
      );
    } finally {
      setPending(null);
    }
  };

  const handleDelete = async () => {
    if (pending) return;

    setPending("delete");
    try {
      await deleteCharacterCascade(character.id);
      onClose();
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "Не удалось удалить персонажа."
      );
    } finally {
      setPending(null);
    }
  };

  const handleDuplicate = async () => {
    if (pending) return;
    setPending("duplicate");
    try {
      const duplicated: Character = {
        ...character,
        id: newId(),
        name: `${character.name} (копия)`,
        createdAt: Date.now(),
      };
      await db.characters.add(duplicated);
      onClose();
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "Не удалось дублировать персонажа."
      );
    } finally {
      setPending(null);
    }
  };

  const handleTogglePin = async () => {
    await db.characters.update(character.id, { isPinned: !character.isPinned });
  };

  const handleFullExport = async () => {
    if (pending) return;
    setPending("export");
    setOperationError(null);

    try {
      await exportCharacterFullBundle(character.id);
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "Не удалось экспортировать архив персонажа."
      );
    } finally {
      setPending(null);
    }
  };

  const originTag = character.originTag?.trim() || "ОРИГИНАЛЬНЫЙ ПЕРСОНАЖ";
  const firstImpression = character.firstImpression?.trim() || character.personality?.trim();
  const startingPoint = character.startingPoint?.trim() || character.scenario?.trim();
  const tags = character.tags?.filter((t) => t.trim().length > 0) ?? [];
  const genre = character.genre?.trim();

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#090b10] text-content">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:px-8">
          <div className="mb-6">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 text-sm font-medium text-content-secondary transition-colors hover:text-accent"
            >
              <ArrowLeft size={16} />
              <span>Библиотека персонажей</span>
            </button>
          </div>

          {operationError && (
            <div
              role="alert"
              className="mb-6 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
            >
              <AlertCircle size={18} className="shrink-0" />
              <span>{operationError}</span>
            </div>
          )}

          <div className="grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl border border-white/[0.08] bg-[#121620] shadow-2xl">
              {character.avatarUrl ? (
                <img
                  src={character.avatarUrl}
                  alt={character.name}
                  className="h-full w-full object-cover object-center"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Avatar name={character.name} size={96} />
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#090b10]/90 via-transparent to-black/30" />
              {genre && (
                <div className="absolute left-4 top-4">
                  <Badge variant="outline">{genre}</Badge>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between space-y-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-content-muted">
                  {originTag}
                </p>

                <div className="mt-1 flex items-center gap-3">
                  <h1 className="text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
                    {character.name}
                  </h1>
                  {character.isPinned && (
                    <Pin size={18} className="rotate-45 text-accent fill-accent shrink-0" />
                  )}
                </div>

                {character.tagline && (
                  <p className="mt-1 text-base font-medium text-accent">
                    {character.tagline}
                  </p>
                )}

                {character.description && (
                  <p className="mt-3 text-sm leading-relaxed text-content-secondary">
                    {character.description}
                  </p>
                )}

                {tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/[0.07] bg-surface-2 px-3 py-1 text-xs font-medium text-content-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Основные действия */}
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void handleCreateSession()}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-all hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-50"
                  >
                    {pending === "create" ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    <span>Начать историю</span>
                    <Plus size={15} />
                  </button>

                  <button
                    type="button"
                    onClick={() => onEdit(character)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-3"
                  >
                    <Pencil size={15} />
                    <span>Редактировать</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPromptModalOpen(true)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-accent/40 hover:text-accent hover:bg-surface-3"
                  >
                    <Wand2 size={15} className="text-accent" />
                    <span>Сгенерировать промпт</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleTogglePin()}
                    title={character.isPinned ? "Открепить" : "Закрепить вверху"}
                    className={cn(
                      "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-all",
                      character.isPinned
                        ? "border-accent/50 bg-accent/20 text-accent shadow-sm"
                        : "border-white/[0.08] bg-surface-2 text-content-secondary hover:bg-surface-3 hover:text-content"
                    )}
                  >
                    <Pin size={14} className={character.isPinned ? "rotate-45 fill-accent" : ""} />
                    <span>{character.isPinned ? "Закреплен" : "Закрепить"}</span>
                  </button>

                  <FavoriteButton
                    isFavorite={!!character.isFavorite}
                    onToggle={() => void toggleCharacterFavorite(character.id)}
                  />
                </div>

                {(firstImpression || startingPoint) && (
                  <div className="mt-6 space-y-3">
                    {firstImpression && (
                      <div className="rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-content-muted">
                          За первым впечатлением
                        </h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-content-secondary">
                          {firstImpression}
                        </p>
                      </div>
                    )}

                    {startingPoint && (
                      <div className="rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-content-muted">
                          Точка отсчета
                        </h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-content-secondary">
                          {startingPoint}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 pt-2 text-xs font-medium text-content-muted">
                <button
                  type="button"
                  onClick={() => void handleDuplicate()}
                  className="flex items-center gap-1.5 transition-colors hover:text-content"
                >
                  <Copy size={14} />
                  <span>Дублировать</span>
                </button>

                <button
                  type="button"
                  disabled={pending === "export"}
                  onClick={() => void handleFullExport()}
                  className="flex items-center gap-1.5 transition-colors hover:text-accent disabled:opacity-50"
                  title="Экспортировать персонажа со всеми ветками диалогов, дневниками и воспоминаниями"
                >
                  {pending === "export" ? (
                    <Loader2 size={14} className="animate-spin text-accent" />
                  ) : (
                    <Download size={14} />
                  )}
                  <span>Полный архив (.json)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  className="flex items-center gap-1.5 text-danger/80 transition-colors hover:text-danger"
                >
                  <Trash2 size={14} />
                  <span>Удалить</span>
                </button>
              </div>
            </div>
          </div>

          <section className="mt-10">
            <h2 className="mb-3 text-base font-semibold text-zinc-100">
              Первое сообщение
            </h2>
            <div className="rounded-2xl border border-white/[0.08] bg-[#121620]/90 p-5 leading-relaxed shadow-lg">
              <div className="novel-font text-sm text-zinc-200">
                {renderRoleplayText(character.firstMessage)}
              </div>
            </div>
          </section>

          <section className="mt-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-zinc-100">
                  Существующие ветки диалога
                </h2>
                {sessions && (
                  <span className="text-xs tabular-nums text-content-muted">
                    ({sessions.length})
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-accent/40 hover:text-accent hover:bg-surface-3"
              >
                <Upload size={14} />
                <span>Импортировать ветку</span>
              </button>
            </div>

            {sessions === undefined ? (
              <div className="flex items-center gap-2 py-4 text-xs text-content-secondary">
                <Loader2 size={15} className="animate-spin text-accent" />
                <span>Загружаем ветки…</span>
              </div>
            ) : sessions.length > 0 ? (
              <ul className="space-y-3">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <SessionRow
                      session={session}
                      character={character}
                      onOpen={() => {
                        onOpenSession(session.id);
                        onClose();
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-[#121620]/60 p-4">
                <div className="flex items-center gap-3">
                  <MessagesSquare size={20} className="text-content-muted shrink-0" />
                  <p className="text-xs text-content-muted">
                    У вас пока нет активных веток диалога с этим персонажем.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className="shrink-0 text-xs font-semibold text-accent hover:underline"
                >
                  Импортировать
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        tone="danger"
        title={`Удалить персонажа «${character.name}»?`}
        description="Вместе с ним будут удалены все его ветки диалогов, дневники и воспоминания. Действие необратимо."
        confirmLabel="Удалить персонажа"
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => handleDelete()}
      />

      <ImagePromptModal
        open={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        character={character}
      />

      <ChatImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        initialCharacterId={character.id}
        onSuccess={(sessionId) => {
          setImportModalOpen(false);
          onOpenSession(sessionId);
          onClose();
        }}
      />
    </>
  );
}