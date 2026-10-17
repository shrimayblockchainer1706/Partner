"use client";

// A deliberately tiny toast system (no external library).
// <ToastProvider> wraps the app, and any component can call useToast() to
// show "submitted / success / failure" messages for transactions.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cx } from "@/lib/format";

type ToastKind = "info" | "success" | "error";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastApi = {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

// Hook used by components (and lib/useTx.ts) to push a toast.
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

const STYLES: Record<ToastKind, string> = {
  info: "border-sky-800 bg-sky-950/90 text-sky-100",
  success: "border-emerald-800 bg-emerald-950/90 text-emerald-100",
  error: "border-rose-800 bg-rose-950/90 text-rose-100",
};

const ICONS: Record<ToastKind, string> = {
  info: "…",
  success: "✓",
  error: "!",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, kind, message }]);
      // Auto-dismiss after 6 seconds so the screen never clogs up.
      setTimeout(() => remove(id), 6000);
    },
    [remove],
  );

  // Memoised API so it can safely be used inside useEffect dependency arrays.
  const api = useMemo<ToastApi>(
    () => ({
      info: (message) => push("info", message),
      success: (message) => push("success", message),
      error: (message) => push("error", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur",
              STYLES[toast.kind],
            )}
          >
            <span className="mt-px font-bold">{ICONS[toast.kind]}</span>
            <span className="flex-1 break-words">{toast.message}</span>
            <button
              type="button"
              onClick={() => remove(toast.id)}
              className="text-xs opacity-60 transition hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
