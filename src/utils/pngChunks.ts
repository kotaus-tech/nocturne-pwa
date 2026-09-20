/**
 * Минимальная работа с PNG на уровне байтов: чтение и запись текстовых чанков.
 *
 * Зачем свой велосипед вместо библиотеки: нужен ровно один сценарий — достать
 * или положить JSON карточки персонажа в `tEXt`/`iTXt`-чанк. Логика чистых
 * функций над `Uint8Array` одинаково работает в браузере и в тестах (node),
 * где нет ни DOM, ни canvas.
 *
 * Формат файла: 8-байтная подпись, затем последовательность чанков
 * `[длина:4][тип:4][данные:длина][CRC32:4]`. CRC считается по типу и данным.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Типы чанков, в которых принято хранить текст (в них же лежат карточки). */
const TEXT_CHUNK_TYPES = new Set(["tEXt", "iTXt"]);

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export interface PngTextChunk {
  /** Ключевое слово чанка: у карточек это `chara` (v2) или `ccv3` (v3). */
  keyword: string;
  text: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

/** CRC32 из спецификации PNG (полином 0xEDB88320). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/**
 * Ключевые слова в PNG — это latin-1, а не UTF-8, поэтому кодируем побайтово.
 * Символы вне latin-1 (кириллица) в ключевых словах не встречаются.
 */
function encodeLatin1(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    out[index] = value.charCodeAt(index) & 0xff;
  }
  return out;
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index]);
  }
  return out;
}

/** UTF-8 без исключений: битый ввод даёт замену символов, а не падение. */
function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return decodeLatin1(bytes);
  }
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * Разбирает файл на чанки. Возвращает `null`, если это не PNG.
 *
 * Обрыв в конце файла (нет CRC или данных) — не ошибка: отдаём всё, что успели
 * прочитать. Так повреждённая карточка всё ещё может отдать полезные данные.
 */
export function readPngChunks(bytes: Uint8Array): PngChunk[] | null {
  if (!isPng(bytes)) return null;

  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = decodeLatin1(bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;

    // Длина указывает за пределы файла — дальше читать нечего.
    if (end + 4 > bytes.length) break;

    chunks.push({ type, data: bytes.subarray(start, end) });
    offset = end + 4;
  }

  return chunks;
}

/**
 * Достаёт текстовый чанк по ключевому слову.
 *
 * `tEXt`: `[ключевое слово]\0[текст]`.
 * `iTXt`: `[ключевое слово]\0[флаг сжатия][метод][язык]\0[перевод ключа]\0[текст]` —
 * сжатые варианты пропускаем, карточки пишут практически всегда без сжатия.
 */
export function readPngTextChunk(bytes: Uint8Array, keyword: string): string | null {
  const chunk = readPngTextChunks(bytes).find((item) => item.keyword === keyword);
  return chunk ? chunk.text : null;
}

export function readPngTextChunks(bytes: Uint8Array): PngTextChunk[] {
  const chunks = readPngChunks(bytes);
  if (!chunks) return [];

  const result: PngTextChunk[] = [];

  for (const chunk of chunks) {
    if (!TEXT_CHUNK_TYPES.has(chunk.type)) continue;

    const zero = chunk.data.indexOf(0);
    if (zero <= 0) continue;

    const keyword = decodeLatin1(chunk.data.subarray(0, zero));
    const rest = chunk.data.subarray(zero + 1);

    if (chunk.type === "iTXt") {
      // Флаг сжатия, метод, язык, перевод ключевого слова — затем сам текст.
      if (rest.length < 2) continue;
      if (rest[0] !== 0) continue; // сжатый текст: распаковывать здесь нечем

      let offset = 2;
      let separators = 0;

      while (offset < rest.length && separators < 2) {
        if (rest[offset] === 0) separators += 1;
        offset += 1;
      }

      result.push({ keyword, text: decodeUtf8(rest.subarray(offset)) });
      continue;
    }

    result.push({ keyword, text: decodeUtf8(rest) });
  }

  return result;
}

function encodeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = encodeLatin1(type);
  const out = new Uint8Array(12 + data.length);

  writeUint32(out, 0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);

  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeUint32(out, 8 + data.length, crc32(crcInput));

  return out;
}

function encodeTextChunk(keyword: string, text: string): Uint8Array {
  const keywordBytes = encodeLatin1(keyword);
  const textBytes = encodeUtf8(text);
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);

  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(textBytes, keywordBytes.length + 1);

  return encodeChunk("tEXt", data);
}

function chunkKeyword(data: Uint8Array): string {
  const zero = data.indexOf(0);
  return zero <= 0 ? "" : decodeLatin1(data.subarray(0, zero));
}

/**
 * Вставляет текстовый чанк **перед** `IEND` — последним, но внутри файла:
 * всё, что записано после `IEND`, читатели игнорируют.
 *
 * Если чанк с таким ключевым словом уже был, он заменяется: повторный экспорт
 * не должен копить дубли внутри файла. Не PNG или не нашли `IEND` — возвращаем
 * исходные байты, чтобы не испортить файл.
 */
export function replacePngTextChunk(
  bytes: Uint8Array,
  keyword: string,
  text: string
): Uint8Array {
  if (!isPng(bytes)) return bytes;

  const chunks = readPngChunks(bytes);
  if (!chunks || chunks.length === 0) return bytes;

  const iendIndex = chunks.findIndex((chunk) => chunk.type === "IEND");
  if (iendIndex === -1) return bytes;

  // Склеиваем из срезов исходного файла: перекодировать существующие чанки
  // не нужно, они и так остаются байт в байт.
  const parts: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE.length)];
  let offset = PNG_SIGNATURE.length;

  chunks.forEach((chunk, index) => {
    const size = 12 + chunk.data.length;
    const slice = bytes.subarray(offset, offset + size);
    offset += size;

    // Прежний чанк с этим ключевым словом выбрасываем — вместо него будет новый.
    if (chunk.type === "tEXt" && chunkKeyword(chunk.data) === keyword) return;

    if (index === iendIndex) parts.push(encodeTextChunk(keyword, text));
    parts.push(slice);
  });

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);

  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }

  return out;
}
