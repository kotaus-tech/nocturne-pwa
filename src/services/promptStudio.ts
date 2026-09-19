/**
 * Промпт-студия: сборка качественных английских промптов для моделей генерации
 * изображений. Вся логика чистая — работает без обращения к API, поэтому
 * промпт можно собрать мгновенно и офлайн.
 */

export type FrameId = "portrait" | "halfBody" | "fullBody" | "scene";
export type StyleId =
  | "photo"
  | "film"
  | "anime"
  | "manhwa"
  | "oil"
  | "watercolor"
  | "noir"
  | "comic";
export type LightingId =
  | "goldenHour"
  | "daylight"
  | "windowLight"
  | "nightNeon"
  | "candle"
  | "overcast";
export type MoodId =
  | "tender"
  | "warm"
  | "playful"
  | "tense"
  | "melancholic"
  | "mysterious"
  | "passionate";
export type CameraId = "portrait85" | "candid35" | "wide24" | "macro" | "telephoto135" | "drone";
export type DetailId = "concise" | "balanced" | "rich";
export type AspectId = "1:1" | "3:4" | "2:3" | "16:9" | "9:16";

export interface PromptStudioSettings {
  frame: FrameId;
  style: StyleId;
  lighting: LightingId;
  mood: MoodId;
  camera: CameraId;
  detail: DetailId;
  aspect: AspectId;
  /** Дополнительные детали сцены (погода, антураж). */
  extras: string[];
  /** Добавлять строку NEGATIVE: ... */
  includeNegative: boolean;
}

export interface PromptOption<T extends string> {
  id: T;
  label: string;
  /** Готовая английская формулировка. */
  spec: string;
}

export const FRAMES: PromptOption<FrameId>[] = [
  { id: "portrait", label: "Портрет", spec: "close-up portrait" },
  { id: "halfBody", label: "По пояс", spec: "waist-up shot" },
  { id: "fullBody", label: "В полный рост", spec: "full body shot" },
  { id: "scene", label: "Сцена", spec: "cinematic scene" },
];

export const STYLES: PromptOption<StyleId>[] = [
  {
    id: "photo",
    label: "Фото",
    spec:
      "photorealistic photography, true-to-life skin texture with visible pores, natural proportions, shot on full-frame camera, no plastic retouching",
  },
  {
    id: "film",
    label: "Кинокадр",
    spec:
      "cinematic film still, anamorphic lens, shallow depth of field, subtle film grain, teal and amber color grade, dramatic composition",
  },
  {
    id: "anime",
    label: "Аниме",
    spec:
      "modern high-end anime key visual, Kyoto Animation level of detail, expressive eyes, clean line art, vibrant atmospheric color",
  },
  {
    id: "manhwa",
    label: "Манхва",
    spec:
      "korean manhwa illustration, webtoon cover quality, crisp linework, soft cel shading, glossy rendering, captivating gaze",
  },
  {
    id: "oil",
    label: "Живопись",
    spec:
      "classical oil painting, visible brush strokes, rich impasto texture, museum quality, subtle chiaroscuro",
  },
  {
    id: "watercolor",
    label: "Акварель",
    spec:
      "delicate watercolor illustration, soft pigment bleeding, textured paper grain, airy negative space",
  },
  {
    id: "noir",
    label: "Нуар",
    spec:
      "high-contrast black and white noir photography, hard directional light, deep shadows, moody 1950s atmosphere",
  },
  {
    id: "comic",
    label: "Комикс",
    spec:
      "bold comic book illustration, confident inking, halftone shading, dynamic panel composition",
  },
];

export const LIGHTINGS: PromptOption<LightingId>[] = [
  {
    id: "goldenHour",
    label: "Золотой час",
    spec: "warm golden hour sunlight, long soft shadows, gentle rim light on hair",
  },
  {
    id: "daylight",
    label: "Дневной свет",
    spec: "clean natural daylight, soft diffused illumination, true color balance",
  },
  {
    id: "windowLight",
    label: "Свет из окна",
    spec: "soft directional window light, gentle falloff, subtle dust in the air",
  },
  {
    id: "nightNeon",
    label: "Неон ночью",
    spec: "moody night ambience, neon reflections on skin and wet asphalt, bokeh city lights",
  },
  {
    id: "candle",
    label: "Свечи",
    spec: "warm candlelight, flickering amber glow, deep surrounding shadows",
  },
  {
    id: "overcast",
    label: "Пасмурно",
    spec: "overcast diffused light, muted soft contrast, calm melancholic atmosphere",
  },
];

export const MOODS: PromptOption<MoodId>[] = [
  { id: "tender", label: "Нежность", spec: "tender intimate atmosphere, soft trusting expression" },
  { id: "warm", label: "Тепло", spec: "warm welcoming mood, relaxed open body language" },
  { id: "playful", label: "Игривость", spec: "playful mood, mischievous half-smile, lively energy" },
  { id: "tense", label: "Напряжение", spec: "charged tense atmosphere, guarded posture, unspoken conflict" },
  { id: "melancholic", label: "Меланхолия", spec: "quiet melancholic mood, distant thoughtful gaze" },
  { id: "mysterious", label: "Тайна", spec: "mysterious enigmatic mood, half-hidden expression" },
  { id: "passionate", label: "Страсть", spec: "intense passionate mood, flushed cheeks, magnetic eye contact" },
];

