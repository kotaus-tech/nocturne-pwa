/**
 * Генератор иллюстраций момента через бесплатный REST-эндпоинт Pollinations.ai
 * https://image.pollinations.ai/prompt/{encoded_prompt}
 */

/** Достаёт последнее действие из *звёздочек* в тексте сообщения */
export function extractLastAction(text: string): string {
  const matches = [...text.matchAll(/\*([^*]+)\*/g)];
  if (matches.length > 0) {
    return matches[matches.length - 1][1].trim();
  }
  // fallback — берём последнее предложение как есть
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  return sentences[sentences.length - 1] ?? text;
}

/** Строит URL картинки Pollinations из русской сцены (сервис сам понимает разные языки, но добавим художественный стиль) */
export function buildPollinationsUrl(sceneText: string, seed?: number): string {
  const cleaned = sceneText.replace(/[_#]/g, " ").trim();
  const styled = `${cleaned}, cinematic lighting, detailed illustration, visual novel art style, high quality`;
  const encoded = encodeURIComponent(styled);
  const seedParam = seed ?? Math.floor(Math.random() * 1_000_000);
  return `https://image.pollinations.ai/prompt/${encoded}?width=768&height=512&seed=${seedParam}&nologo=true`;
}

export function generateSceneImageUrl(messageText: string): string {
  const action = extractLastAction(messageText);
  return buildPollinationsUrl(action);
}
