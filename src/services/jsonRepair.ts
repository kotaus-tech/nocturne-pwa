/**
 * Разбор JSON из ответов моделей.
 *
 * Отдельный модуль, потому что этим пользуются и генератор персонажей, и
 * движок памяти: обе ветки терпят markdown-обёртки, пояснения вокруг ответа
 * и обрыв на середине.
 */

/**
 * Вырезает из текста первый JSON-объект или массив и запоминает, чем его
 * закрывать, если модель оборвала ответ на середине.
 *
 * Скобки считаем с учётом строк: так JSON внутри пояснений и markdown не
 * ломает разбор, а вложенные массивы закрываются в правильном порядке
 * (плоский подсчёт скобок путал вложенность и подставлял `]` раньше `}`).
 */
export function extractJsonBlock(text: string): { block: string; closers: string } | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }

    if (char === "}" || char === "]") {
      stack.pop();
      if (stack.length === 0) {
        return { block: text.slice(start, index + 1), closers: "" };
      }
    }
  }

  const closers = `${inString ? '"' : ""}${stack.reverse().join("")}`;
  return { block: text.slice(start), closers };
}
