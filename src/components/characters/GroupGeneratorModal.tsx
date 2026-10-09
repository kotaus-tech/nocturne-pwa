import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "../common/Modal";
import { getApiConfig } from "../../db";
import { isLocalEndpoint } from "../../services/apiClient";
import { GROUP_AGE_BANDS, GROUP_CATALOG, presetEnablesAdult, presetSelections } from "../../services/groupGenerator/catalog";
import { generateGroupBlueprint, regenerateGroupSection } from "../../services/groupGenerator/generator";
import type {
  GeneratedGroup,
  GroupGenerationResult,
  GroupGender,
  GroupPreferences,
  GroupRegenerationSection,
  GroupUniqueness,
} from "../../services/groupGenerator/types";
import { GroupGeneratorResult } from "./GroupGeneratorResult";
import { GroupGeneratorSettings } from "./GroupGeneratorSettings";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Сохраняет карточки и сразу создаёт общую ветку с опенингом. */
  onApplyGroup: (group: GeneratedGroup) => void | Promise<void>;
}

type Step = "settings" | "working" | "result";

function emptyPreferences(): GroupPreferences {
  return {
    generationVersion: 2,
    size: 3,
    gender: "any",
    ageBandId: "adult_mixed",
    customIdea: "",
    uniqueness: 1,
    relationIntensity: "balanced",
    adultEnabled: false,
    presetId: "preset_none",
    selections: {},
  };
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function GroupGeneratorModal({ open, onClose, onApplyGroup }: Props) {
  const [step, setStep] = useState<Step>("settings");
  const [prefs, setPrefs] = useState<GroupPreferences>(() => emptyPreferences());
  const [result, setResult] = useState<GroupGenerationResult | null>(null);
  const [workingLabel, setWorkingLabel] = useState("Собираем ансамбль…");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("settings");
    setError(null);
    setSaving(false);
  }, [open]);

  const setPreference = <K extends keyof GroupPreferences>(key: K, value: GroupPreferences[K]) => {
    setPrefs((previous) => {
      if (key === "adultEnabled" && value === false) {
        return {
          ...previous,
          adultEnabled: false,
          selections: { ...previous.selections, groupChemistry: [] },
        };
      }
      return { ...previous, [key]: value };
    });
  };

  const toggleOption = (categoryId: string, optionId: string, max: number) => {
    setPrefs((previous) => {
      const current = previous.selections[categoryId] ?? [];
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : max === 1
          ? [optionId]
          : current.length >= max
            ? current
            : [...current, optionId];
      return {
        ...previous,
        presetId: "preset_none",
        selections: { ...previous.selections, [categoryId]: next },
      };
    });
  };

  const randomizeCategory = (categoryId: string, options: { id: string }[]) => {
    const option = pickRandom(options);
    setPrefs((previous) => ({
      ...previous,
      presetId: "preset_none",
      selections: { ...previous.selections, [categoryId]: [option.id] },
    }));
  };

  const applyPreset = (presetId: string) => {
    setPrefs((previous) => ({
      ...previous,
      presetId,
      adultEnabled: presetEnablesAdult(presetId) || previous.adultEnabled,
      selections: presetSelections(presetId),
    }));
  };

  const clearCategory = (categoryId: string) => {
    setPrefs((previous) => ({
      ...previous,
      presetId: "preset_none",
      selections: { ...previous.selections, [categoryId]: [] },
    }));
  };

  const surprise = () => {
    setPrefs((previous) => {
      const selections: Record<string, string[]> = {};
      for (const category of GROUP_CATALOG) {
        if (category.legacy || (category.adultOnly && !previous.adultEnabled)) continue;
        if (Math.random() < 0.25) continue;
        const options = category.options.filter((option) => !option.hint.startsWith("legacy:"));
        const amount = category.max > 1 && Math.random() > 0.65 ? 2 : 1;
        const shuffled = [...options].sort(() => Math.random() - 0.5);
        selections[category.id] = shuffled.slice(0, amount).map((option) => option.id);
      }
      return {
        ...previous,
        gender: pickRandom<GroupGender>(["any", "female", "male", "mixed"]),
        ageBandId: pickRandom(GROUP_AGE_BANDS).id,
        uniqueness: pickRandom<GroupUniqueness>([1, 2, 2, 3]),
        selections,
        presetId: "preset_none",
      };
    });
  };

  const handleGenerate = async () => {
    if (step === "working") return;
    setError(null);
    setStep("working");
    setWorkingLabel("Собираем ансамбль… Это может занять до минуты.");

    try {
      const apiConfig = await getApiConfig();
      if (!apiConfig || (!apiConfig.apiKey && !isLocalEndpoint(apiConfig.baseUrl))) {
        throw new Error("Не указан API-ключ в Настройках приложения!");
      }
      const generated = await generateGroupBlueprint(apiConfig, prefs);
      setResult(generated);
      setStep("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сгенерировать группу.");
      setStep("settings");
    }
  };

  const handleRegenerate = async (
    section: GroupRegenerationSection,
    label: string,
    targetKey?: string
  ) => {
    if (!result) return;
    setError(null);
    setWorkingLabel(`${label}…`);
    setStep("working");

    try {
      const apiConfig = await getApiConfig();
      if (!apiConfig || (!apiConfig.apiKey && !isLocalEndpoint(apiConfig.baseUrl))) {
        throw new Error("Не указан API-ключ в Настройках приложения!");
      }
      const next = await regenerateGroupSection(apiConfig, prefs, result.blueprint, section, targetKey);
      setResult(next);
      setStep("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось перегенерировать часть группы.");
      setStep("result");
    }
  };

  const handleSave = async () => {
    if (!result || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onApplyGroup(result.group);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать групповую ветку.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      size="lg"
      title="Group DNA V2 — генератор групповой сцены"
    >
      {step === "working" && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <Loader2 size={36} className="animate-spin text-accent" aria-hidden="true" />
          <p className="text-base font-semibold text-zinc-100">{workingLabel}</p>
          <p className="max-w-lg text-sm leading-relaxed text-content-secondary">
            Модель строит не набор отдельных карточек, а ансамбль: общее место,
            автономные цели, разные голоса, направленные связи и вход игрока в сцену.
          </p>
        </div>
      )}

      {step === "settings" && (
        <GroupGeneratorSettings
          prefs={prefs}
          setPreference={setPreference}
          onToggleOption={toggleOption}
          onRandomizeCategory={randomizeCategory}
          onClearCategory={clearCategory}
          onApplyPreset={applyPreset}
          onSurprise={surprise}
          onGenerate={() => void handleGenerate()}
          error={error}
        />
      )}

      {step === "result" && result && (
        <GroupGeneratorResult
          result={result}
          error={error}
          saving={saving}
          onRegenerate={handleRegenerate}
          onSave={() => void handleSave()}
          onBack={() => setStep("settings")}
          onAnother={() => {
            setResult(null);
            setError(null);
            setStep("settings");
          }}
        />
      )}
    </Modal>
  );
}
