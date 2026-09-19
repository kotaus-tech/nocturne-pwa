import { useId, useState } from "react";
import {
  Sparkles,
  Dices,
  RotateCcw,
  Loader2,
  Check,
  Tags,
  User,
  MessageCircle,
  MapPin,
  HeartHandshake,
  BookOpen,
  Palette,
  AlertCircle,
} from "lucide-react";
import { Modal } from "../common/Modal";
import {
  TAG_CATEGORIES,
  generateAiCharacter,
} from "../../services/characterGenerator";
import { isLocalEndpoint } from "../../services/apiClient";
import { getApiConfig } from "../../db";
import type { Character } from "../../types";
import { cn } from "../../utils/cn";

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (generated: Partial<Character>) => void;
}

type Gender = "female" | "male" | "any";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Девушка" },
  { value: "male", label: "Парень" },
  { value: "any", label: "Любой" },
];

const CATEGORY_ICONS: Record<string, typeof Tags> = {
  archetype: User,
  speech_style: MessageCircle,
  setting: MapPin,
  dynamic: HeartHandshake,
  tone: BookOpen,
  style: Palette,
};

export function CharacterGeneratorModal({
  open,
  onClose,
  onApply,
}: Props) {
  const [activeCat, setActiveCat] = useState("archetype");
  const [gender, setGender] = useState<Gender>("female");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customIdea, setCustomIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ideaId = useId();
  const categoryHeadingId = useId();

  const toggleTag = (tagName: string) => {
    setSelectedTags((previous) =>
      previous.includes(tagName)
        ? previous.filter((tag) => tag !== tagName)
        : [...previous, tagName]
    );
  };

  const handleRandomMix = () => {
    const genders: Gender[] = ["female", "male", "female"];
    setGender(genders[Math.floor(Math.random() * genders.length)]);

    const chosen: string[] = [];
    const catsToPick = [
      "archetype",
      "speech_style",
      "setting",
      "dynamic",
      "tone",
      "style",
    ];

    catsToPick.forEach((catId) => {
      const category = TAG_CATEGORIES.find((item) => item.id === catId);
      if (category && category.tags.length > 0) {
        const tag = category.tags[Math.floor(Math.random() * category.tags.length)];
        chosen.push(tag.name);
      }
    });

    setSelectedTags(chosen);
  };

  const handleGenerate = async () => {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const apiConfig = await getApiConfig();
      const isLocal = isLocalEndpoint(apiConfig?.baseUrl);

      if (!apiConfig || (!apiConfig.apiKey && !isLocal)) {
        throw new Error("Не указан API-ключ в Настройках приложения!");
      }

      const generated = await generateAiCharacter(
        apiConfig,
        gender,
        selectedTags,
        customIdea
      );

      onApply(generated);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сгенерировать персонажа."
      );
    } finally {
      setLoading(false);
    }
  };

  const currentCategory =
    TAG_CATEGORIES.find((category) => category.id === activeCat) ||
    TAG_CATEGORIES[0];

  const currentCategoryId = currentCategory?.id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      size="lg"
      title="AI-генератор персонажа"
    >
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"
          >
            <Sparkles size={21} strokeWidth={1.6} />
          </div>

          <p className="min-w-0 text-base leading-relaxed text-content-secondary">
            Выберите теги и добавьте свою задумку. Результат появится в редакторе персонажа.
          </p>
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-3 text-sm font-medium text-content-secondary">
            Пол персонажа
          </legend>

          <div className="grid grid-cols-3 gap-2">
            {GENDERS.map(({ value, label }) => {
              const selected = gender === value;

              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setGender(value)}
                  className={cn(
                    "flex min-h-12 min-w-0 flex-wrap items-center justify-center gap-1.5",
                    "rounded-xl border px-2 py-3 text-sm font-medium transition-all",
                    selected
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                  )}
                >
                  {selected && (
                    <Check
                      size={15}
                      strokeWidth={2.2}
                      aria-hidden="true"
                      className="shrink-0"
                    />
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <section aria-labelledby={categoryHeadingId}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3
              id={categoryHeadingId}
              className="text-sm font-medium text-content-secondary"
            >
              Категории тегов
            </h3>

            <span className="text-sm tabular-nums text-content-muted">
              Выбрано: {selectedTags.length}
            </span>
          </div>

          <div
            role="group"
            aria-label="Выбор категории тегов"
            className="flex gap-2 overflow-x-auto px-1 pb-3 pt-1"
          >
            {TAG_CATEGORIES.map((category) => {
              const selected = category.id === currentCategoryId;
              const Icon = CATEGORY_ICONS[category.id] ?? Tags;
              const count = category.tags.filter((tag) =>
                selectedTags.includes(tag.name)
              ).length;

              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveCat(category.id)}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center gap-2",
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                    selected
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                  )}
                >
                  <Icon
                    size={17}
                    strokeWidth={selected ? 2 : 1.7}
                    aria-hidden="true"
                  />
                  <span>{category.title}</span>
                  {count > 0 && (
                    <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-xs tabular-nums text-content">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {currentCategory && (
            <div
              role="group"
              aria-label={`Теги: ${currentCategory.title}`}
              className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {currentCategory.tags.map((tag) => {
                const selected = selectedTags.includes(tag.name);

                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleTag(tag.name)}
                    className={cn(
                      "flex min-h-20 min-w-0 items-start gap-3 rounded-2xl border p-4 text-left transition-all",
                      selected
                        ? "border-accent/60 bg-accent/10"
                        : "border-border bg-surface-2 hover:border-border-strong hover:bg-surface-3"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                        selected
                          ? "border-accent bg-accent text-on-accent"
                          : "border-control-border"
                      )}
                    >
                      {selected && <Check size={14} strokeWidth={2.5} />}
                    </span>

                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-base font-medium leading-snug [overflow-wrap:anywhere]",
                          selected ? "text-accent" : "text-content"
                        )}
                      >
                        {tag.name}
                      </span>
                      <span className="mt-1.5 block text-sm leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
                        {tag.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div className="border-t border-border pt-5">
          <label
            htmlFor={ideaId}
            className="mb-2 block text-sm font-medium text-content-secondary"
          >
            Своя идея или деталь
            <span className="ml-1 font-normal text-content-muted">
              — необязательно
            </span>
          </label>

          <input
            id={ideaId}
            className="input-field"
            placeholder="Например: играет на бас-гитаре, белые волосы..."
            value={customIdea}
            onChange={(event) => setCustomIdea(event.target.value)}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4"
          >
            <AlertCircle
              size={19}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-danger"
            />
            <p className="min-w-0 text-sm leading-relaxed text-danger [overflow-wrap:anywhere]">
              {error}
            </p>
          </div>
        )}

        <div className="space-y-4 border-t border-border pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRandomMix}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-3 hover:text-content disabled:opacity-50"
            >
              <Dices size={18} aria-hidden="true" />
              <span>Случайный микс</span>
            </button>

            {selectedTags.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                disabled={loading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-content-muted hover:bg-surface-2 hover:text-content disabled:opacity-50"
              >
                <RotateCcw size={17} aria-hidden="true" />
                <span>Сбросить теги</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            aria-busy={loading}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? (
              <Loader2
                size={19}
                aria-hidden="true"
                className="shrink-0 animate-spin"
              />
            ) : (
              <Sparkles
                size={19}
                aria-hidden="true"
                className="shrink-0"
              />
            )}
            <span>Сгенерировать персонажа</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}