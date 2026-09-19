import {
  HeartHandshake,
  Shield,
  Heart,
  Sparkles,
  Flame,
  Swords,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Modal } from "../common/Modal";
import { Avatar } from "../common/Avatar";
import type { RelationshipStats } from "../../types";

interface StatsParticipant {
  id: string;
  name: string;
  avatarUrl?: string;
  stats: RelationshipStats;
}

interface StatsPanelProps {
  open: boolean;
  onClose: () => void;
  stats: RelationshipStats;
  /** Групповая сцена: шкалы отношений с каждым участником. */
  participants?: StatsParticipant[];
  activeParticipantId?: string;
}

interface StatConfig {
  key: keyof RelationshipStats;
  label: string;
  icon: typeof Shield;
  color: string;
  glow: string;
  description: string;
}

const STAT_CONFIGS: StatConfig[] = [
  {
    key: "trust",
    label: "Доверие",
    icon: Shield,
    color: "var(--relationship-trust)",
    glow: "rgba(56, 189, 248, 0.35)",
    description: "Насколько свободно персонаж готов вам открываться.",
  },
  {
    key: "affection",
    label: "Симпатия",
    icon: Heart,
    color: "var(--relationship-affection)",
    glow: "rgba(244, 114, 182, 0.35)",
    description: "Теплота и интерес, возникшие между вами.",
  },
  {
    key: "closeness",
    label: "Близость",
    icon: Sparkles,
    color: "var(--relationship-closeness)",
    glow: "rgba(167, 139, 250, 0.35)",
    description: "Общий опыт и ощущение взаимного понимания.",
  },
  {
    key: "tension",
    label: "Напряжение",
    icon: Flame,
    color: "var(--relationship-tension)",
    glow: "rgba(251, 191, 36, 0.35)",
    description: "Неопределённость и эмоциональная интенсивность сцены.",
  },
  {
    key: "conflict",
    label: "Конфликт",
    icon: Swords,
    color: "var(--relationship-conflict)",
    glow: "rgba(248, 113, 113, 0.35)",
    description: "Противоречия и нерешённые разногласия.",
  },
];

export function StatsPanel({
  open,
  onClose,
  stats,
  participants,
  activeParticipantId,
}: StatsPanelProps) {
  const reducedMotion = useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const roster = participants && participants.length > 1 ? participants : null;
  const selected =
    (roster && roster.find((item) => item.id === selectedId)) ||
    roster?.find((item) => item.id === activeParticipantId) ||
    roster?.[0];
  const shownStats = selected ? selected.stats : stats;
  const customStats = Object.entries(shownStats.customStats ?? {});

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      variant="center"
      title="Аналитика отношений"
    >
      <div className="space-y-4">
        {roster && (
          <div
            role="group"
            aria-label="Участники сцены"
            className="flex gap-2 overflow-x-auto overscroll-contain pb-1"
          >
            {roster.map((item) => {
              const isActive = selected?.id === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={isActive}
                  className={`flex min-w-0 shrink-0 items-center gap-2 rounded-2xl border px-2.5 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? "border-accent/50 bg-accent/15 text-accent"
                      : "border-white/[0.08] bg-[#121622]/80 text-content-secondary hover:border-white/[0.16] hover:text-content"
                  }`}
                >
                  <Avatar src={item.avatarUrl} name={item.name} size={22} />
                  <span className="max-w-[9rem] truncate">{item.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Карточка текущего статуса с корректным переносом слов */}
        <div className="flex items-start gap-3.5 rounded-2xl border border-white/[0.08] bg-[#121622]/90 p-3.5 backdrop-blur-xl shadow-lg">
          <div
            aria-hidden="true"
            className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-accent/15 text-accent shadow-[0_0_24px_rgba(139,92,246,0.25)]"
          >
            <HeartHandshake size={22} strokeWidth={1.8} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent/90">
              Динамика вашей истории
            </p>
            <h2 className="novel-font mt-0.5 text-base sm:text-lg font-bold tracking-tight text-zinc-100 leading-snug break-words whitespace-normal">
              {shownStats.statusTitle || "Осторожное знакомство"}
            </h2>
            {selected && (
              <p className="mt-0.5 truncate text-[11px] text-content-muted">
                Отношения с {selected.name}
              </p>
            )}
          </div>
        </div>

        {/* Список всех 5 шкал отношений */}
        <div className="space-y-3.5">
          {STAT_CONFIGS.map((cfg, index) => {
            const rawValue = shownStats[cfg.key];
            const value = typeof rawValue === "number" ? rawValue : 0;
            const percentage = Math.min(100, Math.max(0, value));
            const Icon = cfg.icon;

            return (
              <div key={cfg.key} className="group min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-5.5 w-5.5 items-center justify-center rounded-lg bg-white/[0.04]"
                      style={{ color: cfg.color }}
                    >
                      <Icon size={14} strokeWidth={2} />
                    </span>
                    <span className="text-xs sm:text-sm font-semibold text-zinc-200">
                      {cfg.label}
                    </span>
                  </div>

                  <div className="text-xs sm:text-sm tabular-nums">
                    <span className="font-bold" style={{ color: cfg.color }}>
                      {value}
                    </span>
                    <span className="ml-1 text-[11px] text-content-muted">
                      / 100
                    </span>
                  </div>
                </div>

                <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      backgroundColor: cfg.color,
                      boxShadow: `0 0 10px ${cfg.glow}`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.85,
                      delay: reducedMotion ? 0 : index * 0.06,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </div>

                <p className="text-[11px] leading-tight text-content-muted line-clamp-1 sm:line-clamp-none">
                  {cfg.description}
                </p>
              </div>
            );
          })}
        </div>

        {customStats.length > 0 && (
          <section className="space-y-2 border-t border-white/[0.08] pt-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-content-secondary">
              <SlidersHorizontal size={13} className="text-accent" />
              <span>Дополнительные показатели</span>
            </h3>

            <div className="space-y-2.5">
              {customStats.map(([label, rawVal], idx) => {
                const val = typeof rawVal === "number" ? rawVal : 0;
                const percentage = Math.min(100, Math.max(0, val));

                return (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-300 truncate">{label}</span>
                      <span className="font-bold tabular-nums text-success">{val} / 100</span>
                    </div>

                    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <motion.div
                        className="h-full rounded-full bg-success"
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{
                          duration: reducedMotion ? 0 : 0.85,
                          delay: reducedMotion ? 0 : idx * 0.06,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}