export const CAMERAS: PromptOption<CameraId>[] = [
  { id: "portrait85", label: "85mm портрет", spec: "85mm lens, f/1.8, creamy background separation" },
  { id: "candid35", label: "35mm кадр", spec: "35mm lens, f/2.0, candid documentary framing" },
  { id: "wide24", label: "24mm широкий", spec: "24mm wide angle, environmental context visible" },
  { id: "telephoto135", label: "135mm теле", spec: "135mm telephoto, compressed perspective, subject isolation" },
  { id: "macro", label: "Макро", spec: "macro lens, extreme close detail, razor-thin focus plane" },
  { id: "drone", label: "Верхний план", spec: "elevated bird's-eye angle, wide environmental composition" },
];

export const DETAILS: PromptOption<DetailId>[] = [
  { id: "concise", label: "Лаконично", spec: "high quality, sharp focus" },
  {
    id: "balanced",
    label: "Сбалансированно",
    spec: "highly detailed, sharp focus, professional composition, natural color grading",
  },
  {
    id: "rich",
    label: "Максимум деталей",
    spec:
      "masterpiece quality, ultra detailed, intricate textures, subtle imperfections, professional color grading, perfectly balanced composition, high dynamic range",
  },
];

export const ASPECTS: PromptOption<AspectId>[] = [
  { id: "1:1", label: "1:1 квадрат", spec: "square composition, aspect ratio 1:1" },
  { id: "3:4", label: "3:4 вертикаль", spec: "vertical portrait framing, aspect ratio 3:4" },
  { id: "2:3", label: "2:3 постер", spec: "tall poster framing, aspect ratio 2:3" },
  { id: "16:9", label: "16:9 кадр", spec: "widescreen cinematic framing, aspect ratio 16:9" },
  { id: "9:16", label: "9:16 истории", spec: "vertical story framing, aspect ratio 9:16" },
];

export interface ExtraOption {
  id: string;
  label: string;
  spec: string;
}

export const EXTRAS: ExtraOption[] = [
  { id: "rain", label: "Дождь", spec: "light rain, glistening droplets" },
  { id: "snow", label: "Снег", spec: "falling snowflakes, cold breath visible" },
  { id: "wind", label: "Ветер", spec: "wind moving hair and fabric" },
  { id: "fog", label: "Туман", spec: "atmospheric haze, soft fog layers" },
  { id: "bokeh", label: "Боке", spec: "creamy bokeh highlights in the background" },
  { id: "grain", label: "Зерно плёнки", spec: "subtle analog film grain" },
  { id: "flame", label: "Огонь", spec: "warm firelight and floating sparks" },
  { id: "petals", label: "Лепестки", spec: "cherry blossom petals drifting in the air" },
  { id: "autumn", label: "Осень", spec: "autumn leaves, amber seasonal palette" },
  { id: "neon", label: "Неон", spec: "colourful neon signage glow nearby" },
  { id: "stars", label: "Звёзды", spec: "star-filled night sky overhead" },
  { id: "crowd", label: "Толпа", spec: "blurred distant crowd, sense of scale" },
  { id: "cafe", label: "Кафе", spec: "cozy cafe interior, warm wood and soft lamps" },
  { id: "library", label: "Библиотека", spec: "tall bookshelves, quiet scholarly atmosphere" },
  { id: "car", label: "Авто", spec: "sleek car nearby, reflective paintwork" },
  { id: "water", label: "Вода", spec: "shallow water reflections, wet surfaces" },
];

export const NEGATIVE_PROMPT =
  "lowres, blurry, out of focus, deformed hands, extra fingers, extra limbs, bad anatomy, mutated proportions, disfigured face, asymmetric eyes, plastic skin, over-smoothed, watermark, signature, text, logo, jpeg artifacts, cropped head, duplicate subject, cluttered background";

export const DEFAULT_STUDIO_SETTINGS: PromptStudioSettings = {
  frame: "portrait",
  style: "photo",
  lighting: "goldenHour",
  mood: "warm",
  camera: "portrait85",
  detail: "balanced",
  aspect: "3:4",
  extras: [],
  includeNegative: true,
};

export interface ComposeInput {
  characterName: string;
  /** Внешность и характер персонажа — якорь, чтобы модель не теряла облик. */
  appearance?: string;
  /** Контекст сцены: последнее сообщение, зарисовка или описание. */
  scene?: string;
  /** Свои детали, которые не попали в настройки. */
  notes?: string;
  settings: PromptStudioSettings;
}

const MAX_APPEARANCE = 260;
const MAX_SCENE = 700;

