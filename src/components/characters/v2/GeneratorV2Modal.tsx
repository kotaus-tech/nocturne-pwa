// =============================================================
// CHARACTER DNA — UI ГЕНЕРАТОРА V2
//
// Отдельный экран, не трогающий V1. Принцип «глубина без перегрузки»:
// основной набор настроек виден сразу, расширенные категории спрятаны в
// сворачиваемый блок. Пустой выбор в категории = «любое, решит AI»;
// 🎲 выбирает случайную опцию.
//
// Шаги: настройки → генерация → результат с частичной перегенерацией.
// =============================================================

import { useId, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Dices,
  Dna,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { Modal } from "../../common/Modal";
import { getApiConfig } from "../../../db";
import { isLocalEndpoint } from "../../../services/apiClient";
import {
  ADULT_PACE_OPTIONS,
  ADULT_POWER_OPTIONS,
  ADULT_STYLE_OPTIONS,
  AGE_BANDS,
  V2_CATALOG,
  V2_PRESETS,
  type V2Category,
  type V2Option,
} from "../../../services/v2/catalog";
import {
  generateV2Blueprint,
  regenerateV2Sections,
} from "../../../services/v2/generator";
import { SECTION_LABELS } from "../../../services/v2/prompt";
import { blueprintToCharacter } from "../../../services/v2/toCharacter";
import type {
  CharacterBlueprintV2,
  V2Preferences,
  V2Section,
  V2Uniqueness,
} from "../../../services/v2/v2types";
import type { Character } from "../../../types";
import { cn } from "../../../utils/cn";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Готовый персонаж (со всеми полями карточки) отдаётся наружу. */
  onApply: (character: Character) => void | Promise<void>;
}

type Step = "settings" | "working" | "result";
type GenderChoice = "female" | "male" | "any";

const UNIQNESS_LABELS: Record<V2Uniqueness, string> = {
  0: "Классический типаж",
  1: "Реалистичный",
  2: "Необычное сочетание",
  3: "Максимально нестандартный",
};

const SECTION_ORDER: V2Section[] = [
  "appearance",
  "occupation",
  "psychology",
  "lifestyle",
  "relationship",
  "speech",
  "scenario",
  "firstMessage",
];

