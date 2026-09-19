import { useState, useRef, useEffect, useId } from "react";
import {
  Upload,
  User,
  MessagesSquare,
  BookOpen,
  BrainCircuit,
  NotebookPen,
  AlertCircle,
  Loader2,
  Sparkles,
  Check,
  RotateCcw,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { Avatar } from "../common/Avatar";
import { Badge } from "../common/Badge";
import {
  parseCharacterBundle,
  saveImportedCharacterBundle,
  type ParsedCharacterPreview,
} from "../../utils/characterExport";
import { cn } from "../../utils/cn";

interface CharacterImportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (characterId: string) => void;
  initialFile?: File | null;
}

export function CharacterImportModal({
  open,
  onClose,
  onSuccess,
  initialFile,
}: CharacterImportModalProps) {
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ParsedCharacterPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [customName, setCustomName] = useState<string>("");
  const [includeChats, setIncludeChats] = useState<boolean>(true);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputId = useId();

  useEffect(() => {
    if (open) {
      setError(null);
      setSaving(false);
      if (initialFile) {
        setFile(initialFile);
        void handleParseFile(initialFile);
      } else {
        setFile(null);
        setPreview(null);
      }
    }
  }, [open, initialFile]);

  const handleParseFile = async (f: File) => {
    setParsing(true);
    setError(null);
    try {
      const result = await parseCharacterBundle(f);
      setPreview(result);
      setCustomName(result.character.name);
      setIncludeChats(result.sessions.length > 0);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Не удалось прочитать файл персонажа.");
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.currentTarget.files?.[0];
    if (!selected) return;
    setFile(selected);
    void handleParseFile(selected);
    e.currentTarget.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.name.endsWith(".json")) {
      setFile(dropped);
      void handleParseFile(dropped);
    } else {
      setError("Пожалуйста, загрузите файл персонажа в формате .json.");
    }
  };

  const handleImportSubmit = async () => {
    if (!preview || saving) return;
    setSaving(true);
    setError(null);

    try {
      const { characterId } = await saveImportedCharacterBundle({
        preview,
        customName: customName.trim() || preview.character.name,
        includeChats: includeChats && preview.sessions.length > 0,
      });

      onSuccess(characterId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка при сохранении персонажа.");
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Импорт персонажа"
      size="md"
      variant="sheet"
    >
      <div className="space-y-5">
        {!preview ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "group relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-6 text-center transition-all",
              isDragOver
                ? "border-accent bg-accent/15 ring-4 ring-accent/20"
                : "border-white/[0.12] bg-[#121622]/80 hover:border-accent/60 hover:bg-[#161b28]"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-surface-2 shadow-inner transition-transform group-hover:scale-105">
              {parsing ? (
                <Loader2 size={26} className="animate-spin text-accent" />
              ) : (
                <Upload size={26} className="text-accent" />
              )}
            </div>

            <h3 className="text-sm font-bold text-zinc-100">
              {parsing ? "Анализируем файл персонажа…" : "Перетащите JSON-файл персонажа сюда"}
            </h3>
            <p className="mt-1 text-xs text-content-secondary">
              или нажмите для выбора файла на устройстве
            </p>

            <span className="mt-4 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-muted group-hover:text-content">
              Поддерживаются полные архивы NOCTURNE и одиночные карточки
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Карточка предпросмотра персонажа */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-4 shadow-lg backdrop-blur-xl">
              <div className="flex items-start gap-3.5">
                <Avatar
                  src={preview.character.avatarUrl}
                  name={preview.character.name}
                  size={58}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-bold text-zinc-100">
                      {preview.character.name}
                    </h3>
                    {preview.character.genre && (
                      <Badge size="sm">{preview.character.genre}</Badge>
                    )}
                  </div>
                  {preview.character.tagline && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-accent">
                      {preview.character.tagline}
                    </p>
                  )}
                  {preview.character.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-content-secondary">
                      {preview.character.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Бейджи контента архива */}
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-4">
                <div className="flex items-center gap-1.5 rounded-xl bg-surface-2/70 px-2.5 py-1.5 text-xs">
                  <MessagesSquare size={14} className="text-accent shrink-0" />
                  <span className="text-content-secondary tabular-nums">
                    {preview.stats.sessionsCount} веток
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-xl bg-surface-2/70 px-2.5 py-1.5 text-xs">
                  <BookOpen size={14} className="text-info shrink-0" />
                  <span className="text-content-secondary tabular-nums">
                    {preview.stats.loreCount} знаний
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-xl bg-surface-2/70 px-2.5 py-1.5 text-xs">
                  <BrainCircuit size={14} className="text-success shrink-0" />
                  <span className="text-content-secondary tabular-nums">
                    {preview.stats.factsCount} фактов
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-xl bg-surface-2/70 px-2.5 py-1.5 text-xs">
                  <NotebookPen size={14} className="text-[var(--relationship-affection)] shrink-0" />
                  <span className="text-content-secondary tabular-nums">
                    {preview.stats.diaryCount} записей
                  </span>
                </div>
              </div>
            </div>

            {/* Опции импорта */}
            <div className="space-y-3.5 rounded-2xl border border-white/[0.07] bg-surface-2/50 p-4">
              <div>
                <label
                  htmlFor={nameInputId}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-content-secondary"
                >
                  Имя персонажа при импорте
                </label>
                <input
                  id={nameInputId}
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Имя персонажа..."
                  className="input-field text-xs font-semibold"
                />
              </div>

              {preview.sessions.length > 0 && (
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-surface-2 p-3">
                  <div>
                    <p className="text-xs font-bold text-zinc-100">
                      Импортировать историю общения ({preview.stats.sessionsCount} веток)
                    </p>
                    <p className="mt-0.5 text-[11px] text-content-muted">
                      Сохранить все сообщения, дневники и накопленную память
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIncludeChats((prev) => !prev)}
                    className={cn(
                      "flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors p-0.5",
                      includeChats
                        ? "border-accent bg-accent justify-end"
                        : "border-white/[0.1] bg-surface-3 justify-start"
                    )}
                  >
                    <span className="h-4.5 w-4.5 rounded-full bg-white shadow-sm" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-content-muted hover:text-content"
              >
                <RotateCcw size={13} />
                <span>Выбрать другой файл</span>
              </button>

              <span className="text-[11px] text-content-muted">
                {preview.isFullArchive ? "Полный архив экосистемы" : "Одиночная карточка"}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/5 p-3.5 text-xs text-danger leading-relaxed"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="[overflow-wrap:anywhere]">{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 border-t border-white/[0.08] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] bg-surface-2 px-4 py-2.5 text-xs font-semibold text-content-secondary hover:bg-surface-3 hover:text-content"
          >
            Отмена
          </button>

          <button
            type="button"
            disabled={!preview || saving}
            onClick={() => void handleImportSubmit()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            <span>Импортировать персонажа</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}