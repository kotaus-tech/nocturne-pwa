import { useId, useState } from "react";
import { Check, ChevronDown, Dices, Sparkles, Users } from "lucide-react";
import {
  GROUP_AGE_BANDS,
  GROUP_CATALOG,
  GROUP_GENDER_OPTIONS,
  GROUP_PRESETS,
  GROUP_RELATION_OPTIONS,
  GROUP_UNIQUENESS_OPTIONS,
} from "../../services/groupGenerator/catalog";
import type { GroupPreferences } from "../../services/groupGenerator/types";
import { cn } from "../../utils/cn";
import { ErrorBanner } from "./GroupGeneratorFeedback";

interface Props {
  prefs: GroupPreferences;
  setPreference: <K extends keyof GroupPreferences>(key: K, value: GroupPreferences[K]) => void;
  onToggleOption: (categoryId: string, optionId: string, max: number) => void;
  onRandomizeCategory: (categoryId: string, options: { id: string }[]) => void;
  onClearCategory: (categoryId: string) => void;
  onApplyPreset: (presetId: string) => void;
  onSurprise: () => void;
  onGenerate: () => void;
  error: string | null;
}

export function GroupGeneratorSettings({
  prefs,
  setPreference,
  onToggleOption,
  onRandomizeCategory,
  onClearCategory: clearCategory,
  onApplyPreset,
  onSurprise,
  onGenerate,
  error,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const ideaId = useId();

  return (
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden="true">
              <Users size={21} strokeWidth={1.7} />
            </div>
            <p className="min-w-0 text-base leading-relaxed text-content-secondary">
              Group DNA V2 собирает современный реалистичный ансамбль: самостоятельных
              героев, социальную позицию игрока, физику места, скрытые знания и общий
              опенинг. NPC смогут разговаривать друг с другом, а игрок получит естественный
              повод войти в сцену, не становясь её обязательным центром.
            </p>
          </div>

          <fieldset>
            <legend className="mb-3 text-sm font-medium text-content-secondary">Размер группы</legend>
            <div className="grid grid-cols-3 gap-2">
              {[2, 3, 4].map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={prefs.size === size}
                  onClick={() => setPreference("size", size)}
                  className={cn(
                    "flex min-h-12 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-all",
                    prefs.size === size
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                  )}
                >
                  {prefs.size === size && <Check size={15} aria-hidden="true" />}
                  {size} героя
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-content-secondary">Состав</legend>
              <div className="grid grid-cols-2 gap-2">
                {GROUP_GENDER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.hint}
                    aria-pressed={prefs.gender === option.value}
                    onClick={() => setPreference("gender", option.value)}
                    className={cn(
                      "min-h-11 rounded-xl border px-2 py-2 text-xs font-medium transition-all",
                      prefs.gender === option.value
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-3 text-sm font-medium text-content-secondary">Возраст</legend>
              <select
                value={prefs.ageBandId}
                onChange={(event) => setPreference("ageBandId", event.target.value)}
                className="input-field min-h-11 text-sm"
                aria-label="Возрастной диапазон группы"
              >
                {GROUP_AGE_BANDS.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </fieldset>
          </div>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-content-secondary">Смысловые настройки ансамбля</h3>
              <span className="text-xs text-content-muted">Пустая категория = решит AI</span>
            </div>
            <div className="space-y-3">
              {GROUP_CATALOG.filter((category) => !category.advanced && !category.legacy && !category.adultOnly).map((category) => (
                <CategoryBlock
                  key={category.id}
                  category={category}
                  selected={prefs.selections[category.id] ?? []}
                  onToggle={(optionId) => onToggleOption(category.id, optionId, category.max)}
                  onDice={() => onRandomizeCategory(category.id, category.options.filter((option) => !option.hint.startsWith("legacy:")))}
                  onClear={() => clearCategory(category.id)}
                />
              ))}
            </div>
          </section>

          <div className="rounded-2xl border border-white/[0.07] bg-[#121622]/70 p-3.5">
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-content-secondary"
              aria-expanded={showAdvanced}
            >
              <span>Расширенные настройки ансамбля</span>
              <ChevronDown size={16} className={cn("transition-transform", showAdvanced && "rotate-180")} />
            </button>
            {showAdvanced && (
              <div className="mt-4 space-y-4 border-t border-white/[0.07] pt-4">
                {GROUP_CATALOG.filter((category) => category.advanced && !category.legacy && !category.adultOnly).map((category) => (
                  <CategoryBlock
                    key={category.id}
                    category={category}
                    selected={prefs.selections[category.id] ?? []}
                    onToggle={(optionId) => onToggleOption(category.id, optionId, category.max)}
                    onDice={() => onRandomizeCategory(category.id, category.options.filter((option) => !option.hint.startsWith("legacy:")))}
                    onClear={() => clearCategory(category.id)}
                  />
                ))}

                <fieldset>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-muted">Отношения</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {GROUP_RELATION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        title={option.hint}
                        aria-pressed={prefs.relationIntensity === option.value}
                        onClick={() => setPreference("relationIntensity", option.value)}
                        className={cn(
                          "min-h-10 rounded-xl border px-2 py-2 text-xs font-medium",
                          prefs.relationIntensity === option.value
                            ? "border-accent/60 bg-accent/10 text-accent"
                            : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-muted">Необычность сочетаний</legend>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {GROUP_UNIQUENESS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        title={option.hint}
                        aria-pressed={prefs.uniqueness === option.value}
                        onClick={() => setPreference("uniqueness", option.value)}
                        className={cn(
                          "min-h-10 rounded-xl border px-2 py-2 text-xs font-medium",
                          prefs.uniqueness === option.value
                            ? "border-accent/60 bg-accent/10 text-accent"
                            : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/[0.07] bg-surface-2/60 p-3 text-xs text-content-secondary">
                  <input
                    type="checkbox"
                    checked={prefs.adultEnabled}
                    onChange={(event) => setPreference("adultEnabled", event.target.checked)}
                    className="mt-0.5 accent-accent"
                  />
                  <span>
                    Контекстный взрослый профиль (18+)
                    <span className="mt-1 block text-[11px] leading-relaxed text-content-muted">
                      Разрешает модели учитывать взрослые темы только при естественной взаимности. Не включает сексуальный режим всей сцены.
                    </span>
                  </span>
                </label>

                {prefs.adultEnabled && GROUP_CATALOG.filter((category) => category.adultOnly).map((category) => (
                  <CategoryBlock
                    key={category.id}
                    category={category}
                    selected={prefs.selections[category.id] ?? []}
                    onToggle={(optionId) => onToggleOption(category.id, optionId, category.max)}
                    onDice={() => onRandomizeCategory(category.id, category.options)}
                    onClear={() => clearCategory(category.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <label htmlFor={ideaId} className="mb-2 block text-sm font-medium text-content-secondary">
              Своя задумка или обязательная деталь <span className="font-normal text-content-muted">— необязательно</span>
            </label>
            <textarea
              id={ideaId}
              value={prefs.customIdea}
              onChange={(event) => setPreference("customIdea", event.target.value)}
              rows={3}
              maxLength={1600}
              placeholder="Например: ночная смена в маленьком отеле; один гость хочет уехать, администратор скрывает проблему, курьер случайно знает больше всех…"
              className="input-field resize-y text-sm leading-relaxed"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-content-secondary">Быстрый пресет</p>
            <div className="flex flex-wrap gap-2">
              {GROUP_PRESETS.filter((preset) => !("legacy" in preset)).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.hint}
                  aria-pressed={prefs.presetId === preset.id}
                  onClick={() => onApplyPreset(preset.id)}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium",
                    prefs.presetId === preset.id
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3"
                  )}
                >
                  {prefs.presetId === preset.id && <Check size={13} />}
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <button
              type="button"
              onClick={onSurprise}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-3 hover:text-content"
            >
              <Dices size={17} />
              Случайный ансамбль
            </button>
            <button
              type="button"
              onClick={() => void onGenerate()}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover"
            >
              <Sparkles size={18} />
              Сгенерировать группу
            </button>
          </div>
        </div>

  );
}

function CategoryBlock({
  category,
  selected,
  onToggle,
  onDice,
  onClear,
}: {
  category: (typeof GROUP_CATALOG)[number];
  selected: string[];
  onToggle: (id: string) => void;
  onDice: () => void;
  onClear: () => void;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-surface-2/40 p-3.5" aria-label={category.title}>
      <div className="mb-3 flex items-start gap-2">
        <span className="text-base" aria-hidden="true">{category.icon}</span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-content">{category.title}</h4>
          <p className="mt-1 text-[11px] leading-relaxed text-content-muted">{category.note}</p>
        </div>
        <span className="flex shrink-0 gap-1">
          {selected.length > 0 && (
            <button type="button" onClick={onClear} className="rounded-lg px-2 py-1 text-[11px] text-content-muted hover:bg-surface-3 hover:text-content">
              Любое
            </button>
          )}
          <button type="button" onClick={onDice} title="Случайный выбор" aria-label={`Случайный выбор: ${category.title}`} className="rounded-lg border border-border-strong bg-surface-2 p-2 text-content-secondary hover:bg-surface-3 hover:text-content">
            <Dices size={14} />
          </button>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {category.options.filter((option) => !option.hint.startsWith("legacy:")).map((option) => {
          const isSelected = selected.includes(option.id);
          const disabled = !isSelected && selected.length >= category.max;
          return (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onToggle(option.id)}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all",
                isSelected
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3",
                disabled && "cursor-not-allowed opacity-40"
              )}
            >
              {isSelected && <Check size={13} />}
              {option.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}
