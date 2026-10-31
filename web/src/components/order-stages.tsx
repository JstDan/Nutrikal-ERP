import type { Dict } from "@/lib/i18n/en";

const KEYS = ["paid", "planned", "produced", "ready", "dispatched", "invoiced", "closed"] as const;
export type OrderStage = (typeof KEYS)[number];

/** Where the order stands: done = ink, current = green, ahead = grey. done lists the stages reached. */
export function OrderStages({ done, t }: { done: Record<OrderStage, boolean>; t: Dict }) {
  const S = t.orders.stages;
  const current = KEYS.findIndex((k) => !done[k]);
  const at = current < 0 ? KEYS.length : current;
  return (
    <ol className="m-0 grid list-none grid-cols-7 gap-1 p-0" aria-label={`${S.label}: ${at < KEYS.length ? S[KEYS[at]] : S.closed} (${Math.min(at + 1, KEYS.length)}/${KEYS.length})`}>
      {KEYS.map((k, i) => (
        <li key={k} className="flex min-w-0 flex-col gap-1.5">
          <span className={`h-1.5 rounded-sm ${i < at ? "bg-ink" : i === at ? "bg-green" : "bg-mist"}`} />
          <span className={`hide-sm truncate text-[11px] ${i === at ? "font-bold text-ink" : "text-ink-2"}`}>{S[k]}</span>
        </li>
      ))}
    </ol>
  );
}
