import { Heart } from "lucide-react";
import type { RelationshipStats } from "../../types";

export function MiniStat({
  value,
  colorVar,
}: {
  value: number;
  colorVar: string;
}) {
  const visualValue = Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0;

  return (
    <div
      aria-hidden="true"
      className="h-1 w-6 overflow-hidden rounded-full bg-white/[0.08] sm:w-7"
    >
      <div
        className="h-full rounded-full transition-all duration-300 ease-out"
        style={{
          width: `${visualValue}%`,
          backgroundColor: colorVar,
        }}
      />
    </div>
  );
}

export function StatsBadge({
  stats,
  onClick,
}: {
  stats: RelationshipStats;
  onClick: () => void;
}) {
  const status = stats.statusTitle || "Знакомство";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Отношения: ${status}. Открыть аналитику`}
      title={`Отношения: ${status}`}
      className="group flex items-center justify-center rounded-xl border border-white/[0.08] bg-[#121622]/85 p-2 shadow-sm backdrop-blur-xl transition-all duration-200 hover:border-white/[0.16] hover:bg-[#161b28] sm:flex-col sm:items-start sm:gap-1 sm:px-3 sm:py-1.5 sm:rounded-2xl shrink-0"
    >
      {/* На мобильных (< sm) отображается только компактная иконка сердца с акцентом */}
      <div className="flex items-center gap-1.5">
        <Heart
          size={16}
          className="shrink-0 text-[var(--relationship-affection)] transition-transform group-hover:scale-110 sm:size-3"
          fill="currentColor"
        />
        <span className="hidden sm:inline max-w-[140px] truncate text-xs font-semibold text-accent group-hover:text-accent-hover">
          {status}
        </span>
      </div>

      {/* На ПК (sm:) отображаются 3 цветных ползунка */}
      <div
        aria-hidden="true"
        className="hidden sm:flex items-center gap-1.5"
      >
        <MiniStat
          value={stats.trust}
          colorVar="var(--relationship-trust)"
        />
        <MiniStat
          value={stats.affection}
          colorVar="var(--relationship-affection)"
        />
        <MiniStat
          value={stats.tension}
          colorVar="var(--relationship-tension)"
        />
      </div>
    </button>
  );
}