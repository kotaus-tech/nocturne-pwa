import type { GroupBlueprint } from "./types";

export interface GroupSignature {
  setting: string;
  tone: string;
  roles: string[];
  relationPattern: string;
  /** Group DNA V2: короткая память социальной рамки без приватных подробностей. */
  playerAnchor?: string;
  informationPattern?: string;
  createdAt: number;
}

const STORAGE_KEY = "nocturne_group_generator_signatures";
const MAX_SIGNATURES = 12;

function read(): GroupSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        setting: typeof item.setting === "string" ? item.setting.slice(0, 120) : "",
        tone: typeof item.tone === "string" ? item.tone.slice(0, 90) : "",
        roles: Array.isArray(item.roles)
          ? item.roles.filter((role): role is string => typeof role === "string").slice(0, 4)
          : [],
        relationPattern: typeof item.relationPattern === "string" ? item.relationPattern.slice(0, 160) : "",
        playerAnchor: typeof item.playerAnchor === "string" ? item.playerAnchor.slice(0, 120) : undefined,
        informationPattern: typeof item.informationPattern === "string" ? item.informationPattern.slice(0, 160) : undefined,
        createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
          ? item.createdAt
          : 0,
      }))
      .filter((item) => item.setting || item.tone || item.roles.length > 0);
  } catch {
    return [];
  }
}

export function getRecentGroupSignatures(): GroupSignature[] {
  return read().slice(-MAX_SIGNATURES);
}

export function makeGroupSignature(blueprint: GroupBlueprint): GroupSignature {
  return {
    setting: blueprint.scene.setting.slice(0, 100),
    tone: blueprint.scene.tone.slice(0, 80),
    roles: blueprint.cast.map((item) => item.role).slice(0, 4),
    relationPattern: blueprint.relations.map((item) => item.label).join(", ").slice(0, 140),
    playerAnchor: blueprint.scene.playerAnchor?.mode?.slice(0, 120),
    informationPattern: blueprint.informationLayers?.map((item) => item.type).join(", ").slice(0, 160),
    createdAt: Date.now(),
  };
}

export function rememberGroupSignature(signature: GroupSignature): void {
  try {
    const next = [...read(), signature].slice(-MAX_SIGNATURES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage может быть отключён в приватном режиме — генерация не должна падать.
  }
}
