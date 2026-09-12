import { useWorkbench } from "@/store.js";
import { cn } from "@/lib/utils.js";

export function Toast() {
  const toast = useWorkbench((s) => s.toast);
  if (!toast) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[12px] px-4 py-2.5 text-sm shadow-xl animate-rise",
        toast.tone === "error"
          ? "border border-up/40 bg-up/90 text-white backdrop-blur-md"
          : "glass-panel-strong text-ink",
      )}
    >
      {toast.message}
    </div>
  );
}
