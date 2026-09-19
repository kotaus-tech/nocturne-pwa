import {
  BrainCircuit,
  ShieldAlert,
  Sparkles,
  Coffee,
  Crosshair,
  Zap,
  Check,
} from "lucide-react";
import { Modal } from "../common/Modal";
import type { ThoughtMode } from "../../types";
import { cn } from "../../utils/cn";

interface ThoughtModalProps {
  open: boolean;
  onClose: () => void;
  thought: string;
  characterName: string;
  thoughtMode?: ThoughtMode;
  onChangeThoughtMode?: (mode: ThoughtMode) => void;
}

const THOUGHT_MODES: {
  key: ThoughtMode;
  label: string;
  desc: string;
  icon: typeof ShieldAlert;
}[] = [
  {
    key: "censor",
    label: "Цензор",
    desc: "То, что ни за что не скажет вслух",
    icon: ShieldAlert,
  },
  {
    key: "counterpoint",
    label: "Контрапункт",
    desc: "Фасад против подтекста",
    icon: Sparkles,
  },
  {
    key: "stream",
    label: "Поток сознания",
    desc: "Бытовой реализм и заземление",
    icon: Coffee,
  },
  {
    key: "tactical",
    label: "Расчёт",
    desc: "Анализ мотивов и поиск слабостей",
    icon: Crosshair,
  },
  {
    key: "instinct",
    label: "Инстинкты",
    desc: "Физиология тела и адреналин",
    icon: Zap,
  },
];

export function ThoughtModal({
  open,
  onClose,
  thought,
  characterName,
  thoughtMode = "censor",
  onChangeThoughtMode,
}: ThoughtModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Тайная мысль"
      size="md"
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"
          >
            <BrainCircuit size={22} strokeWidth={1.6} />
          </div>

          <h3 className="min-w-0 text-base font-medium leading-snug text-content-secondary [overflow-wrap:anywhere]">
            {characterName}
          </h3>
        </div>

        {thought.trim() ? (
          <blockquote className="m-0 border-l-2 border-accent/35 pl-4 sm:pl-5">
            <p className="novel-font whitespace-pre-wrap text-lg leading-[1.8] text-content [overflow-wrap:anywhere]">
              {thought}
            </p>
          </blockquote>
        ) : (
          <p className="py-2 text-base leading-relaxed text-content-muted">
            Для этого сообщения мысль не сохранена.
          </p>
        )}

        {/* Быстрое переключение вектора следующей мысли прямо из модалки */}
        {onChangeThoughtMode && (
          <div className="border-t border-white/[0.08] pt-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wider text-content-muted">
                Вектор следующей мысли
              </span>
              <span className="font-bold text-accent">
                {THOUGHT_MODES.find((m) => m.key === thoughtMode)?.label}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {THOUGHT_MODES.map((m) => {
                const isSelected = thoughtMode === m.key;
                const Icon = m.icon;

                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => onChangeThoughtMode(m.key)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-2 text-left transition-all",
                      isSelected
                        ? "border-accent bg-accent/20 text-accent font-semibold shadow-sm"
                        : "border-white/[0.06] bg-surface-2 text-content-muted hover:bg-surface-3 hover:text-content"
                    )}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="truncate text-xs">{m.label}</span>
                    {isSelected && <Check size={12} className="ml-auto shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}