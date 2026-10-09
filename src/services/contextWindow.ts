import type { Message } from "../types";

/**
 * Окно истории, которое уходит в запрос.
 *
 * В ступенчатом режиме начало окна смещается шагом 10 сообщений, поэтому
 * между соседними ходами начало истории совпадает и может попасть в кэш
 * провайдера. Скользящий режим отрезает по одному сообщению за ход.
 */
export function getSliceForContext(
  allContextMessages: Message[],
  windowSize: number,
  steppedEnabled: boolean
): Message[] {
  if (!steppedEnabled || allContextMessages.length <= windowSize) {
    return allContextMessages.slice(-windowSize);
  }

  const step = 10;
  const overflow = allContextMessages.length - windowSize;
  const steppedStart = Math.floor(overflow / step) * step;
  return allContextMessages.slice(steppedStart);
}
