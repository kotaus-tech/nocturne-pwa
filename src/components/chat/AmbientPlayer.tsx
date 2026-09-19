import { useId, useState, useSyncExternalStore } from "react";
import {
  CloudRain,
  Wind,
  Flame,
  Trees,
  VolumeX,
  Volume2,
  Check,
  AlertCircle,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  ambientEngine,
  type AmbientPreset,
  type AmbientSnapshot,
} from "../../utils/ambientEngine";
import { cn } from "../../utils/cn";

const OPTIONS: {
  key: AmbientPreset;
  label: string;
  icon: typeof CloudRain;
}[] = [
  { key: "rain", label: "Дождь", icon: CloudRain },
  { key: "wind", label: "Ветер", icon: Wind },
  { key: "forest", label: "Лес", icon: Trees },
  { key: "fire", label: "Костёр", icon: Flame },
];

interface AmbientPlayerProps {
  /**
   * "full" — развёрнутая панель (используется на главном экране).
   * "compact" — мини-плеер для сайдбара/мобильного меню.
   */
  variant?: "full" | "compact";
}

export function AmbientPlayer({ variant = "full" }: AmbientPlayerProps) {
  const snapshot = useSyncExternalStore(
    ambientEngine.subscribe,
    ambientEngine.getSnapshot,
    ambientEngine.getSnapshot
  );

  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  const handleSelect = (preset: AmbientPreset) => {
    setError(null);

    try {
      ambientEngine.play(preset, snapshot.volume);
    } catch {
      setError(
        "Не удалось включить выбранную атмосферу. Проверьте, разрешён ли звук в браузере."
      );
    }
  };

  const handleToggleOff = () => {
    setError(null);

    try {
      ambientEngine.stop();
    } catch {
      setError("Не удалось остановить воспроизведение.");
    }
  };

  const handleVolumeChange = (next: number) => {
    ambientEngine.setVolume(next);
  };

  const activeOption = OPTIONS.find(
    (option) => option.key === snapshot.preset
  );
  const isPlaying = snapshot.preset !== "off";

  if (variant === "compact") {
    const DisplayIcon = activeOption?.icon ?? CloudRain;
    const title = activeOption ? activeOption.label : "Ночной дождь";
    const subtitle = isPlaying ? "Звучит сейчас" : "Погрузитесь в момент";

    return (
      <div className="rounded-2xl border border-border bg-surface-2">
        <div className="flex items-center gap-3 p-3">
          <span
            aria-hidden="true"
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              isPlaying
                ? "bg-accent/15 text-accent"
                : "bg-surface-3 text-content-muted"
            )}
          >
            <DisplayIcon size={19} strokeWidth={1.7} />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-content">
              {title}
            </span>
            <span className="block truncate text-xs text-content-muted">
              {subtitle}
            </span>
          </span>

          <button
            type="button"
            onClick={() =>
              isPlaying ? handleToggleOff() : handleSelect("rain")
            }
            aria-label={
              isPlaying ? "Остановить атмосферу" : "Включить атмосферу"
            }
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed motion-reduce:transition-none"
          >
            {isPlaying ? (
              <Pause size={14} aria-hidden="true" fill="currentColor" />
            ) : (
              <Play
                size={14}
                aria-hidden="true"
                fill="currentColor"
                className="ml-0.5"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Свернуть выбор атмосферы" : "Выбрать атмосферу"
            }
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-content-muted transition-colors hover:bg-surface-3 hover:text-content motion-reduce:transition-none"
          >
            {expanded ? (
              <ChevronUp size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )}
          </button>
        </div>

        {expanded && (
          <div className="space-y-4 border-t border-border p-3">
            <PresetGrid
              snapshot={snapshot}
              onSelect={handleSelect}
              onOff={handleToggleOff}
              compact
            />
            <VolumeSlider
              id={id}
              value={snapshot.volume}
              onChange={handleVolumeChange}
            />
            {error && <ErrorNote text={error} />}
          </div>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-4 flex items-center gap-2">
        <Volume2
          size={20}
          strokeWidth={1.7}
          aria-hidden="true"
          className="text-accent"
        />
        <h3
          id={`${id}-heading`}
          className="text-base font-semibold text-content"
        >
          Атмосфера
        </h3>
      </div>

      <PresetGrid
        snapshot={snapshot}
        onSelect={handleSelect}
        onOff={handleToggleOff}
      />

      <div className="mt-5">
        <VolumeSlider
          id={id}
          value={snapshot.volume}
          onChange={handleVolumeChange}
        />
      </div>

      <p className="mt-4 text-sm leading-relaxed text-content-muted">
        Звук создаётся на устройстве без загрузки аудиофайлов.
        Атмосфера продолжает звучать при переходах между разделами.
      </p>

      {error && (
        <div className="mt-4">
          <ErrorNote text={error} />
        </div>
      )}
    </section>
  );
}

function PresetGrid({
  snapshot,
  onSelect,
  onOff,
  compact = false,
}: {
  snapshot: AmbientSnapshot;
  onSelect: (preset: AmbientPreset) => void;
  onOff: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Выбор звуковой атмосферы"
      className={cn(
        "grid gap-2",
        compact ? "grid-cols-5" : "grid-cols-2 min-[420px]:grid-cols-5"
      )}
    >
      <button
        type="button"
        aria-pressed={snapshot.preset === "off"}
        onClick={onOff}
        className={cn(
          "relative flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border",
          compact
            ? "min-h-14 px-1 py-1.5 text-[11px]"
            : "min-h-24 px-3 py-4 text-sm",
          "font-medium transition-colors motion-reduce:transition-none",
          snapshot.preset === "off"
            ? "border-accent/60 bg-accent/10 text-accent"
            : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3 hover:text-content"
        )}
      >
        <VolumeX
          size={compact ? 15 : 22}
          strokeWidth={1.6}
          aria-hidden="true"
        />
        <span>Тишина</span>
      </button>

      {OPTIONS.map(({ key, label, icon: Icon }) => {
        const selected = snapshot.preset === key;

        return (
          <button
            key={key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(key)}
            className={cn(
              "relative flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border",
              compact
                ? "min-h-14 px-1 py-1.5 text-[11px]"
                : "min-h-24 px-3 py-4 text-sm",
              "font-medium transition-colors motion-reduce:transition-none",
              selected
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-border-strong bg-surface-2 text-content-secondary hover:bg-surface-3 hover:text-content"
            )}
          >
            <Icon
              size={compact ? 15 : 22}
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <span>{label}</span>

            {selected && (
              <Check
                size={11}
                strokeWidth={2.5}
                aria-hidden="true"
                className="absolute right-1 top-1"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function VolumeSlider({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={`${id}-volume`}
          className="text-sm font-medium text-content-secondary"
        >
          Громкость
        </label>

        <output
          htmlFor={`${id}-volume`}
          className="text-sm font-semibold tabular-nums text-accent"
        >
          {Math.round(value * 100)}%
        </output>
      </div>

      <input
        id={`${id}-volume`}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 block h-11 w-full accent-accent"
      />
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3"
    >
      <AlertCircle
        size={17}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-danger"
      />
      <p className="min-w-0 text-sm leading-relaxed text-danger">{text}</p>
    </div>
  );
}