import type { Dict } from "@/lib/i18n/en";

const KEYS = ["inquiry", "formulation", "offer", "order", "materials", "production", "qc", "dispatch"] as const;

/** 8-step lifecycle bar: done = ink, current = green, ahead = grey. */
export function StageTracker({ stage, t }: { stage: number; t: Dict }) {
  const current = KEYS[Math.min(stage, 7)];
  return (
    <ol
      className="m-0 grid list-none grid-cols-8 gap-1 p-0"
      aria-label={`${t.projects.status}: ${stage >= 8 ? t.enums.projectStatus.completed : t.projects.stages[current]} (${Math.min(stage + 1, 8)}/8)`}
    >
      {KEYS.map((k, i) => {
        const state = i < stage ? "done" : i === stage ? "current" : "todo";
        return (
          <li key={k} className="flex min-w-0 flex-col gap-1.5">
            <span className={`h-1.5 rounded-sm ${state === "done" ? "bg-ink" : state === "current" ? "bg-green" : "bg-mist"}`} />
            <span className={`hide-sm truncate text-[11px] ${state === "current" ? "font-bold text-ink" : "text-ink-2"}`}>{t.projects.stages[k]}</span>
          </li>
        );
      })}
    </ol>
  );
}
