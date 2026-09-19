import { useState, useRef, useEffect, useId } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Upload,
  FileText,
  Check,
  AlertCircle,
  Loader2,
  Sparkles,
  UserPlus,
  MessagesSquare,
  ArrowRight,
  Heart,
  Sliders,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { Avatar } from "../common/Avatar";
import { Badge } from "../common/Badge";
import { db } from "../../db";
import {
  parseChatBundle,
  saveImportedSession,
  type ParsedChatPreview,
} from "../../utils/chatExport";
import type { Character } from "../../types";
import { cn } from "../../utils/cn";

interface ChatImportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (sessionId: string) => void;
  initialCharacterId?: string;
  initialFile?: File | null;
}

export function ChatImportModal({
  open,
  onClose,
  onSuccess,
  initialCharacterId,
  initialFile,
}: ChatImportModalProps) {
  const characters = useLiveQuery(() => db.characters.toArray(), []);

  const [file, setFile] = useState<File | null>(initialFile || null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ParsedChatPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedCharacterId, setSelectedCharacterId] = useState<string>("");
  const [createNewCharacter, setCreateNewCharacter] = useState<boolean>(false);
  const [customTitle, setCustomTitle] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputId = useId();
  const characterSelectId = useId();

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

  useEffect(() => {
    if (characters && characters.length > 0) {
      if (initialCharacterId) {
        setSelectedCharacterId(initialCharacterId);
        setCreateNewCharacter(false);
      } else if (!selectedCharacterId) {
        setSelectedCharacterId(characters[0].id);
      }
    }
  }, [characters, initialCharacterId]);

  const handleParseFile = async (f: File) => {
    setParsing(true);
    setError(null);
    try {
      const result = await parseChatBundle(f);
      setPreview(result);
      setCustomTitle(result.title);

      if (initialCharacterId) {
        setSelectedCharacterId(initialCharacterId);
        setCreateNewCharacter(false);
      } else if (result.character) {
        const found = (characters || []).find(
          (c) =>
            c.id === result.character?.id ||
            c.name.trim().toLowerCase() === result.character?.name.trim().toLowerCase()
        );
        if (found) {
          setSelectedCharacterId(found.id);
          setCreateNewCharacter(false);
        } else {
          setCreateNewCharacter(true);
        }
      }
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Не удалось прочитать файл чата.");
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
      setError("Пожалуйста, загрузите файл резервной копии чата в формате .json.");
    }
  };

  const handleImportSubmit = async () => {
    if (!preview || saving) return;
    setSaving(true);
    setError(null);

    try {
      const targetId = createNewCharacter ? "" : selectedCharacterId;
      const { sessionId } = await saveImportedSession({
        preview,
        targetCharacterId: targetId,
        customTitle: customTitle.trim() || preview.title,
        createNewCharacter,
      });

      onSuccess(sessionId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка при сохранении ветки.");
      setSaving(false);
    }
  };

  const selectedChar = (characters || []).find((c) => c.id === selectedCharacterId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Импорт ветки диалога"
      size="md"
      variant="sheet"
    >
      <div className="space-y-5">
        {/* Зона загрузки файла / Drag and Drop */}
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
              {parsing ? "Анализируем файл истории…" : "Перетащите файл .json сюда"}
            </h3>
            <p className="mt-1 text-xs text-content-secondary">
              или нажмите для выбора файла на устройстве
            </p>

            <span className="mt-4 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-muted group-hover:text-content">
              Поддерживаются форматы NOCTURNE и AnimaRP
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Карточка превью импортируемого чата */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-4 shadow-lg backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    src={preview.character?.avatarUrl}
                    name={preview.character?.name || "Персонаж"}
                    size={46}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-zinc-100">
                        {preview.character?.name || "Оригинальный персонаж"}
                      </span>
                      {preview.character?.genre && (
                        <Badge size="sm">{preview.character.genre}</Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-accent font-medium mt-0.5">
                      {preview.title}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-content-muted shrink-0">
                  <MessagesSquare size={13} className="text-accent" />
                  <span>{preview.messagesCount} сообщ.</span>
                </div>
              </div>

              {/* Последняя реплика */}
              <div className="mt-3 rounded-xl border border-white/[0.06] bg-surface-2/60 p-2.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">
                  Последняя реплика сюжета
                </span>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-300 italic">
                  «{preview.lastMessagePreview}»
                </p>
              </div>

              {/* Шкалы отношений, если есть */}
              {preview.stats && (
                <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[11px] text-content-muted">
                  <span className="flex items-center gap-1 text-accent font-medium">
                    <Heart size={12} fill="currentColor" />
                    <span>{preview.stats.statusTitle || "Знакомство"}</span>
                  </span>
                  <span>
                    Доверие: {preview.stats.trust}% · Симпатия: {preview.stats.affection}%
                  </span>
                </div>
              )}
            </div>

            {/* Настройки импорта */}
            <div className="space-y-3.5 rounded-2xl border border-white/[0.07] bg-surface-2/50 p-4">
              <div>
                <label
                  htmlFor={titleInputId}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-content-secondary"
                >
                  Название ветки
                </label>
                <input
                  id={titleInputId}
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Введите название ветки..."
                  className="input-field text-xs font-medium"
                />
              </div>

              {/* Выбор персонажа */}
              <div>
                <label
                  htmlFor={characterSelectId}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-content-secondary"
                >
                  Привязка к персонажу
                </label>

                {preview.character && (
                  <div className="mb-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateNewCharacter(true)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 px-3 text-xs font-medium transition-all",
                        createNewCharacter
                          ? "border-accent bg-accent/20 text-accent font-semibold shadow-sm"
                          : "border-white/[0.08] bg-surface-2 text-content-muted hover:text-content"
                      )}
                    >
                      <UserPlus size={14} />
                      <span className="truncate">Создать «{preview.character.name}»</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCreateNewCharacter(false)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 px-3 text-xs font-medium transition-all",
                        !createNewCharacter
                          ? "border-accent bg-accent/20 text-accent font-semibold shadow-sm"
                          : "border-white/[0.08] bg-surface-2 text-content-muted hover:text-content"
                      )}
                    >
                      <Check size={14} />
                      <span>Существующий</span>
                    </button>
                  </div>
                )}

                {!createNewCharacter && (
                  <div className="space-y-1.5">
                    <select
                      id={characterSelectId}
                      value={selectedCharacterId}
                      onChange={(e) => setSelectedCharacterId(e.target.value)}
                      className="input-field text-xs"
                    >
                      {(characters || []).map((char) => (
                        <option key={char.id} value={char.id}>
                          {char.name} {char.genre ? `(${char.genre})` : ""}
                        </option>
                      ))}
                    </select>

                    {selectedChar && (
                      <p className="text-[11px] text-content-muted">
                        Ветка будет добавлена в карточку персонажа «{selectedChar.name}».
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                }}
                className="text-xs text-content-muted hover:text-content"
              >
                Выбрать другой файл
              </button>
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
            <span>Импортировать ветку</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}