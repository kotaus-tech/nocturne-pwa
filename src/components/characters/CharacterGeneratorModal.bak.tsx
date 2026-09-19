import { useState } from "react";
import { Sparkles, Dices, RotateCcw, Loader2, Check } from "lucide-react";
import { Modal } from "../common/Modal";
import { TAG_CATEGORIES, generateAiCharacter } from "../../services/characterGenerator";
import { getApiConfig } from "../../db";
import type { Character } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (generated: Partial<Character>) => void;
}

export function CharacterGeneratorModal({ open, onClose, onApply }: Props) {
  const [activeCat, setActiveCat] = useState("archetype");
  const [gender, setGender] = useState<"female" | "male" | "any">("female");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customIdea, setCustomIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  const handleRandomMix = () => {
    const genders: ("female" | "male" | "any")[] = ["female", "male", "female"];
    setGender(genders[Math.floor(Math.random() * genders.length)]);

    const chosen: string[] = [];
    const catsToPick = ["archetype", "setting", "dynamic", "tone", "style"];
    catsToPick.forEach((catId) => {
      const cat = TAG_CATEGORIES.find((c) => c.id === catId);
      if (cat && cat.tags.length > 0) {
        const randTag = cat.tags[Math.floor(Math.random() * cat.tags.length)];
        chosen.push(randTag.name);
      }
    });
    setSelectedTags(chosen);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiConfig = await getApiConfig();
      if (!apiConfig || !apiConfig.apiKey) {
        throw new Error("Не указан API-ключ в Настройках приложения!");
      }

      const generated = await generateAiCharacter(apiConfig, gender, selectedTags, customIdea);
      onApply(generated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сгенерировать персонажа.");
    } finally {
      setLoading(false);
    }
  };

  const currentCategory = TAG_CATEGORIES.find((c) => c.id === activeCat) || TAG_CATEGORIES[0];

  return (
    <Modal open={open} onClose={onClose} variant="center" title="✨ AI Генератор персонажа">
      <div className="space-y-4 text-xs">
        {/* Адаптивный выбор пола: ровная 3-колоночная сетка */}
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-2 p-2.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-zinc-300">Пол персонажа:</span>
          <div className="grid w-full grid-cols-3 gap-1.5 sm:w-auto sm:flex">
            <button
              type="button"
              onClick={() => setGender("female")}
              className={`flex items-center justify-center rounded-xl px-2.5 py-1.5 text-center text-[11.5px] transition-all ${
                gender === "female"
                  ? "bg-neon-pink font-bold text-black shadow-md shadow-neon-pink/20"
                  : "bg-surface-3 font-medium text-zinc-400 hover:text-white"
              }`}
            >
              Девушка ♀
            </button>
            <button
              type="button"
              onClick={() => setGender("male")}
              className={`flex items-center justify-center rounded-xl px-2.5 py-1.5 text-center text-[11.5px] transition-all ${
                gender === "male"
                  ? "bg-neon-cyan font-bold text-black shadow-md shadow-neon-cyan/20"
                  : "bg-surface-3 font-medium text-zinc-400 hover:text-white"
              }`}
            >
              Парень ♂
            </button>
            <button
              type="button"
              onClick={() => setGender("any")}
              className={`flex items-center justify-center rounded-xl px-2.5 py-1.5 text-center text-[11.5px] transition-all ${
                gender === "any"
                  ? "bg-neon-purple font-bold text-white shadow-md shadow-neon-purple/20"
                  : "bg-surface-3 font-medium text-zinc-400 hover:text-white"
              }`}
            >
              Любой ⚧
            </button>
          </div>
        </div>

        {/* Навигация по категориям тегов */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {TAG_CATEGORIES.map((cat) => {
            const isCatActive = cat.id === activeCat;
            const countInCat = cat.tags.filter((t) => selectedTags.includes(t.name)).length;

            return (
              <button
                type="button"
                key={cat.id}
                onClick={() => setActiveCat(cat.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 font-semibold transition-all active:scale-95 ${
                  isCatActive
                    ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
                    : "border-border bg-surface-2 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.title}</span>
                {countInCat > 0 && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neon-cyan text-[9px] font-bold text-black">
                    {countInCat}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Сетка двухстрочных карточек тегов */}
        <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {currentCategory.tags.map((tag) => {
              const isSelected = selectedTags.includes(tag.name);

              return (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => toggleTag(tag.name)}
                  className={`flex flex-col items-start rounded-2xl border p-2.5 text-left transition-all active:scale-[0.98] ${
                    isSelected
                      ? "border-neon-cyan/80 bg-neon-cyan/10 shadow-[0_0_10px_rgba(0,240,255,0.15)]"
                      : "border-border bg-surface-2 hover:border-white/20 hover:bg-surface-3"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span
                      className={`text-xs font-bold ${
                        isSelected ? "text-neon-cyan" : "text-zinc-100"
                      }`}
                    >
                      {tag.name}
                    </span>
                    {isSelected && <Check size={14} className="text-neon-cyan" />}
                  </div>
                  <span className="mt-1 text-[11px] leading-snug text-zinc-400">
                    {tag.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Своя задумка / свободная мысль */}
        <div>
          <label className="mb-1 block font-semibold text-zinc-300">
            Своя идея или деталь (опционально):
          </label>
          <input
            className="input-field text-xs"
            placeholder="Например: играет на бас-гитаре, белые волосы, шрам на щеке..."
            value={customIdea}
            onChange={(e) => setCustomIdea(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-neon-red/40 bg-neon-red/10 p-2.5 text-neon-red">
            {error}
          </div>
        )}

        {/* Панель кнопок внизу */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleRandomMix}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-3 px-3 py-2.5 font-semibold text-zinc-300 hover:border-neon-purple/50 hover:text-white active:scale-95"
            title="Случайный набор тегов"
          >
            <Dices size={16} className="text-neon-purple" />
            <span className="hidden sm:inline">Случайный микс</span>
          </button>

          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              disabled={loading}
              className="icon-btn h-10 w-10 border border-border text-zinc-500 hover:text-neon-red"
              title="Сбросить выбранные теги"
            >
              <RotateCcw size={14} />
            </button>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-neon-purple via-neon-cyan to-neon-pink py-2.5 text-sm font-bold text-black shadow-lg shadow-neon-cyan/20 transition-all active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Генерирую персонажа...</span>
              </>
            ) : (
              <>
                <Sparkles size={16} />
                <span>Сгенерировать ({selectedTags.length} тегов)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}