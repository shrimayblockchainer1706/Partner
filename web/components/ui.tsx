// Reusable presentational pieces so every page looks consistent.
// These are plain components (no hooks), so they can be used anywhere.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/format";
import { statusLabel } from "@/lib/types";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-sky-500 text-white hover:bg-sky-400",
  secondary: "border border-slate-700 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800",
  danger: "bg-rose-600 text-white hover:bg-rose-500",
  ghost: "text-slate-300 hover:bg-slate-800 hover:text-white",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = "primary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...props} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-slate-800 bg-slate-900/60 p-5", className)}>{children}</div>;
}

// Colours match the CircleStatus enum in the contract: Open / Active / Completed.
const STATUS_STYLES: Record<number, string> = {
  0: "border-sky-700 bg-sky-950 text-sky-300",
  1: "border-amber-700 bg-amber-950 text-amber-300",
  2: "border-emerald-700 bg-emerald-950 text-emerald-300",
};

export function StatusBadge({ status }: { status: number }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "border-slate-700 bg-slate-900 text-slate-300",
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-100">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
      <p className="text-base font-medium text-slate-200">{title}</p>
      {description ? <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-900 bg-rose-950/40 px-6 py-8 text-center">
      <p className="text-sm font-medium text-rose-200">{message}</p>
      {onRetry ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
