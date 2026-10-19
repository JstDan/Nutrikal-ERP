"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/app/actions";

type Props = {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  submitLabel: string;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
};

/** Form wrapper: pending state, database errors and success messages. */
export function ActionForm({ action, submitLabel, children, className = "", resetOnSuccess = true }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={`flex flex-col gap-4 ${className}`}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : submitLabel}
        </button>
        <p role="status" aria-live="polite" className="m-0 text-sm">
          {state.error && <span className="font-semibold text-red-ink">{state.error}</span>}
          {state.ok && state.message && <span className="font-semibold text-green-ink">{state.message}</span>}
        </p>
      </div>
    </form>
  );
}
