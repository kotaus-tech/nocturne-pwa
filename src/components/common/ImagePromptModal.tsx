import { useState, useEffect, useId, useRef } from "react";
import {
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Camera,
  Image as ImageIcon,
  Smartphone,
  Flower2,
  Sparkles,
  Moon,
  AlertCircle,
} from "lucide-react";
import { Modal } from "./Modal";
import { getApiConfig } from "../../db";
import { requestImagePrompt } from "../../services/apiClient";
import type { Character } from "../../types";
import { cn } from "../../utils/cn";
import { copyTextToClipboard } from "../../utils/clipboard";

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
}

/*
 * label и promptSpec — часть существующего запроса.
 * Не изменяем их ради оформления.
 */
const STYLES = [
  {
    id: "casual_phone",
    label: "📱 Casual Фото (iPhone)",
    promptSpec:
      "Aesthetic candid smartphone photo, taken on iPhone 15 Pro portrait mode, casual lifestyle aesthetic, naturally beautiful, stunning charming face, clear smooth glowing skin, natural soft daylight, authentic candid vibe, flattering angle, aesthetic instagram photo",
  },
  {
    id: "soft_portrait",
    label: "📸 Мягкий Портрет",
    promptSpec:
      "Soft aesthetic photography, 35mm f/1.8 shallow depth of field, beautiful attractive young woman, glowing clear skin, soft warm golden hour light, cinematic pleasant color grading, high aesthetic, natural charm",
  },
  {
    id: "anime",
    label: "🌸 Аниме",
    promptSpec:
      "Modern high-end aesthetic anime style, Makoto Shinkai / Kyoto Animation visual novel art, gorgeous expressive eyes, vibrant atmospheric lighting, clean line art, charming expression",
  },
  {
    id: "manhwa",
    label: "✨ Манхва / Webtoon",
    promptSpec:
      "Modern Korean Manhwa aesthetic, romantic webtoon cover art, crisp beautiful character art, clean shading, captivating gaze, stylish aesthetic",
  },
  {
    id: "cinematic_dark",
    label: "🌃 Dark Neon / Mood",
    promptSpec:
      "Moody atmospheric portrait, soft neon city ambient lights, beautiful aesthetic face, glowing clear skin, stylish street fashion, volumetric soft night glow, cinematic 35mm",
  },
];

/* Только отображение — эти значения не передаются модели. */
const STYLE_PRESENTATION: Record<
  string,
  { label: string; icon: typeof Camera }
> = {
  casual_phone: {
    label: "Casual Фото · iPhone",
    icon: Smartphone,
  },
  soft_portrait: {
    label: "Мягкий портрет",
    icon: Camera,
  },
  anime: {
    label: "Аниме",
    icon: Flower2,
  },
  manhwa: {
    label: "Манхва / Webtoon",
    icon: Sparkles,
  },
  cinematic_dark: {
    label: "Dark Neon / Mood",
    icon: Moon,
  },
};

