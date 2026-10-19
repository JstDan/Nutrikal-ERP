import type { ReactNode } from "react";

export type Tone = "green" | "amber" | "red" | "neutral";

const toneClass: Record<Tone, string> = {
  green: "bg-green-tint text-green-ink",
  amber: "bg-amber-tint text-amber-ink",
  red: "bg-red-tint text-red-ink",
  neutral: "bg-neutral-tint text-ink",
};

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  const c = { green: "bg-green", amber: "bg-amber", red: "bg-red", neutral: "bg-[#8a93a3]" }[tone];
  return <span aria-hidden="true" className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${c}`} />;
}

export function PageHeader({ title, subtitle, actions, crumb }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {crumb && <div className="text-[13px] text-ink-2">{crumb}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[28px] leading-tight font-extrabold tracking-[0.6px] break-words">{title}</h1>
          {subtitle && <p className="mt-1 mb-0 text-sm text-ink-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, action, children, className = "", id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={`card flex min-w-0 flex-col gap-4 p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title && <h2 id={id} className="m-0 text-lg font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 text-sm text-ink-2">{children}</p>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-xs font-semibold tracking-[2px] uppercase no-underline text-ink hover:text-black">
      {children}
    </a>
  );
}
