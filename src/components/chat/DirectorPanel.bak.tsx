import { useState, useEffect, useRef } from "react";
import {
  Clapperboard,
  Sparkles,
  Loader2,
  Zap,
  HeartHandshake,
  ShieldCheck,
  Image as ImageIcon,
  Upload,
  Trash2,
  Flame,
  AlertTriangle,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { AmbientPlayer } from "./AmbientPlayer";
import { db } from "../../db";
import type { ChatSession } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  session: ChatSession;
  onUpdateNotes: (notes: string) => void;
  onCompressMemory: () => Promise<void>;
  onUpdateDim: (dim: number) => void;
  onUpdateBlur: (blur: number) => void;
  onUpdateWallpaper: (url: string | undefined) => void;
  onToggleDynamicEvents?: (enabled: boolean) => void;
  onToggleSuspenseMode?: (enabled: boolean) => void;
  onToggleToasts?: (enabled: boolean) => void;
  onTogglePacing?: (enabled: boolean) => void;
  messageCount: number;
}

export function DirectorPanel({
  open,
  onClose,
  session,
  onUpdateNotes,
  onCompressMemory,
  onUpdateDim,
  onUpdateBlur,
  onUpdateWallpaper,
  onToggleDynamicEvents,
  onToggleSuspenseMode,
  onToggleToasts,
  onTogglePacing,
  messageCount,
}: Props) {
  const [notes, setNotes] = useState(session.directorNotes || "");
  const [compressing, setCompressing] = useState(false);
  const [dynamicEvents, setDynamicEvents] = useState(!!session.dynamicEvents);
  const [suspenseMode, setSuspenseMode] = useState(!!session.suspenseMode);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showToasts, setShowToasts] = useState(session.showRelationshipToasts !== false);
  const [realisticPacing, setRealisticPacing] = useState(session.realisticPacing !== false);
  const [dim, setDim] = useState(session.wallpaperDim ?? 0.55);
  const [blur, setBlur] = useState(session.wallpaperBlur ?? 0);
  const [recentWallpapers, setRecentWallpapers] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNotes(session.directorNotes || "");
  }, [session.directorNotes]);

  useEffect(() => {
    setDynamicEvents(!!session.dynamicEvents);
  }, [session.dynamicEvents]);

  useEffect(() => {
    setSuspenseMode(!!session.suspenseMode);
  }, [session.suspenseMode]);

  useEffect(() => {
    setShowToasts(session.showRelationshipToasts !== false);
  }, [session.showRelationshipToasts]);

  useEffect(() => {
    setRealisticPacing(session.realisticPacing !== false);
  }, [session.realisticPacing]);

  useEffect(() => {
    setDim(session.wallpaperDim ?? 0.55);
    setBlur(session.wallpaperBlur ?? 0);
  }, [session.wallpaperDim, session.wallpaperBlur]);

  useEffect(() => {
    if (open) {
      db.sessions
        .toArray()
        .then((all) => {
          const urls = Array.from(
            new Set(all.map((s) => s.wallpaperUrl).filter((u): u is string => !!u))
          );
          setRecentWallpapers(urls);
        })
        .catch(() => {});
    }
  }, [open]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onUpdateWallpaper(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSetUrl = () => {
    const url = prompt("Введите прямую ссылку на изображение фона:", session.wallpaperUrl || "");
    if (url !== null) {
      onUpdateWallpaper(url.trim() || undefined);
    }
  };

  // Переключение бытовых событий (выключает саспенс при активации)
  const handleToggleEvents = async () => {
    const next = !dynamicEvents;
    setDynamicEvents(next);
    if (next) {
      setSuspenseMode(false);
      if (onToggleSuspenseMode) onToggleSuspenseMode(false);
    }
    if (onToggleDynamicEvents) {
      onToggleDynamicEvents(next);
    }
    await db.sessions.update(session.id, {
      dynamicEvents: next,
      suspenseMode: next ? false : suspenseMode,
    });
  };

  // Клик по тумблеру Саспенса
  const handleSuspenseClick = async () => {
    if (suspenseMode) {
      // Моментальное выключение в 1 клик
      setSuspenseMode(false);
      if (onToggleSuspenseMode) onToggleSuspenseMode(false);
      await db.sessions.update(session.id, { suspenseMode: false });
    } else {
      // Для включения требуем подтверждения через дисклеймер
      setShowDisclaimer(true);
    }
  };

  // Подтверждение включения саспенса в модалке
  const handleConfirmSuspense = async () => {
    setShowDisclaimer(false);
    setSuspenseMode(true);
    setDynamicEvents(false); // Взаимоисключение: выключаем бытовой режим
    if (onToggleSuspenseMode) onToggleSuspenseMode(true);
    if (onToggleDynamicEvents) onToggleDynamicEvents(false);
    await db.sessions.update(session.id, {
      suspenseMode: true,
      dynamicEvents: false,
    });
  };

  const handleToggleToasts = async () => {
    const next = !showToasts;
    setShowToasts(next);
    if (onToggleToasts) {
      onToggleToasts(next);
    } else {
      await db.sessions.update(session.id, { showRelationshipToasts: next });
    }
  };

  const handleTogglePacing = async () => {
    const next = !realisticPacing;
    setRealisticPacing(next);
    if (onTogglePacing) {
      onTogglePacing(next);
    } else {
      await db.sessions.update(session.id, { realisticPacing: next });
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} variant="sheet" title="Панель режиссёра">
        <div className="space-y-4 sm:space-y-5 pb-6">
          {/* Блок 1: Заметки режиссера */}
          <div>
            <div className="mb-1 flex items-center gap-2 text-neon-amber">
              <Clapperboard size={16} />
              <label className="text-sm font-semibold">Заметки режиссёра</label>
            </div>
            <p className="mb-2 text-xs text-zinc-500">
              Подмешиваются как контекст сцены. Пример: «Мы промокли под дождём, в комнате горит камин».
            </p>
            <textarea
              className="input-field min-h-20 resize-y text-sm"
              value={notes}
              onChange={(e) => {
                const val = e.target.value;
                setNotes(val);
                onUpdateNotes(val);
              }}
              placeholder="Введите режиссёрское указание для сцены..."
            />
          </div>

          {/* Блок 2: Фон сцены (Обои и атмосфера) */}
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5 sm:p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-neon-cyan">
                <ImageIcon size={16} />
                <h3 className="text-sm font-semibold">Фон сцены (Обои чата)</h3>
              </div>
              {session.wallpaperUrl && (
                <button
                  type="button"
                  onClick={() => onUpdateWallpaper(undefined)}
                  className="flex items-center gap-1 text-[11px] font-medium text-neon-red hover:underline"
                >
                  <Trash2 size={12} /> Удалить фон
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {session.wallpaperUrl ? (
                <div className="relative h-28 w-full overflow-hidden rounded-xl border border-border bg-black">
                  <img
                    src={session.wallpaperUrl}
                    alt="Превью фона"
                    className="h-full w-full object-cover object-center"
                    style={{
                      filter: blur ? `blur(${blur}px)` : undefined,
                    }}
                  />
                  <div
                    className="absolute inset-0 bg-bg transition-opacity"
                    style={{ opacity: dim }}
                  />
                  <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-zinc-200 backdrop-blur-md">
                    Активный фон сцены
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-4 text-center text-zinc-500">
                  <ImageIcon size={28} className="mb-1 opacity-40" />
                  <p className="text-xs">Фон для этого чата не установлен</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-neon-cyan/50 hover:text-neon-cyan active:scale-95"
                >
                  <Upload size={14} /> Выбрать фото
                </button>
                <button
                  type="button"
                  onClick={handleSetUrl}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-neon-cyan/50 hover:text-neon-cyan active:scale-95"
                >
                  <ImageIcon size={14} /> По ссылке
                </button>
              </div>

              {recentWallpapers.length > 0 && (
                <div>
                  <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">
                    Недавние фоны из других чатов:
                  </span>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {recentWallpapers.map((url, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => onUpdateWallpaper(url)}
                        className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border transition-all ${
                          session.wallpaperUrl === url
                            ? "border-neon-cyan ring-2 ring-neon-cyan/30"
                            : "border-border opacity-70 hover:opacity-100"
                        }`}
                      >
                        <img src={url} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {session.wallpaperUrl && (
                <div className="space-y-3 pt-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-300 font-medium">Затемнение:</span>
                      <span className="font-bold text-neon-cyan">{Math.round(dim * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.9}
                      step={0.05}
                      value={dim}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDim(val);
                        onUpdateDim(val);
                      }}
                      className="w-full accent-neon-cyan cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-300 font-medium">Размытие (Blur):</span>
                      <span className="font-bold text-neon-cyan">{blur} px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={blur}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setBlur(val);
                        onUpdateBlur(val);
                      }}
                      className="w-full accent-neon-cyan cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Блок 3: Реалистичный темп отношений (Slow Burn) */}
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5 sm:p-4 transition-colors hover:border-white/15">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    realisticPacing
                      ? "bg-neon-cyan/20 text-neon-cyan shadow-[0_0_12px_rgba(0,240,255,0.35)]"
                      : "bg-white/5 text-zinc-500"
                  }`}
                >
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Реалистичный темп (Slow Burn)</h3>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                        realisticPacing
                          ? "bg-neon-cyan/25 text-neon-cyan"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {realisticPacing ? "ON" : "OFF"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    Персонаж держит личные границы, не ведётся на дешёвый флирт и требует завоевания доверия (+1...3%).
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={realisticPacing}
                onClick={handleTogglePacing}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  realisticPacing ? "bg-neon-cyan" : "bg-zinc-800"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-black shadow-md ring-0 transition duration-200 ease-in-out ${
                    realisticPacing ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Блок 4: Насыщенный режим (Бытовые события) */}
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5 sm:p-4 transition-colors hover:border-white/15">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    dynamicEvents
                      ? "bg-neon-purple/20 text-neon-purple shadow-[0_0_12px_rgba(155,92,255,0.35)]"
                      : "bg-white/5 text-zinc-500"
                  }`}
                >
                  <Zap size={18} className={dynamicEvents ? "fill-neon-purple/30" : ""} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Насыщенный режим</h3>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                        dynamicEvents
                          ? "bg-neon-purple/25 text-neon-purple"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {dynamicEvents ? "ON" : "OFF"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    Уютные бытовые казусы (звонки, курьеры, пролитый кофе, потерянные ключи).
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={dynamicEvents}
                onClick={handleToggleEvents}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  dynamicEvents ? "bg-neon-purple" : "bg-zinc-800"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    dynamicEvents ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Блок 5: Режим Саспенса и Триллера */}
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5 sm:p-4 transition-colors hover:border-neon-red/30">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    suspenseMode
                      ? "bg-neon-red/20 text-neon-red shadow-[0_0_12px_rgba(255,0,55,0.4)]"
                      : "bg-white/5 text-zinc-500"
                  }`}
                >
                  <Flame size={18} className={suspenseMode ? "fill-neon-red/30" : ""} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Режим Саспенса (Триллер)</h3>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                        suspenseMode
                          ? "bg-neon-red/25 text-neon-red"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {suspenseMode ? "ON" : "OFF"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    Густой психологический саспенс, мистическая тревога, помехи и аномалии.
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={suspenseMode}
                onClick={handleSuspenseClick}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  suspenseMode ? "bg-neon-red" : "bg-zinc-800"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    suspenseMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Блок 6: Уведомления отношений */}
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5 sm:p-4 transition-colors hover:border-white/15">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    showToasts
                      ? "bg-neon-pink/20 text-neon-pink shadow-[0_0_12px_rgba(255,0,128,0.35)]"
                      : "bg-white/5 text-zinc-500"
                  }`}
                >
                  <HeartHandshake size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Уведомления отношений</h3>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                        showToasts
                          ? "bg-neon-pink/25 text-neon-pink"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {showToasts ? "ON" : "OFF"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    Показывает всплывающие плашки при переходе на новый статус отношений и всплесках связи.
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={showToasts}
                onClick={handleToggleToasts}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  showToasts ? "bg-neon-pink" : "bg-zinc-800"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    showToasts ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Блок 7: Сжатая память */}
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5 sm:p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-neon-green">
                <Sparkles size={16} />
                <h3 className="text-sm font-semibold">Сжатая память</h3>
              </div>
              <span className="text-[10px] text-zinc-500">{messageCount} сообщ. в ветке</span>
            </div>
            <p className="mb-3 min-h-8 text-xs text-zinc-400">
              {session.summary || "Сводка ещё не сформирована — сообщения передаются напрямую."}
            </p>
            <button
              type="button"
              disabled={compressing}
              onClick={async () => {
                setCompressing(true);
                try {
                  await onCompressMemory();
                } finally {
                  setCompressing(false);
                }
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-neon-green/15 py-2.5 text-sm font-semibold text-neon-green transition-opacity active:scale-[0.99] disabled:opacity-50"
            >
              {compressing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {compressing ? "Сжимаю..." : "Сжать память сейчас"}
            </button>
          </div>

          {/* Блок 8: Фоновый плеер */}
          <AmbientPlayer />
        </div>
      </Modal>

      {/* Модалка-дисклеймер для подтверждения Режима Саспенса */}
      <Modal
        open={showDisclaimer}
        onClose={() => setShowDisclaimer(false)}
        title="Активация Режима Саспенса"
      >
        <div className="space-y-4 p-1">
          <div className="flex items-center gap-3 rounded-xl border border-neon-red/30 bg-neon-red/10 p-3 text-neon-red">
            <AlertTriangle size={24} className="shrink-0" />
            <p className="text-xs font-medium leading-relaxed">
              Вы включаете генератор психологического триллера и мистического саспенса.
            </p>
          </div>

          <div className="space-y-2 text-xs leading-relaxed text-zinc-300">
            <p>
              • В сюжет начнут проникать странные аномалии, помехи, гнетущая тишина и необъяснимые события.
            </p>
            <p>
              • <strong className="text-white">Безопасность:</strong> Расчленёнка, мясной трэш и мгновенная смерть строго запрещены системным фильтром.
            </p>
            <p className="text-zinc-500">
              • Обычный «Насыщенный режим» будет автоматически отключен.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowDisclaimer(false)}
              className="flex-1 rounded-xl border border-border bg-surface-3 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-surface-2"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleConfirmSuspense}
              className="flex-1 rounded-xl bg-neon-red py-2.5 text-xs font-semibold text-white shadow-lg shadow-neon-red/20 active:scale-95"
            >
              Включить саспенс
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}