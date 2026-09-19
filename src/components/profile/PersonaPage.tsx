import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ImagePlus,
  Save,
  Check,
  Loader2,
  AlertCircle,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Copy,
  UserCheck,
  X,
} from "lucide-react";
import {
  createPersona,
  deletePersona,
  getPersonaState,
  setActivePersona,
  updatePersona,
} from "../../db";
import type { Persona } from "../../types";
import { Avatar } from "../common/Avatar";
import { ImageCropperModal } from "../common/ImageCropperModal";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { MAX_SOURCE_MB } from "../../utils/image";
import { cn } from "../../utils/cn";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const EMPTY_DRAFT = { name: "", avatarUrl: "", personaDescription: "" };

export function PersonaPage() {
  // Один запрос на всё состояние: список и активная персона обновляются вместе
  // и сразу после переключения (см. комментарий в db.ts про liveQuery).
  const personaState = useLiveQuery(() => getPersonaState(), []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Persona | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const editorOpen = creating || editingId !== null;

  const startCreate = (from?: Persona) => {
    setError(null);
    setSaved(false);
    setCreating(true);
    setEditingId(null);
    setDraft(
      from
        ? { ...from, name: `${from.name} (копия)` }
        : { ...EMPTY_DRAFT }
    );
  };

  const startEdit = (persona: Persona) => {
    setError(null);
    setSaved(false);
    setCreating(false);
    setEditingId(persona.id);
    setDraft({
      name: persona.name,
      avatarUrl: persona.avatarUrl,
      personaDescription: persona.personaDescription,
    });
  };

  const closeEditor = () => {
    setCreating(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    try {
      if (file.size > MAX_SOURCE_MB * 1024 * 1024) {
        throw new Error(
          `Файл слишком большой (${Math.round(file.size / 1024 / 1024)} МБ). Максимум — ${MAX_SOURCE_MB} МБ.`
        );
      }

      setCropImage(await fileToDataUrl(file));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось прочитать выбранное изображение."
      );
    } finally {
      event.currentTarget.value = "";
    }
  };

  const handleSave = async () => {
    if (saving) return;

    if (!draft.name.trim()) {
      setError("Укажите имя персоны — именно так вас будут называть персонажи.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (creating) {
        const created = await createPersona({
          name: draft.name,
          avatarUrl: draft.avatarUrl,
          personaDescription: draft.personaDescription,
        });
        // Новая персона сразу становится активной: её и ждали от создания.
        await setActivePersona(created.id);
      } else if (editingId) {
        await updatePersona(editingId, {
          name: draft.name,
          avatarUrl: draft.avatarUrl,
          personaDescription: draft.personaDescription,
        });
      }

      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
      closeEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сохранения.");
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (persona: Persona) => {
    setError(null);
    try {
      await setActivePersona(persona.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сменить персону.");
    }
  };

  const handleDelete = async (persona: Persona) => {
    setError(null);
    try {
      await deletePersona(persona.id);
      if (editingId === persona.id) closeEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось удалить персону.");
    }
  };

  const list = personaState?.personas ?? [];
  const active = personaState?.activePersona ?? list[0];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
            Личность и альтер-эго
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Мои персоны
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-content-secondary">
            Кем вы предстаёте перед персонажами. Активная персона подмешивается
            в системный контекст диалога — можно держать сколько угодно разных
            «себя» и переключаться между ними.
          </p>
        </div>

        <button
          type="button"
          onClick={() => startCreate()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent shadow-sm transition-colors hover:bg-accent-hover"
        >
          <Plus size={16} strokeWidth={2} />
          Создать персону
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-xs text-danger"
        >
          <AlertCircle size={16} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Скрыть сообщение"
            className="shrink-0 text-danger/70 hover:text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {personaState === undefined ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Активная персона */}
          {active && (
            <section className="rounded-3xl border border-white/[0.08] bg-[#121620]/90 p-6 shadow-xl backdrop-blur-xl">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <Avatar src={active.avatarUrl} name={active.name} size={96} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
                    <Sparkles size={14} />
                    <span>Активная персона</span>
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-zinc-100">
                    {active.name || "Странник"}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-xs text-content-secondary">
                    {active.personaDescription || "Загадочный гость этого мира."}
                  </p>

                  <button
                    type="button"
                    onClick={() => startEdit(active)}
                    className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 text-xs font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content"
                  >
                    <Pencil size={13} />
                    Редактировать
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Редактор */}
          {editorOpen && (
            <section className="space-y-5 rounded-3xl border border-accent/25 bg-[#121620]/90 p-6 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-100">
                  {creating ? "Новая персона" : "Редактирование персоны"}
                </h2>
                <button
                  type="button"
                  onClick={closeEditor}
                  aria-label="Закрыть редактор"
                  className="rounded-lg p-1 text-content-muted hover:text-content"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <Avatar src={draft.avatarUrl} name={draft.name || "Странник"} size={72} />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.1] bg-accent text-on-accent shadow-md transition-transform hover:scale-105"
                    title="Сменить аватар"
                  >
                    <ImagePlus size={16} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarFile}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-content-secondary">
                    Имя в ролевых историях
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Например: Алекс"
                    className="input-field text-sm font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-content-secondary">
                  Описание персоны (Persona Context)
                </label>
                <p className="mb-2 text-xs text-content-muted">
                  Этот текст подмешивается в системный контекст диалога. Опишите
                  внешность, манеры, социальный статус или предысторию вашего
                  альтер-эго.
                </p>
                <textarea
                  rows={7}
                  value={draft.personaDescription}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      personaDescription: event.target.value,
                    }))
                  }
                  placeholder="Высокий парень в темном пальто, сдержанный, внимательный к деталям..."
                  className="input-field resize-y text-sm leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                <span className="text-xs text-content-muted">
                  {saved
                    ? "✓ Сохранено."
                    : creating
                      ? "Новая персона сразу станет активной."
                      : "Изменения влияют на все новые ответы модели."}
                </span>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/[0.08] px-4 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : saved ? (
                      <Check size={16} />
                    ) : (
                      <Save size={16} />
                    )}
                    <span>{creating ? "Создать" : "Сохранить"}</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Список всех персон */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-100">
              Все персоны
              <span className="ml-2 text-xs font-normal text-content-muted">
                {list.length}
              </span>
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((persona) => {
                const isActive = persona.id === active?.id;
                return (
                  <article
                    key={persona.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-2xl border p-4 transition-colors",
                      isActive
                        ? "border-accent/40 bg-accent/[0.06]"
                        : "border-white/[0.07] bg-[#121620]/90"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar src={persona.avatarUrl} name={persona.name} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-zinc-100">
                            {persona.name || "Странник"}
                          </p>
                          {isActive && (
                            <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                              активна
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-content-muted">
                          {persona.personaDescription || "Без описания"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => void handleActivate(persona)}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-2.5 text-[11px] font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content"
                        >
                          <UserCheck size={13} />
                          Сделать активной
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(persona)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-2.5 text-[11px] font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content"
                      >
                        <Pencil size={13} />
                        Изменить
                      </button>
                      <button
                        type="button"
                        onClick={() => startCreate(persona)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-2.5 text-[11px] font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content"
                      >
                        <Copy size={13} />
                        Дублировать
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(persona)}
                        disabled={list.length <= 1}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-danger/20 bg-danger/5 px-2.5 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                        Удалить
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <p className="text-[11px] leading-relaxed text-content-muted">
            Персоны хранятся в этом браузере вместе с историями и попадают в
            резервную копию.
          </p>
        </div>
      )}

      <ImageCropperModal
        open={!!cropImage}
        imageSrc={cropImage}
        onClose={() => setCropImage(null)}
        onCropComplete={(cropped) => {
          setCropImage(null);
          setDraft((current) => ({ ...current, avatarUrl: cropped }));
        }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Удалить персону?"
        description={
          pendingDelete
            ? `«${pendingDelete.name}» исчезнет из списка. История диалогов и персонажи останутся на месте.`
            : ""
        }
        confirmLabel="Удалить"
        tone="danger"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
        }}
      />
    </div>
  );
}
