import { useState, useMemo, type DragEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Reorder, useDragControls } from "framer-motion";
import {
  MessagesSquare,
  Upload,
  Pin,
  Sparkles,
} from "lucide-react";
import { db, updatePinnedSessionsOrder } from "../../db";
import { SessionRow } from "./SessionRow";
import { ChatImportModal } from "./ChatImportModal";
import type { ChatSession } from "../../types";

interface ChatsPageProps {
  onOpenSession: (sessionId: string) => void;
}

/** Компонент для плавной перестановки закрепленного чата */
function ReorderablePinnedItem({
  session,
  character,
  onOpen,
}: {
  session: ChatSession;
  character?: any;
  onOpen: () => void;
}) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={session}
      dragListener={false}
      dragControls={dragControls}
      className="relative select-none touch-none"
    >
      <SessionRow
        session={session}
        character={character}
        onOpen={onOpen}
        isDraggable
        onDragStartHandle={(e) => dragControls.start(e)}
      />
    </Reorder.Item>
  );
}

export function ChatsPage({ onOpenSession }: ChatsPageProps) {
  const sessions = useLiveQuery(
    () => db.sessions.orderBy("updatedAt").reverse().toArray(),
    []
  );
  const characters = useLiveQuery(() => db.characters.toArray(), []);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [draggedFile, setDraggedFile] = useState<File | null>(null);
  const [isWindowDragOver, setIsWindowDragOver] = useState(false);

  const charMap = useMemo(
    () => new Map((characters ?? []).map((c) => [c.id, c])),
    [characters]
  );

  const loading = sessions === undefined || characters === undefined;

  // Разделение на закрепленные и обычные чаты
  const { pinnedSessions, unpinnedSessions } = useMemo(() => {
    if (!sessions) return { pinnedSessions: [], unpinnedSessions: [] };

    const pinned = sessions
      .filter((s) => !!s.isPinned)
      .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));

    const unpinned = sessions
      .filter((s) => !s.isPinned)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return { pinnedSessions: pinned, unpinnedSessions: unpinned };
  }, [sessions]);

  const handleReorderPinned = (newOrder: ChatSession[]) => {
    void updatePinnedSessionsOrder(newOrder.map((s) => s.id));
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
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".json")) {
      setDraggedFile(file);
      setImportModalOpen(true);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        "relative min-h-[calc(100vh-80px)] w-full max-w-4xl mx-auto",
        "pl-[max(16px,env(safe-area-inset-left))]",
        "pr-[max(16px,env(safe-area-inset-right))]",
        "pt-[max(16px,env(safe-area-inset-top))] pb-8",
        "sm:px-6 sm:pb-10 sm:pt-[max(40px,env(safe-area-inset-top))]",
        "md:px-8 md:pb-[max(40px,env(safe-area-inset-bottom))]",
        "xl:px-10",
      ].join(" ")}
    >
      {/* Оверлей при Drag-and-Drop файла на всю страницу */}
      {isWindowDragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-md">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent bg-[#121622] p-8 text-center shadow-2xl">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
              <Upload size={32} />
            </div>
            <p className="text-base font-bold text-zinc-100">
              Отпустите JSON-файл для импорта ветки
            </p>
            <p className="text-xs text-content-secondary">
              Откроется окно предварительного просмотра диалога
            </p>
          </div>
        </div>
      )}

      {/* Компактный заголовок */}
      <header className="mb-4 sm:mb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-[32px]">
              Чаты
            </h1>
            <p className="hidden sm:block mt-1 text-sm text-content-secondary">
              Ваши истории и ветки диалогов.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setDraggedFile(null);
              setImportModalOpen(true);
            }}
            className="inline-flex min-h-9 sm:min-h-12 shrink-0 items-center justify-center gap-1.5 sm:gap-2 rounded-xl border border-border-strong bg-surface px-3 py-1.5 sm:px-4 sm:py-3 text-xs sm:text-sm font-semibold text-content transition-colors hover:border-accent/50 hover:bg-surface-2 active:bg-surface-3"
          >
            <Upload size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Импорт чата</span>
          </button>
        </div>
      </header>

      {loading ? (
        <div role="status" aria-label="Загрузка чатов">
          <div aria-hidden="true" className="space-y-2.5">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 sm:p-4"
              >
                <div className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-full bg-surface-3" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 rounded bg-surface-3" />
                  <div className="h-2.5 w-2/3 rounded bg-surface-2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : sessions && sessions.length > 0 ? (
        <div className="space-y-6">
          {/* Секция: Закрепленные чаты с Drag-and-Drop */}
          {pinnedSessions.length > 0 && (
            <section aria-label="Закрепленные чаты">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
                  <Pin size={13} className="rotate-45 fill-accent" />
                  <span>Закрепленные истории</span>
                </div>
                <span className="text-[11px] text-content-muted">
                  Зажмите и перетащите для сортировки
                </span>
              </div>

              <Reorder.Group
                axis="y"
                values={pinnedSessions}
                onReorder={handleReorderPinned}
                className="space-y-2.5"
              >
                {pinnedSessions.map((session) => (
                  <ReorderablePinnedItem
                    key={session.id}
                    session={session}
                    character={charMap.get(session.characterId)}
                    onOpen={() => onOpenSession(session.id)}
                  />
                ))}
              </Reorder.Group>
            </section>
          )}

          {/* Секция: Все остальные чаты */}
          {unpinnedSessions.length > 0 && (
            <section aria-label="Все остальные диалоги">
              {pinnedSessions.length > 0 && (
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-content-muted">
                    Все истории
                  </span>
                  <span className="text-xs tabular-nums text-content-muted">
                    {unpinnedSessions.length}
                  </span>
                </div>
              )}

              <ul className="space-y-2.5">
                {unpinnedSessions.map((session) => (
                  <li key={session.id}>
                    <SessionRow
                      session={session}
                      character={charMap.get(session.characterId)}
                      onOpen={() => onOpenSession(session.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <section className="flex flex-col items-center px-2 py-12 text-center">
          <div
            aria-hidden="true"
            className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"
          >
            <MessagesSquare size={26} strokeWidth={1.6} />
          </div>

          <h2 className="text-lg font-semibold tracking-tight text-content">
            Здесь начнётся ваша история
          </h2>

          <p className="mt-2 max-w-sm text-xs sm:text-sm leading-relaxed text-content-secondary">
            Пока нет ни одной ветки диалога. Выберите персонажа в библиотеке или импортируйте сохранённый файл.
          </p>

          <button
            type="button"
            onClick={() => {
              setDraggedFile(null);
              setImportModalOpen(true);
            }}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-on-accent hover:bg-accent-hover active:scale-95"
          >
            <Upload size={16} aria-hidden="true" />
            <span>Импортировать ветку (.json)</span>
          </button>
        </section>
      )}

      <ChatImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        initialFile={draggedFile}
        onSuccess={(sessionId) => {
          setImportModalOpen(false);
          onOpenSession(sessionId);
        }}
      />
    </div>
  );
}