import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, RefreshCw, Sparkles, X } from "lucide-react";
import {
  applyPwaUpdate,
  dismissPwaInstall,
  promptPwaInstall,
  pwaStore,
} from "../../services/pwa";

/**
 * Ненавязчивые баннеры PWA: «доступно обновление» и «установить приложение».
 * Располагаются поверх интерфейса, но ниже модальных окон (z-50).
 */
export function PwaBanners() {
  const state = useSyncExternalStore(
    pwaStore.subscribe,
    pwaStore.getSnapshot,
    pwaStore.getSnapshot
  );

  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const showUpdate = state.updateReady && !updateDismissed;
  const showInstall =
    state.canInstall && !state.installDismissed && !state.standalone;

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);

    try {
      const outcome = await promptPwaInstall();
      if (outcome === "dismissed") dismissPwaInstall();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[45] flex flex-col items-center gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))]">
      <AnimatePresence initial={false}>
        {showUpdate && (
          <motion.div
            key="update"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            role="status"
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-accent/30 bg-[#121622]/95 p-3 shadow-2xl backdrop-blur-2xl"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
            >
              <Sparkles size={17} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-100">
                Доступна новая версия
              </p>
              <p className="mt-0.5 text-[11px] text-content-muted">
                Обновление применится после перезапуска
              </p>
            </div>

            <button
              type="button"
              onClick={() => applyPwaUpdate()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover"
            >
              <RefreshCw size={13} />
              <span>Обновить</span>
            </button>

            <button
              type="button"
              onClick={() => setUpdateDismissed(true)}
              aria-label="Скрыть уведомление об обновлении"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content"
            >
              <X size={15} />
            </button>
          </motion.div>
        )}

        {showInstall && (
          <motion.div
            key="install"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            role="status"
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/[0.09] bg-[#121622]/95 p-3 shadow-2xl backdrop-blur-2xl"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-content-secondary"
            >
              <Download size={17} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-100">
                Установить NOCTURNE
              </p>
              <p className="mt-0.5 text-[11px] text-content-muted">
                Отдельное окно и работа без интернета
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleInstall()}
              disabled={installing}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
            >
              <Download size={13} />
              <span>Установить</span>
            </button>

            <button
              type="button"
              onClick={() => dismissPwaInstall()}
              aria-label="Отложить установку"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content"
            >
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
