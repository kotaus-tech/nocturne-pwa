/**
 * Мост между UI и Service Worker: регистрация, обновления и установка PWA.
 *
 * Состояние хранится в одном снапшоте и раздаётся через useSyncExternalStore —
 * тот же паттерн, что и в ambientEngine, чтобы UI не дублировал логику.
 */

export interface PwaState {
  /** Готова новая версия и ждёт активации. */
  updateReady: boolean;
  /** Приложение уже установлено (запущено в standalone). */
  standalone: boolean;
  /** Браузер предложил установку (Chromium). */
  canInstall: boolean;
  /** Пользователь отложил предложение установки. */
  installDismissed: boolean;
  /** Приложение уже готово к офлайн-работе (оболочка в кэше). */
  offlineReady: boolean;
}

const INSTALL_DISMISS_KEY = "nocturne_install_dismissed";

let snapshot: PwaState = {
  updateReady: false,
  standalone: false,
  canInstall: false,
  installDismissed: false,
  offlineReady: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function update(patch: Partial<PwaState>) {
  snapshot = { ...snapshot, ...patch };
  emit();
}

export const pwaStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): PwaState {
    return snapshot;
  },
};

let registration: ServiceWorkerRegistration | null = null;
let reloading = false;
/** Пользователь сам нажал «Обновить» — тогда перезагружаемся. */
let userRequestedUpdate = false;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;

  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigatorWithStandalone.standalone === true
  );
}

function readInstallDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Регистрирует Service Worker и подписывается на события обновления.
 * Возвращает функцию очистки слушателей.
 */
export function initPwa(): () => void {
  if (typeof window === "undefined") return () => {};

  update({
    standalone: isStandalone(),
    installDismissed: readInstallDismissed(),
  });

  const onBeforeInstallPrompt = (event: Event) => {
    // Не даём браузеру показать свой мини-баннер: покажем свой, в стиле приложения.
    event.preventDefault();
    (window as unknown as { __nocturneInstallPrompt?: Event }).__nocturneInstallPrompt =
      event;
    update({ canInstall: true });
  };

  const onAppInstalled = () => {
    (window as unknown as { __nocturneInstallPrompt?: Event }).__nocturneInstallPrompt =
      undefined;
    update({ canInstall: false, standalone: true });
  };

  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);

  if (!("serviceWorker" in navigator)) {
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }

  // В dev-режиме SW только мешает HMR: регистрируем исключительно в сборке.
  if (!import.meta.env.PROD) {
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }

  const markUpdateReady = () => {
    update({ updateReady: true });
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !userRequestedUpdate) return;
    reloading = true;
    window.location.reload();
  });

  const watchInstalling = (worker: ServiceWorker | null) => {
    if (!worker) return;

    const onStateChange = () => {
      if (
        worker.state === "installed" &&
        navigator.serviceWorker.controller &&
        !snapshot.updateReady
      ) {
        markUpdateReady();
      }
    };

    worker.addEventListener("statechange", onStateChange);
  };

  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((reg) => {
      registration = reg;

      // Уже есть ожидающая версия (например, после перезапуска вкладки).
      if (reg.waiting && navigator.serviceWorker.controller) {
        markUpdateReady();
      }

      if (reg.active && !navigator.serviceWorker.controller) {
        update({ offlineReady: true });
      }

      watchInstalling(reg.installing);

      reg.addEventListener("updatefound", () => {
        watchInstalling(reg.installing);
      });
    })
    .catch((error) => {
      console.warn("[PWA] Не удалось зарегистрировать Service Worker:", error);
    });

  // Проверяем обновления при возврате к приложению — но не чаще раза в 30 минут.
  let lastCheck = 0;

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    if (!registration) return;

    const now = Date.now();
    if (now - lastCheck < 30 * 60 * 1000) return;
    lastCheck = now;

    registration.update().catch(() => {});
  };

  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/** Применяет ожидающее обновление и перезагружает приложение. */
export function applyPwaUpdate(): void {
  userRequestedUpdate = true;

  const waiting = registration?.waiting;

  if (!waiting) {
    window.location.reload();
    return;
  }

  waiting.postMessage({ type: "SKIP_WAITING" });
}

/** Показывает системный диалог установки (Chromium). */
export async function promptPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const promptEvent = (window as unknown as { __nocturneInstallPrompt?: {
    prompt: () => Promise<void>;
    userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
  } }).__nocturneInstallPrompt;

  if (!promptEvent) return "unavailable";

  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    (window as unknown as { __nocturneInstallPrompt?: Event }).__nocturneInstallPrompt =
      undefined;
    update({ canInstall: false });
    return choice?.outcome ?? "dismissed";
  } catch {
    return "unavailable";
  }
}

/** Прячет предложение установки до следующего запуска. */
export function dismissPwaInstall(): void {
  update({ installDismissed: true });
  try {
    window.localStorage.setItem(INSTALL_DISMISS_KEY, "1");
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}
