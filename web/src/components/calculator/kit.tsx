"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import type { Dict } from "@/lib/i18n/en";
import { formatMoney, formatNumber, type Locale } from "@/lib/i18n";
import { evaluateExpression, hasOperator } from "@/lib/calculator/expression";
import { sanitizeDecimalInput } from "@/lib/calculator/numbers";

// ------------------------------------------------------------ text + numbers
export type CalcDict = Dict["calc"];

type Text = {
  t: CalcDict;
  locale: Locale;
  eur: (n: number, decimals?: number) => string;
  num: (n: number, maxFrac?: number, minFrac?: number) => string;
  pct: (n: number, decimals?: number) => string;
};

const TextContext = createContext<Text | null>(null);

export function CalcTextProvider({ t, locale, children }: { t: CalcDict; locale: Locale; children: ReactNode }) {
  const value = useMemo<Text>(
    () => ({
      t,
      locale,
      eur: (n, decimals = 2) => formatMoney(locale, n, "EUR", decimals),
      num: (n, maxFrac = 2, minFrac = 0) => formatNumber(locale, n, maxFrac, minFrac),
      pct: (n, decimals = 1) => `${formatNumber(locale, n, decimals, decimals)} %`,
    }),
    [t, locale],
  );
  return <TextContext.Provider value={value}>{children}</TextContext.Provider>;
}

export function useCalcText(): Text {
  const ctx = useContext(TextContext);
  if (!ctx) throw new Error("useCalcText must be used inside CalcTextProvider");
  return ctx;
}

// ------------------------------------------------------------------ layout
export function Section({ step, title, id, required, action, children }: {
  step?: number; title: string; id?: string; required?: boolean; action?: ReactNode; children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className="card flex min-w-0 scroll-mt-6 flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        {step !== undefined && (
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-white">
            {step}
          </span>
        )}
        <h2 id={headingId} className="m-0 min-w-0 flex-1 text-lg font-bold break-words">
          {title}
          {required && <RequiredMark />}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="label m-0">{children}</h3>;
}

/** A label / value line used in summaries. */
export function InfoLine({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-mist py-2 text-sm last:border-0">
      <span className="min-w-0 break-words text-ink-2">{label}</span>
      {/* Long values (product names) wrap instead of widening the page */}
      <span className={`min-w-0 text-right break-words tabular-nums ${strong ? "font-bold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

export function SummaryBox({ children }: { children: ReactNode }) {
  return <div className="rounded-sm bg-canvas px-4 py-1">{children}</div>;
}

export function RequiredMark() {
  return <span aria-hidden="true" className="ml-1 text-red">*</span>;
}

type Tone = "info" | "warning" | "error" | "success";
const noticeTone: Record<Tone, string> = {
  info: "border-line bg-neutral-tint text-ink",
  warning: "border-amber-line bg-amber-tint text-amber-ink",
  error: "border-red-line bg-red-tint text-red-ink",
  success: "border-green-line bg-green-tint text-green-ink",
};

export function Notice({ tone = "info", action, children }: { tone?: Tone; action?: ReactNode; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`flex flex-wrap items-center gap-3 rounded-sm border px-4 py-3 text-sm ${noticeTone[tone]}`}>
      <div className="min-w-0 flex-[1_1_240px] break-words">{children}</div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------ fields
export function Field({ label, htmlFor, required, error, hint, className = "", children }: {
  label: ReactNode; htmlFor: string; required?: boolean; error?: string; hint?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor} className={`text-[13px] font-semibold ${required ? "text-red-ink" : "text-ink"}`}>
        {label}
        {required && <RequiredMark />}
      </label>
      {children}
      {error ? (
        <small id={`${htmlFor}-msg`} className="text-xs font-semibold text-red-ink">{error}</small>
      ) : hint ? (
        <small id={`${htmlFor}-msg`} className="text-xs text-ink-2">{hint}</small>
      ) : null}
    </div>
  );
}

/** Class for inputs; red border when invalid. */
export const inputClass = (invalid?: boolean) => `input ${invalid ? "border-red!" : ""}`;

const EXPRESSION_CHARS = /[^\d.,+\-*/x×÷%()\s]/gi;

type NumberProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  /** Whole numbers only. */
  integer?: boolean;
  suffix?: string;
  invalid?: boolean;
  /** Accept arithmetic like "3260-5%"; Enter (or leaving the field) replaces it with the result. */
  calculator?: boolean;
};

/** Text input for numbers: right-aligned, accepts comma or dot as decimal separator. */
export function NumberField({ value, onChange, integer, suffix, invalid, calculator, onKeyDown, onBlur, className = "", ...rest }: NumberProps) {
  const sanitize = (input: string) =>
    calculator && hasOperator(input) ? input.replace(EXPRESSION_CHARS, "") : sanitizeDecimalInput(input, !integer);

  const evaluate = () => {
    if (!calculator || !hasOperator(value)) return;
    const result = evaluateExpression(value);
    if (result === null) return;
    onChange(String(integer ? Math.round(result) : Math.round(result * 100) / 100));
  };

  return (
    <div className="relative min-w-0">
      <input
        {...rest}
        type="text"
        inputMode={calculator ? "text" : integer ? "numeric" : "decimal"}
        autoComplete="off"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(sanitize(e.target.value))}
        onKeyDown={(e) => {
          if (calculator && e.key === "Enter") {
            e.preventDefault();
            evaluate();
          }
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          evaluate();
          onBlur?.(e);
        }}
        className={`${inputClass(invalid)} text-right tabular-nums ${suffix ? "pr-10!" : ""} ${className}`}
      />
      {suffix && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-2">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Checkbox styled as a toggle row (≥ 44 px tall). */
export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-ink" />
      <span>{children}</span>
    </label>
  );
}

/** Square 44 px remove button with a visible ✕. */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-sm border border-line-strong bg-white text-base text-ink-2 hover:border-red hover:text-red-ink"
    >
      <span aria-hidden="true">✕</span>
    </button>
  );
}

// ------------------------------------------------------------------- toast
export type ToastMsg = { tone: "success" | "error"; message: string } | null;

export function useToast() {
  const [toast, setToast] = useState<ToastMsg>(null);
  const show = useCallback((tone: "success" | "error", message: string) => setToast({ tone, message }), []);
  const clear = useCallback(() => setToast(null), []);
  return { toast, show, clear };
}

export function Toast({ toast, onClose, closeLabel }: { toast: ToastMsg; onClose: () => void; closeLabel: string }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onClose, toast.tone === "error" ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--tabbar)+16px)] z-50 flex justify-center">
      {toast && (
        <div
          className={`pointer-events-auto flex max-w-[560px] min-w-0 items-center gap-3 rounded-sm px-4 py-2 text-sm font-semibold text-white shadow-lg ${
            toast.tone === "error" ? "bg-red-ink" : "bg-ink"
          }`}
        >
          {toast.tone === "success" && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-green" />}
          <span className="min-w-0 break-words">{toast.message}</span>
          <button type="button" onClick={onClose} aria-label={closeLabel} className="grid h-11 w-11 shrink-0 place-items-center text-white">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
    </div>
  );
}
