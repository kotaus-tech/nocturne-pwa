/**
 * Работа с постоянным хранилищем браузера.
 *
 * IndexedDB может быть вычищена браузером (в Safari на iOS — примерно после
 * недели без визитов), если хранилище не помечено как persistent.
 * Для приложения, где вся библиотека историй лежит локально, это критично.
 */

export interface StorageStatus {
  /** Браузер поддерживает Storage API. */
  supported: boolean;
  /** Хранилище помечено как постоянное и не будет вычищено автоматически. */
  persisted: boolean;
  /** Занято приложением, байт. */
  usage: number;
  /** Доступная квота, байт. */
  quota: number;
  /** Занято относительно квоты, 0–1. */
  usageRatio: number;
}

const EMPTY_STATUS: StorageStatus = {
  supported: false,
  persisted: false,
  usage: 0,
  quota: 0,
  usageRatio: 0,
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";

  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / 1024 ** exponent;
  const precision = value >= 100 || exponent === 0 ? 0 : 1;

  return `${value.toFixed(precision)} ${units[exponent]}`;
}

function storageManager(): StorageManager | null {
  if (typeof navigator === "undefined") return null;
  return navigator.storage ?? null;
}

export async function isStoragePersisted(): Promise<boolean> {
  const manager = storageManager();
  if (!manager?.persisted) return false;

  try {
    return await manager.persisted();
  } catch {
    return false;
  }
}

/**
 * Просит браузер защитить данные от автоматической очистки.
 * Возвращает итоговое состояние флага persisted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const manager = storageManager();
  if (!manager?.persist) return false;

  try {
    if (manager.persisted && (await manager.persisted())) return true;
    return await manager.persist();
  } catch {
    return false;
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const manager = storageManager();
  if (!manager) return EMPTY_STATUS;

  const persisted = await isStoragePersisted();
  let usage = 0;
  let quota = 0;

  if (manager.estimate) {
    try {
      const estimate = await manager.estimate();
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
    } catch {
      /* оценка недоступна — не критично */
    }
  }

  return {
    supported: true,
    persisted,
    usage,
    quota,
    usageRatio: quota > 0 ? Math.min(1, usage / quota) : 0,
  };
}