/** Убирает ролевую разметку и лишние пробелы — промпт должен быть чистым текстом. */
export function cleanPromptText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\*+/g, " ")
    .replace(/[_~`>#]+/g, " ")
    .replace(/^["'«»\u201c\u201d\s-]+/gm, " ")
    .replace(/["'«»\u201c\u201d]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cut(source: string, limit: number): string {
  if (source.length <= limit) return source;
  const sliced = source.slice(0, limit);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

export function hasLetters(source: string): boolean {
  return /[a-zA-Zа-яА-Я]/.test(source);
}

function specOf<T extends string>(
  options: PromptOption<T>[],
  id: T,
  fallback = ""
): string {
  return options.find((option) => option.id === id)?.spec ?? fallback;
}

/**
 * Собирает итоговый промпт. Порядок блоков повторяет то, как модели читают
 * подсказки: субъект → внешность → сцена → стиль → оптика → свет → настроение →
 * детали → качество.
 */
export function composeImagePrompt(input: ComposeInput): string {
  const { settings } = input;
  const name = input.characterName.trim() || "the character";

  const blocks: string[] = [];
  const frame = specOf(FRAMES, settings.frame, "portrait");

  blocks.push(settings.frame === "scene" ? `${frame} featuring ${name}` : `${frame} of ${name}`);

  const appearance = cleanPromptText(input.appearance ?? "");
  if (hasLetters(appearance)) blocks.push(cut(appearance, MAX_APPEARANCE));

  const scene = cleanPromptText(input.scene ?? "");
  if (hasLetters(scene)) blocks.push(`scene: ${cut(scene, MAX_SCENE)}`);

  blocks.push(specOf(STYLES, settings.style));
  blocks.push(specOf(CAMERAS, settings.camera));
  blocks.push(specOf(LIGHTINGS, settings.lighting));
  blocks.push(specOf(MOODS, settings.mood));

  const extras = settings.extras
    .map((id) => EXTRAS.find((option) => option.id === id)?.spec)
    .filter((spec): spec is string => Boolean(spec));
  if (extras.length) blocks.push(extras.join(", "));

  const notes = cleanPromptText(input.notes ?? "");
  if (hasLetters(notes)) blocks.push(cut(notes, 300));

  blocks.push(specOf(DETAILS, settings.detail));
  blocks.push(specOf(ASPECTS, settings.aspect));

  const prompt = blocks
    .map((block) => block.trim().replace(/\s{2,}/g, " "))
    .filter(Boolean)
    .join(", ")
    .replace(/,\s*,/g, ", ")
    .replace(/^,\s*|,\s*$/g, "")
    .trim();

  return settings.includeNegative ? `${prompt}\n\nNEGATIVE: ${NEGATIVE_PROMPT}` : prompt;
}

/** Отдельная строка негативного промпта — для полей, где он задаётся отдельно. */
export function composeNegativePrompt(settings: PromptStudioSettings): string {
  return settings.includeNegative ? NEGATIVE_PROMPT : "";
}

/**
 * Короткая версия промпта для моделей с лимитом символов: ядро сцены без
 * служебных усилителей качества.
 */
export function composeShortPrompt(input: ComposeInput): string {
  const { settings } = input;
  const name = input.characterName.trim() || "the character";
  const frame = settings.frame === "scene"
    ? `${specOf(FRAMES, settings.frame)} featuring ${name}`
    : `${specOf(FRAMES, settings.frame, "portrait")} of ${name}`;

  const parts = [
    frame,
    specOf(STYLES, settings.style).split(",")[0],
    specOf(LIGHTINGS, settings.lighting).split(",")[0],
    specOf(MOODS, settings.mood).split(",")[0],
  ];

  const scene = cleanPromptText(input.scene ?? "");
  if (hasLetters(scene)) parts.push(cut(scene, 220));

  return parts.filter(Boolean).join(", ");
}

/** Готовая строка для передачи в модель-редактор («улучшить промпт»). */
export function buildRefineRequest(input: ComposeInput): string {
  const appearance = cleanPromptText(input.appearance ?? "");
  const scene = cleanPromptText(input.scene ?? "");
  const chosen = [
    `frame: ${FRAMES.find((f) => f.id === input.settings.frame)?.label}`,
    `style: ${STYLES.find((s) => s.id === input.settings.style)?.label}`,
    `lighting: ${LIGHTINGS.find((l) => l.id === input.settings.lighting)?.label}`,
    `mood: ${MOODS.find((m) => m.id === input.settings.mood)?.label}`,
    `camera: ${CAMERAS.find((c) => c.id === input.settings.camera)?.label}`,
    `detail: ${DETAILS.find((d) => d.id === input.settings.detail)?.label}`,
    `aspect: ${input.settings.aspect}`,
    input.settings.extras.length
      ? `extras: ${input.settings.extras
          .map((id) => EXTRAS.find((e) => e.id === id)?.label ?? id)
          .join(", ")}`
      : "",
  ].filter(Boolean);

  return [
    `Character: ${input.characterName}`,
    appearance ? `Appearance: ${appearance}` : "",
    scene ? `Scene context: ${scene}` : "",
    `Chosen settings — ${chosen.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
