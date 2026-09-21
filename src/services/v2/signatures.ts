// =============================================================
// CHARACTER DNA (V2) — ПАМЯТЬ РАЗНООБРАЗИЯ
//
// Локально храним краткие «подписи» последних персонажей и просим
// модель не повторять похожие сочетания. Хранилище — localStorage с
// защитой от недоступности (приватный режим, тесты без DOM).
// =============================================================

import type { CharacterBlueprintV2, V2Signature } from "./v2types";

const STORAGE_KEY = "nocturne_v2_signatures";
const MAX_SIGNATURES = 8;

function readRaw(): V2Signature[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is V2Signature =>
          Boolean(item) && typeof item === "object" && typeof item.ts === "number"
      )
      .slice(-MAX_SIGNATURES);
  } catch {
    return [];
  }
}

function writeRaw(signatures: V2Signature[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signatures.slice(-MAX_SIGNATURES)));
  } catch {
    /* приватный режим / переполнение — не критично */
  }
}

/** Краткая подпись готового персонажа для сравнения «похож / не похож». */
export function makeSignature(blueprint: CharacterBlueprintV2): V2Signature {
  const { identity, life, relationship, psychology, speech } = blueprint;

  const ageBand =
    identity.age <= 21
      ? "18-21"
      : identity.age <= 26
      ? "22-26"
      : identity.age <= 32
      ? "27-32"
      : identity.age <= 40
      ? "33-40"
      : identity.age <= 55
      ? "41-55"
      : "56+";

  return {
    g: identity.gender,
    a: ageBand,
    o: life.occupationField || identity.occupationTitle,
    d: relationship.dynamic,
    t: psychology.traits[0] ?? "",
    s: `${speech.formality}/${speech.humor}`,
    ts: Date.now(),
  };
}

/** Последние подписи для передачи в промпт (самые свежие — последними). */
export function getRecentSignatures(): V2Signature[] {
  return readRaw();
}

/** Добавляет подпись нового персонажа (после успешной генерации). */
export function rememberSignature(signature: V2Signature): void {
  const existing = readRaw();
  writeRaw([...existing, signature]);
}

/** Очищает память разнообразия (например, из настроек). */
export function clearSignatures(): void {
  writeRaw([]);
}