export function ImagePromptModal({
  open,
  onClose,
  character,
}: Props) {
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0].id);
  const [frameType, setFrameType] = useState<
    "avatar" | "wallpaper"
  >("avatar");

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(
    null
  );
  const [copyError, setCopyError] = useState<string | null>(null);

  const id = useId();
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const generate = async (
    styleId = selectedStyle,
    type = frameType
  ) => {
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setCopied(false);
    setCopyError(null);
    setGenerationError(null);

    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }

    try {
      const apiConfig = await getApiConfig();
      const style =
        STYLES.find((item) => item.id === styleId) || STYLES[0];

      const result = await requestImagePrompt(
        apiConfig,
        character,
        `${style.label}: ${style.promptSpec}`,
        type
      );

      /*
       * Более старый ответ не должен подменить результат
       * последнего выбранного стиля или типа кадра.
       * Запросы не отменяются и новые запросы не создаются.
       */
      if (
        mountedRef.current &&
        requestId === requestIdRef.current
      ) {
        setPrompt(result);
      }
    } catch {
      if (
        mountedRef.current &&
        requestId === requestIdRef.current
      ) {
        setPrompt("");
        setGenerationError(
          "Ошибка генерации промпта. Проверьте настройки API и попробуйте ещё раз."
        );
      }
    } finally {
      if (
        mountedRef.current &&
        requestId === requestIdRef.current
      ) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (open && character) {
      void generate(selectedStyle, frameType);
    }

    /*
     * Существующие триггеры сохранены:
     * открытие окна и смена персонажа.
     * Выбор стиля/кадра запускается обработчиками ниже.
     */
  }, [open, character?.id]);

  const handleCopy = async () => {
    if (!prompt || loading || generationError) return;

    const requestId = requestIdRef.current;
    setCopyError(null);

    try {
      await copyTextToClipboard(prompt);

      if (
        !mountedRef.current ||
        requestId !== requestIdRef.current
      ) {
        return;
      }

      setCopied(true);

      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }

      copiedTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopied(false);
      }, 2000);
    } catch {
      if (
        mountedRef.current &&
        requestId === requestIdRef.current
      ) {
        setCopied(false);
        setCopyError(
          "Не удалось скопировать промпт. Можно выделить текст в поле и скопировать его вручную."
        );
      }
    }
  };

  const selectedFrameClass =
    "border-accent/60 bg-accent/10 text-accent";
  const inactiveFrameClass =
    "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3";

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      size="lg"
      title="Генератор промпта для арта"
    >
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"
          >
            <Sparkles size={21} strokeWidth={1.7} />
          </span>

          <div className="min-w-0">
            <p className="text-base font-medium leading-snug text-content [overflow-wrap:anywhere]">
              {character.name}
            </p>

            <p className="mt-1 text-sm leading-relaxed text-content-secondary">
              Английский промпт по описанию персонажа.
              Здесь создаётся текст, а не изображение.
            </p>
          </div>
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-3 text-sm font-medium text-content-secondary">
            Тип изображения
          </legend>

          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <button
              type="button"
              aria-pressed={frameType === "avatar"}
              onClick={() => {
                setFrameType("avatar");
                void generate(selectedStyle, "avatar");
              }}
              className={cn(
                "flex min-h-14 min-w-0 items-center gap-3 rounded-xl border px-4 py-3 text-left",
                "text-sm font-medium transition-colors motion-reduce:transition-none",
                frameType === "avatar"
                  ? selectedFrameClass
                  : inactiveFrameClass
              )}
            >
              <Camera
                size={21}
                strokeWidth={1.7}
                aria-hidden="true"
                className="shrink-0"
              />

              <span className="min-w-0 flex-1">
                Портрет / Аватарка
              </span>

              {frameType === "avatar" && (
                <Check
                  size={16}
                  aria-hidden="true"
                  className="shrink-0"
                />
              )}
            </button>

            <button
              type="button"
              aria-pressed={frameType === "wallpaper"}
              onClick={() => {
                setFrameType("wallpaper");
                void generate(selectedStyle, "wallpaper");
              }}
              className={cn(
                "flex min-h-14 min-w-0 items-center gap-3 rounded-xl border px-4 py-3 text-left",
                "text-sm font-medium transition-colors motion-reduce:transition-none",
                frameType === "wallpaper"
                  ? selectedFrameClass
                  : inactiveFrameClass
              )}
            >
              <ImageIcon
                size={21}
                strokeWidth={1.7}
                aria-hidden="true"
                className="shrink-0"
              />

              <span className="min-w-0 flex-1">
                Сцена / Фон
              </span>

              {frameType === "wallpaper" && (
                <Check
                  size={16}
                  aria-hidden="true"
                  className="shrink-0"
                />
              )}
            </button>
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-3 text-sm font-medium text-content-secondary">
            Художественный стиль
          </legend>

          <div className="flex flex-wrap gap-2">
            {STYLES.map((style) => {
              const presentation = STYLE_PRESENTATION[style.id];
              const Icon = presentation?.icon ?? Sparkles;
              const selected = selectedStyle === style.id;

              return (
                <button
                  key={style.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setSelectedStyle(style.id);
                    void generate(style.id, frameType);
                  }}
                  className={cn(
                    "inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border px-3 py-2.5",
                    "text-sm font-medium transition-colors motion-reduce:transition-none",
                    selected
                      ? selectedFrameClass
                      : inactiveFrameClass
                  )}
                >
                  <Icon
                    size={17}
                    strokeWidth={1.7}
                    aria-hidden="true"
                    className="shrink-0"
                  />

                  <span className="min-w-0 text-left [overflow-wrap:anywhere]">
                    {presentation?.label ?? style.label}
                  </span>

                  {selected && (
                    <Check
                      size={14}
                      aria-hidden="true"
                      className="shrink-0"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-sm leading-relaxed text-content-muted">
            Открытие окна и выбор стиля или типа изображения
            запускают запрос к выбранной модели.
          </p>
        </fieldset>

        <section className="border-t border-border pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor={`${id}-prompt`}
              className="text-sm font-medium text-content-secondary"
            >
              Готовый English-промпт
            </label>

            {prompt && !loading && !generationError && (
              <span className="text-xs tabular-nums text-content-muted">
                {prompt.length.toLocaleString("ru-RU")} симв.
              </span>
            )}
          </div>

          <div className="relative">
            <textarea
              id={`${id}-prompt`}
              readOnly
              rows={8}
              lang="en"
              spellCheck={false}
              aria-busy={loading}
              aria-describedby={
                generationError ? `${id}-generation-error` : undefined
              }
              value={loading ? "" : prompt}
              placeholder={loading ? "" : "Здесь появится готовый промпт."}
              className="input-field resize-y"
            />

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface-2 px-5 py-6">
                <div
                  role="status"
                  className="flex max-w-sm flex-col items-center gap-3 text-center"
                >
                  <Loader2
                    size={25}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className="animate-spin text-accent"
                  />

                  <p className="text-sm leading-relaxed text-content-secondary">
                    Составляем промпт по описанию персонажа…
                  </p>
                </div>
              </div>
            )}
          </div>

          {generationError && (
            <div
              id={`${id}-generation-error`}
              role="alert"
              className="mt-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4"
            >
              <AlertCircle
                size={19}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-danger"
              />

              <p className="min-w-0 text-sm leading-relaxed text-danger">
                {generationError}
              </p>
            </div>
          )}
        </section>

        <div className="border-t border-border pt-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!prompt || loading || !!generationError}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 motion-reduce:transition-none sm:flex-1"
            >
              {copied ? (
                <Check size={18} aria-hidden="true" />
              ) : (
                <Copy size={18} aria-hidden="true" />
              )}
              Скопировать промпт
            </button>

            <button
              type="button"
              onClick={() => void generate(selectedStyle, frameType)}
              disabled={loading}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-4 py-3 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content disabled:opacity-40 motion-reduce:transition-none"
            >
              <RefreshCw
                size={17}
                aria-hidden="true"
                className={loading ? "animate-spin" : undefined}
              />
              Другой вариант
            </button>
          </div>

          <div
            role="status"
            aria-live="polite"
            className="mt-3 min-h-5 text-sm text-success"
          >
            {copied ? "Промпт скопирован." : ""}
          </div>

          {copyError && (
            <p
              role="alert"
              className="mt-2 text-sm leading-relaxed text-danger"
            >
              {copyError}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}