const emptyPrefs = () => ({
  gender: "any" as GenderChoice,
  ageBandId: "",
  selections: {} as Record<string, string[]>,
  customIdea: "",
  uniqueness: 1 as V2Uniqueness,
  adultEnabled: false,
  presetId: "preset_none",
});

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function GeneratorV2Modal({ open, onClose, onApply }: Props) {
  const [step, setStep] = useState<Step>("settings");
  const [workingLabel, setWorkingLabel] = useState("Собираем ДНК персонажа…");

  const [gender, setGender] = useState<GenderChoice>("any");
  const [ageBandId, setAgeBandId] = useState("");
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [customIdea, setCustomIdea] = useState("");
  const [uniqueness, setUniqueness] = useState<V2Uniqueness>(1);
  const [adultEnabled, setAdultEnabled] = useState(false);
  const [presetId, setPresetId] = useState("preset_none");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [blueprint, setBlueprint] = useState<CharacterBlueprintV2 | null>(null);
  const [corrected, setCorrected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ideaId = useId();

  // ------------------------------------------------------------
  // выбор опций
  // ------------------------------------------------------------

  const toggleOption = (category: V2Category, optionId: string) => {
    setSelections((previous) => {
      const current = previous[category.id] ?? [];
      if (current.includes(optionId)) {
        return { ...previous, [category.id]: current.filter((id) => id !== optionId) };
      }
      if (category.max === 1) return { ...previous, [category.id]: [optionId] };
      if (current.length >= category.max) return previous;
      return { ...previous, [category.id]: [...current, optionId] };
    });
  };

  const clearCategory = (categoryId: string) => {
    setSelections((previous) => ({ ...previous, [categoryId]: [] }));
  };

  const randomizeCategory = (category: V2Category) => {
    const option = pickRandom(category.options);
    setSelections((previous) => ({ ...previous, [category.id]: [option.id] }));
  };

  const toggleAdultOption = (key: string, optionId: string, multi: boolean) => {
    setSelections((previous) => {
      const current = previous[key] ?? [];
      if (current.includes(optionId)) {
        return { ...previous, [key]: current.filter((id) => id !== optionId) };
      }
      if (!multi) return { ...previous, [key]: [optionId] };
      return { ...previous, [key]: [...current, optionId] };
    });
  };

  /** «Сюрприз»: почти всё случайно, но авторская задумка и 18+ — за пользователем. */
  const handleSurprise = () => {
    setGender(pickRandom<GenderChoice>(["female", "male", "female", "male"]));
    setAgeBandId(pickRandom(AGE_BANDS).id);
    setUniqueness(pickRandom<V2Uniqueness>([1, 2, 2]));

    const next: Record<string, string[]> = {};
    for (const category of V2_CATALOG) {
      if (category.id === "dramaLevel" && Math.random() < 0.5) continue;
      next[category.id] = [pickRandom(category.options).id];
    }
    setSelections(next);
  };

  const handleReset = () => {
    const fresh = emptyPrefs();
    setGender(fresh.gender);
    setAgeBandId(fresh.ageBandId);
    setSelections({});
    setCustomIdea("");
    setUniqueness(fresh.uniqueness);
    setAdultEnabled(false);
    setPresetId(fresh.presetId);
    setError(null);
  };

  // ------------------------------------------------------------
  // генерация
  // ------------------------------------------------------------

  const buildPrefs = (): V2Preferences => ({
    gender,
    ageBandId,
    selections,
    customIdea,
    uniqueness,
    adultEnabled,
    presetId,
  });

  const preferenceNames = (): string[] => {
    const names: string[] = [];
    for (const category of V2_CATALOG) {
      const selected = selections[category.id] ?? [];
      for (const option of category.options) {
        if (selected.includes(option.id)) names.push(option.name);
      }
    }
    return names;
  };

  const handleGenerate = async () => {
    setError(null);
    setStep("working");
    setWorkingLabel("Собираем ДНК персонажа… Это может занять до минуты.");

    try {
      const apiConfig = await getApiConfig();
      if (!apiConfig || (!apiConfig.apiKey && !isLocalEndpoint(apiConfig.baseUrl))) {
        throw new Error("Не указан API-ключ в Настройках приложения!");
      }

      const result = await generateV2Blueprint(apiConfig, buildPrefs());
      setBlueprint(result.blueprint);
      setCorrected(result.corrected);
      setStep("result");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сгенерировать персонажа."
      );
      setStep("settings");
    }
  };

  const handleRegenerateSection = async (section: V2Section) => {
    if (!blueprint) return;
    setError(null);
    setStep("working");
    setWorkingLabel(`Перегенерируем: ${SECTION_LABELS[section]}…`);

    try {
      const apiConfig = await getApiConfig();
      const result = await regenerateV2Sections(apiConfig, buildPrefs(), blueprint, [section]);
      setBlueprint(result.blueprint);
      setCorrected(result.corrected);
      setStep("result");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось перегенерировать секцию."
      );
      setStep("result");
    }
  };

  const handleSave = async () => {
    if (!blueprint || saving) return;
    setSaving(true);
    setError(null);

    try {
      const character = blueprintToCharacter(blueprint, {
        preferenceNames: preferenceNames(),
      });
      await onApply(character);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить персонажа.");
      setStep("result");
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------
  // рендер
  // ------------------------------------------------------------

  const simpleCategories = V2_CATALOG.filter((category) => !category.advanced);
  const advancedCategories = V2_CATALOG.filter((category) => category.advanced);
  const selectionCount = Object.values(selections).reduce((sum, ids) => sum + ids.length, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      size="lg"
      title="Character DNA — генератор V2"
    >
      {step === "working" && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <Loader2 size={34} className="animate-spin text-accent" aria-hidden="true" />
          <p className="text-base font-semibold text-zinc-100">{workingLabel}</p>
          <p className="max-w-md text-sm leading-relaxed text-content-secondary">
            Модель строит психологический профиль: характер, слои личности, быт,
            речь, отношения и сценарий. Обычно это занимает 20–60 секунд.
          </p>
        </div>
      )}

      {step === "settings" && (
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <div
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"
            >
              <Dna size={21} strokeWidth={1.6} />
            </div>
            <p className="min-w-0 text-base leading-relaxed text-content-secondary">
              Расширенный генератор современных взрослых персонажей: вместо «набора
              тегов» модель собирает цельного человека — с характером, бытом, речью,
              границами и собственной жизнью.
            </p>
          </div>

          {/* Пол */}
          <fieldset className="min-w-0">
            <legend className="mb-3 text-sm font-medium text-content-secondary">Пол персонажа</legend>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: "any", label: "Любой" },
                  { value: "female", label: "Женщина" },
                  { value: "male", label: "Мужчина" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={gender === option.value}
                  onClick={() => setGender(option.value)}
                  className={cn(
                    "flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-medium transition-all",
                    gender === option.value
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                  )}
                >
                  {gender === option.value && <Check size={15} strokeWidth={2.2} />}
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* Возраст */}
          <fieldset className="min-w-0">
            <legend className="mb-3 text-sm font-medium text-content-secondary">
              Возраст <span className="font-normal text-content-muted">(только 18+)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              <ChipButton
                selected={ageBandId === ""}
                onClick={() => setAgeBandId("")}
                label="Любой"
              />
              {AGE_BANDS.map((band) => (
                <ChipButton
                  key={band.id}
                  selected={ageBandId === band.id}
                  onClick={() => setAgeBandId(band.id)}
                  label={band.name}
                />
              ))}
            </div>
          </fieldset>

          {/* Авторская задумка */}
          <div>
            <label
              htmlFor={ideaId}
              className="mb-2 block text-sm font-medium text-content-secondary"
            >
              Своя идея
              <span className="ml-1 font-normal text-content-muted">
                — необязательно, но с высоким приоритетом
              </span>
            </label>
            <input
              id={ideaId}
              className="input-field"
              placeholder="Например: девушка, с которой мы постоянно пересекаемся в одной кофейне…"
              value={customIdea}
              onChange={(event) => setCustomIdea(event.target.value)}
            />
          </div>

          {/* Основные категории */}
          <section aria-label="Основные настройки" className="space-y-4">
            {simpleCategories.map((category) => (
              <CategoryBlock
                key={category.id}
                category={category}
                selected={selections[category.id] ?? []}
                onToggle={(optionId) => toggleOption(category, optionId)}
                onClear={() => clearCategory(category.id)}
                onDice={() => randomizeCategory(category)}
              />
            ))}
          </section>

          {/* Расширенные настройки */}
          <div className="rounded-2xl border border-white/[0.07] bg-[#121622]/70">
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              aria-expanded={showAdvanced}
              className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-content"
            >
              <span className="flex items-center gap-2">
                <Sparkles size={16} className="text-accent" aria-hidden="true" />
                Расширенные настройки
                <span className="text-xs font-normal text-content-muted">
                  характер, недостатки, речь, романтика, 18+…
                </span>
              </span>
              <ChevronDown
                size={17}
                className={cn("text-content-muted transition-transform", showAdvanced && "rotate-180")}
                aria-hidden="true"
              />
            </button>

            {showAdvanced && (
              <div className="space-y-4 border-t border-white/[0.07] p-4">
                {/* Пресет */}
                <div>
                  <p className="mb-2 text-sm font-medium text-content-secondary">
                    Поведенческий пресет
                    <span className="ml-1 font-normal text-content-muted">— затравка, не шаблон</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {V2_PRESETS.map((preset) => (
                      <ChipButton
                        key={preset.id}
                        selected={presetId === preset.id}
                        onClick={() => setPresetId(preset.id)}
                        label={preset.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Уровень необычности */}
                <div>
                  <p className="mb-2 text-sm font-medium text-content-secondary">
                    Уровень необычности сочетаний
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {([0, 1, 2, 3] as V2Uniqueness[]).map((level) => (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={uniqueness === level}
                        onClick={() => setUniqueness(level)}
                        className={cn(
                          "min-h-12 rounded-xl border px-2 py-2 text-xs font-medium leading-snug transition-all",
                          uniqueness === level
                            ? "border-accent/60 bg-accent/10 text-accent"
                            : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                        )}
                      >
                        <span className="block text-sm font-bold">{level}</span>
                        {UNIQNESS_LABELS[level]}
                      </button>
                    ))}
                  </div>
                </div>

                {advancedCategories.map((category) => (
                  <CategoryBlock
                    key={category.id}
                    category={category}
                    selected={selections[category.id] ?? []}
                    onToggle={(optionId) => toggleOption(category, optionId)}
                    onClear={() => clearCategory(category.id)}
                    onDice={() => randomizeCategory(category)}
                  />
                ))}

                {/* Взрослый профиль */}
                <div className="rounded-2xl border border-white/[0.07] bg-surface-2/60 p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={adultEnabled}
                      onChange={(event) => setAdultEnabled(event.target.checked)}
                      className="mt-1 h-4 w-4 accent-accent"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-content">
                        Adult-профиль (18+)
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-content-secondary">
                        Описывает поведение персонажа в близости, если отношения до неё
                        естественно дошли. В обычных диалогах персонаж не переводит всё в
                        сексуальный контекст. Персонаж всегда однозначно взрослый.
                      </span>
                    </span>
                  </label>

                  {adultEnabled && (
                    <div className="mt-4 space-y-3">
                      <AdultOptionRow
                        label="Стиль близости"
                        options={ADULT_STYLE_OPTIONS}
                        selected={selections["adultStyle"] ?? []}
                        onToggle={(optionId) =>
                          toggleAdultOption("adultStyle", optionId, true)
                        }
                      />
                      <AdultOptionRow
                        label="Темп"
                        options={ADULT_PACE_OPTIONS}
                        selected={selections["adultPace"] ?? []}
                        onToggle={(optionId) =>
                          toggleAdultOption("adultPace", optionId, false)
                        }
                      />
                      <AdultOptionRow
                        label="Динамика власти"
                        options={ADULT_POWER_OPTIONS}
                        selected={selections["adultPower"] ?? []}
                        onToggle={(optionId) =>
                          toggleAdultOption("adultPower", optionId, false)
                        }
                      />
                      <p className="text-xs text-content-muted">
                        Остальные параметры (либидо, открытость, инициатива…) модель подберёт
                        сама независимыми друг от друга.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="space-y-4 border-t border-border pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSurprise}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-3 hover:text-content"
              >
                <Dices size={18} aria-hidden="true" />
                <span>Сюрприз 🎲</span>
              </button>

              {selectionCount > 0 && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-content-muted hover:bg-surface-2 hover:text-content"
                >
                  <RotateCcw size={17} aria-hidden="true" />
                  <span>Сбросить</span>
                </button>
              )}

              <span className="ml-auto text-sm tabular-nums text-content-muted">
                Выбрано: {selectionCount} · классический генератор (V1) остался на месте
              </span>
            </div>

            <button
              type="button"
              onClick={() => void handleGenerate()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-on-accent hover:bg-accent-hover"
            >
              <Dna size={19} aria-hidden="true" />
              <span>Сгенерировать персонажа</span>
            </button>
          </div>
        </div>
      )}

      {step === "result" && blueprint && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                Character DNA · {blueprint.identity.age} лет ·{" "}
                {blueprint.identity.gender === "female" ? "женщина" : "мужчина"}
              </p>
              <h3 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100">
                {blueprint.identity.name}
              </h3>
              {blueprint.tagline && (
                <p className="mt-1 text-sm text-content-secondary">{blueprint.tagline}</p>
              )}
            </div>

            {corrected && (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning">
                Ответ исправлен после самопроверки
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ResultCard title="Кем кажется и какой на самом деле">
              <p><b>Для людей:</b> {blueprint.psychology.publicSelf}</p>
              <p className="mt-1.5"><b>Наедине:</b> {blueprint.psychology.privateSelf}</p>
              <p className="mt-1.5"><b>В уязвимости:</b> {blueprint.psychology.vulnerableSelf}</p>
            </ResultCard>

            <ResultCard title="Внешность">
              <p>{blueprint.appearance.summary}</p>
              {blueprint.appearance.distinctiveMarks.length > 0 && (
                <p className="mt-1.5">
                  <b>Приметы:</b> {blueprint.appearance.distinctiveMarks.join("; ")}
                </p>
              )}
              {blueprint.appearance.bodyLanguage.length > 0 && (
                <p className="mt-1.5">
                  <b>Язык тела:</b> {blueprint.appearance.bodyLanguage.join("; ")}
                </p>
              )}
            </ResultCard>

            <ResultCard title="Характер">
              <p><b>Сильные стороны:</b> {blueprint.psychology.strengths.join(", ")}</p>
              <p className="mt-1.5"><b>Недостатки:</b> {blueprint.psychology.flaws.join(", ")}</p>
              {blueprint.psychology.contradictions.length > 0 && (
                <p className="mt-1.5">
                  <b>Противоречия:</b>{" "}
                  {blueprint.psychology.contradictions
                    .map((contradiction) => `${contradiction.a} — но ${contradiction.b}`)
                    .join("; ")}
                </p>
              )}
            </ResultCard>

            <ResultCard title="Жизнь">
              <p>
                <b>{blueprint.identity.occupationTitle || blueprint.life.occupationField}.</b>{" "}
                {blueprint.life.occupationImpact}
              </p>
              {blueprint.life.lifestyleDetails.length > 0 && (
                <p className="mt-1.5">
                  {blueprint.life.lifestyleDetails.slice(0, 4).join(". ")}.
                </p>
              )}
              {blueprint.psychology.wants.length > 0 && (
                <p className="mt-1.5"><b>Свои цели:</b> {blueprint.psychology.wants.join("; ")}</p>
              )}
            </ResultCard>

            <ResultCard title="Отношения с вами">
              <p><b>Связь:</b> {blueprint.relationship.dynamic}</p>
              <p className="mt-1.5"><b>Отношение на старте:</b> {blueprint.relationship.attitude}</p>
              <p className="mt-1.5">
                <b>Темп:</b> {blueprint.relationship.pacing} · <b>Стадия:</b>{" "}
                {blueprint.relationship.stage}
              </p>
            </ResultCard>

            <ResultCard title="Голос">
              <p>
                {[
                  blueprint.speech.verbosity,
                  blueprint.speech.formality,
                  blueprint.speech.humor,
                  blueprint.speech.profanity,
                ].join(" · ")}
              </p>
              {blueprint.speech.examples.slice(0, 2).map((example) => (
                <p key={example.line} className="mt-1.5 italic">
                  [{example.mood}] «{example.line}»
                </p>
              ))}
            </ResultCard>

            <ResultCard title="Сценарий">
              <p>{blueprint.scenario.text}</p>
            </ResultCard>
          </div>

          <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
              Первое сообщение
            </p>
            <p className="text-sm leading-relaxed text-content">{blueprint.firstMessage}</p>
          </div>

          {error && <ErrorBanner message={error} />}

          {/* Частичная перегенерация */}
          <div className="rounded-2xl border border-white/[0.07] bg-[#121622]/70 p-4">
            <p className="mb-3 text-sm font-medium text-content-secondary">
              Перегенерировать только часть — остальное сохранится
            </p>
            <div className="flex flex-wrap gap-2">
              {SECTION_ORDER.map((section) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => void handleRegenerateSection(section)}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border-strong bg-surface-2 px-3 py-2 text-xs font-medium text-content-secondary hover:border-accent/40 hover:bg-surface-3 hover:text-content"
                >
                  <RefreshCw size={13} aria-hidden="true" />
                  {SECTION_LABELS[section]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={19} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={19} aria-hidden="true" />
              )}
              <span>Сохранить персонажа</span>
            </button>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-3 hover:text-content"
              >
                <Dices size={17} aria-hidden="true" />
                <span>Другой персонаж</span>
              </button>

              <button
                type="button"
                onClick={() => setStep("settings")}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-content-muted hover:bg-surface-2 hover:text-content"
              >
                <RotateCcw size={16} aria-hidden="true" />
                <span>К настройкам</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------
// Вспомогательные блоки
// ------------------------------------------------------------------

function ChipButton({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all",
        selected
          ? "border-accent/60 bg-accent/10 text-accent"
          : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
      )}
    >
      {selected && <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}

function CategoryBlock({
  category,
  selected,
  onToggle,
  onClear,
  onDice,
}: {
  category: V2Category;
  selected: string[];
  onToggle: (optionId: string) => void;
  onClear: () => void;
  onDice: () => void;
}) {
  return (
    <section
      aria-label={category.title}
      className="rounded-2xl border border-white/[0.07] bg-surface-2/40 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="text-base">{category.icon}</span>
        <h4 className="text-sm font-semibold text-content">{category.title}</h4>

        <span className="ml-auto flex items-center gap-1.5">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-content-muted hover:bg-surface-3 hover:text-content"
              title="Любое — пусть решит AI"
            >
              Любое
            </button>
          )}
          <button
            type="button"
            onClick={onDice}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong bg-surface-2 px-2.5 py-1.5 text-xs text-content-secondary hover:bg-surface-3 hover:text-content"
            title="Случайный выбор"
            aria-label={`Случайный выбор: ${category.title}`}
          >
            <Dices size={15} aria-hidden="true" />
          </button>
        </span>
      </div>

      {category.note && (
        <p className="mb-3 text-xs leading-relaxed text-content-muted">{category.note}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {category.options.map((option) => {
          const isSelected = selected.includes(option.id);
          const disabled = !isSelected && category.max > 1 && selected.length >= category.max;

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onToggle(option.id)}
              title={option.hint}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all",
                isSelected
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3",
                disabled && "cursor-not-allowed opacity-40"
              )}
            >
              {isSelected && <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
              <span>{option.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AdultOptionRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: V2Option[];
  selected: string[];
  onToggle: (optionId: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-content-secondary">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(option.id)}
              title={option.hint}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all",
                isSelected
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
              )}
            >
              {isSelected && <Check size={13} strokeWidth={2.4} aria-hidden="true" />}
              <span>{option.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResultCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-surface-2/50 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-muted">
        {title}
      </p>
      <div className="text-sm leading-relaxed text-content [overflow-wrap:anywhere]">
        {children}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4"
    >
      <AlertCircle size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      <p className="min-w-0 text-sm leading-relaxed text-danger [overflow-wrap:anywhere]">
        {message}
      </p>
    </div>
  );
}
