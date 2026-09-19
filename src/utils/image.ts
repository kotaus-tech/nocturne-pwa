/**
 * Подготовка пользовательских изображений к хранению в IndexedDB.
 *
 * Оригинал с телефона — это 4–10 МБ base64 внутри записи Dexie, что быстро
 * съедает квоту и тормозит live-запросы. Поэтому читаем файл через canvas
 * и отдаём уменьшенную копию в JPEG.
 */

export interface PrepareImageOptions {
  /** Максимальная ширина результата, px. */
  maxWidth: number;
  /** Максимальная высота результата, px. */
  maxHeight: number;
  /** Качество JPEG, 0–1. */
  quality?: number;
  /** Предел размера исходного файла, байт. */
  maxSourceBytes?: number;
}

export const WALLPAPER_OPTIONS: PrepareImageOptions = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.82,
  maxSourceBytes: 12 * 1024 * 1024,
};

export const AVATAR_OPTIONS: PrepareImageOptions = {
  maxWidth: 512,
  maxHeight: 512,
  quality: 0.85,
  maxSourceBytes: 12 * 1024 * 1024,
};

export const MAX_SOURCE_MB = 12;

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} МБ`;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Не удалось прочитать изображение. Попробуйте другой файл."));
    };

    image.src = objectUrl;
  });
}

/**
 * Читает файл изображения, уменьшает его до заданных границ и возвращает data-URL.
 * Бросает Error с готовым для показа текстом.
 */
export async function prepareImageFile(
  file: File,
  options: PrepareImageOptions
): Promise<string> {
  const maxSourceBytes = options.maxSourceBytes ?? MAX_SOURCE_MB * 1024 * 1024;

  if (!file.type.startsWith("image/")) {
    throw new Error("Это не изображение. Выберите файл PNG, JPEG или WebP.");
  }

  if (file.size > maxSourceBytes) {
    throw new Error(
      `Файл слишком большой (${formatMb(file.size)}). Максимум — ${formatMb(maxSourceBytes)}.`
    );
  }

  const image = await loadImageFromFile(file);
  const { maxWidth, maxHeight, quality = 0.82 } = options;

  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Браузер не поддерживает обработку изображений.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);

  // canvas может вернуть "data:," при слишком больших размерах.
  if (!dataUrl || dataUrl.length < 32) {
    throw new Error("Не удалось подготовить изображение. Попробуйте файл меньшего размера.");
  }

  return dataUrl;
}
