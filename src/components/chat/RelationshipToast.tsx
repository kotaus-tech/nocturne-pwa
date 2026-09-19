import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Sparkles,
  Flame,
  ShieldCheck,
  Eye,
  Heart,
} from "lucide-react";
import { cn } from "../../utils/cn";

export interface ToastData {
  title: string;
  type: "feeling" | "affection" | "trust" | "tension" | "status";
}

interface Props {
  toast: ToastData | null;
  className?: string;
}

const APPEARANCES = {
  feeling: {
    icon: Eye,
    color: "text-accent",
    background: "bg-accent/10",
  },
  affection: {
    icon: Heart,
    color: "text-[var(--relationship-affection)]",
    background: "bg-[var(--relationship-affection)]/10",
  },
  trust: {
    icon: ShieldCheck,
    color: "text-info",
    background: "bg-info/10",
  },
  tension: {
    icon: Flame,
    color: "text-warning",
    background: "bg-warning/10",
  },
  status: {
    icon: Sparkles,
    color: "text-accent",
    background: "bg-accent/10",
  },
};

export function RelationshipToast({
  toast,
  className,
}: Props) {
  const reducedMotion = useReducedMotion();
  const appearance = APPEARANCES[toast?.type ?? "status"];
  const Icon = appearance.icon;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4",
        className
      )}
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="w-full max-w-md"
      >
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={
                reducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: -6 }
              }
              animate={{ opacity: 1, y: 0 }}
              exit={
                reducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: -4 }
              }
              transition={{
                duration: reducedMotion ? 0 : 0.18,
                ease: [0.2, 0, 0, 1],
              }}
              className="flex items-start gap-3 rounded-2xl border border-border-strong bg-surface-2 px-4 py-3 shadow-[var(--shadow-floating)]"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  appearance.color,
                  appearance.background
                )}
              >
                <Icon size={17} strokeWidth={1.8} />
              </span>

              <p className="min-w-0 self-center text-sm font-medium leading-relaxed text-content [overflow-wrap:anywhere]">
                {toast.title}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}