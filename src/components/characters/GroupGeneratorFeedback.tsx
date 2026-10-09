import { AlertCircle } from "lucide-react";

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3.5">
      <AlertCircle size={18} className="mt-0.5 shrink-0 text-danger" />
      <p className="text-sm leading-relaxed text-danger [overflow-wrap:anywhere]">{message}</p>
    </div>
  );
}
