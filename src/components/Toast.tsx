import { CheckCircle2 } from "lucide-react";

interface ToastProps {
  message: string;
}

export function Toast({ message }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-xl lg:bottom-6"
    >
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
      <span>{message}</span>
    </div>
  );
}
