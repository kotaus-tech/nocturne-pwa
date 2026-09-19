import {
  House,
  MessagesSquare,
  Users,
  Settings,
  UserCircle2,
} from "lucide-react";
import { cn } from "../../utils/cn";

export type TabKey =
  | "home"
  | "chats"
  | "characters"
  | "settings"
  | "persona"
  | "memory"
  | "diary"
  | "lore"
  | "studio"
  | "backup";

interface BottomNavProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

const TABS: {
  key: TabKey;
  label: string;
  icon: typeof House;
}[] = [
  { key: "home", label: "Главная", icon: House },
  { key: "chats", label: "Чаты", icon: MessagesSquare },
  { key: "characters", label: "Персонажи", icon: Users },
  { key: "persona", label: "Персона", icon: UserCircle2 },
  { key: "settings", label: "Настройки", icon: Settings },
];

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav
      aria-label="Мобильная навигация"
      className={cn(
        "fixed inset-x-3 bottom-3 z-40 lg:hidden",
        "rounded-2xl border border-white/[0.08] bg-[#10141d]/85 shadow-[0_16px_36px_rgba(0,0,0,0.65)] backdrop-blur-xl",
        "pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 px-2"
      )}
    >
      <div className="mx-auto grid w-full grid-cols-5 gap-1">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive =
            active === key ||
            (key === "settings" && active === "backup");

          return (
            <button
              key={key}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onChange(key)}
              className={cn(
                "relative flex min-h-[50px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[11px] font-medium transition-all duration-200",
                isActive
                  ? "text-accent bg-accent/10 font-semibold"
                  : "text-content-muted hover:text-content hover:bg-white/[0.04]"
              )}
            >
              <Icon
                size={19}
                strokeWidth={isActive ? 2.2 : 1.7}
                aria-hidden="true"
                className="shrink-0"
              />
              <span className="truncate">{label}</span>
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 h-1 w-1 rounded-full bg-accent"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}