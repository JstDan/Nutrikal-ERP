import { fmt, formatNumber, formatPrice, getDict } from "@/lib/i18n";
import type { ContractRow } from "@/lib/contract-model";

/** The contract as a page: the clauses ("# " a clause, "- " a bullet) and Schedule A; wraps on any width. */
export function ContractBody({ k }: { k: Pick<ContractRow, "body" | "schedule" | "locale"> }) {
  const l = k.locale;
  const P = getDict(l).contract.pdf;
  const s = k.schedule;
  const money = (n: number) => formatPrice(l, n, s.currency);
  const lines = k.body.replace(/\r/g, "").split("\n");
  const blocks: { kind: "title" | "clause" | "bullet" | "para"; text: string }[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (!blocks.length) blocks.push({ kind: "title", text: line.trim() });
    else if (line.startsWith("# ")) blocks.push({ kind: "clause", text: line.slice(2).trim() });
    else if (/^\s*-\s+/.test(line)) blocks.push({ kind: "bullet", text: line.replace(/^\s*-\s+/, "") });
    else blocks.push({ kind: "para", text: line.trim() });
  }
  return (
    <article className="flex flex-col gap-2 text-[15px] leading-relaxed break-words text-ink">
      {blocks.map((b, i) => b.kind === "title" ? <h2 key={i} className="m-0 text-xl font-bold">{b.text}</h2>
        : b.kind === "clause" ? <h3 key={i} className="m-0 mt-4 text-base font-bold">{b.text}</h3>
          : b.kind === "bullet" ? <p key={i} className="m-0 flex gap-2 pl-2"><span aria-hidden="true">•</span><span>{b.text}</span></p>
            : <p key={i} className="m-0">{b.text}</p>)}
      <h3 className="m-0 mt-6 text-base font-bold">{P.schedule}</h3>
      <div className="rounded-sm border border-line">
        <div className="row hide-sm grid-cols-[minmax(0,1fr)_100px_120px_120px] border-b border-line px-3 py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2">
          <span>{P.head[0]}</span><span className="text-right">{P.head[1]}</span><span className="text-right">{P.head[2]}</span><span className="text-right">{P.head[3]}</span>
        </div>
        {s.rows.map((r, i) => (
          <div key={i} className="row grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-mist px-3 py-2 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_100px_120px_120px]">
            <span className="min-w-0 break-words">{r.description}<span className="block text-xs text-ink-2 sm:hidden">{formatNumber(l, Number(r.quantity))} × {money(Number(r.unit_price))}</span></span>
            <span className="hide-sm text-right tabular-nums">{formatNumber(l, Number(r.quantity))}</span>
            <span className="hide-sm text-right tabular-nums">{money(Number(r.unit_price))}</span>
            <span className="text-right font-semibold tabular-nums">{money(Number(r.amount))}</span>
          </div>
        ))}
      </div>
      <dl className="m-0 ml-auto grid w-full max-w-[380px] grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
        {([[P.subtotal, s.subtotal], [fmt(P.vat, { pct: formatNumber(l, Number(s.vat_pct)) }), s.vat], [P.total, s.total],
           [fmt(P.deposit, { pct: formatNumber(l, Number(s.deposit_pct)) }), s.deposit], [P.balance, s.balance]] as const).map(([name, v], i) => (
          <div key={i} className="contents">
            <dt className={i === 2 ? "font-bold" : "text-ink-2"}>{name}</dt>
            <dd className={`m-0 text-right tabular-nums ${i === 2 ? "font-bold" : ""}`}>{money(Number(v))}</dd>
          </div>
        ))}
      </dl>
      {s.rows.some((r) => r.product) && (
        <>
          <h3 className="m-0 mt-6 text-base font-bold">{P.spec}</h3>
          {s.rows.filter((r) => r.product).map((r, i) => (
            <section key={i} className="flex flex-col gap-2 rounded-sm border border-line p-3 text-sm">
              <h4 className="m-0 text-[15px] font-bold">{r.description}</h4>
              <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[180px_minmax(0,1fr)]">
                {([[P.pack, r.product!.pack], [P.format, r.product!.format], [P.portion, r.product!.portion]] as const).filter(([, v]) => v).map(([name, v]) => (
                  <div key={name} className="contents">
                    <dt className="text-ink-2">{name}</dt>
                    <dd className="m-0 min-w-0 break-words">{v}</dd>
                  </div>
                ))}
              </dl>
              {r.product!.composition.length > 0 && (
                <div className="mt-1">
                  <div className="border-b border-ink pb-1 text-xs font-semibold tracking-[1px] uppercase text-ink-2">{P.composition}</div>
                  {r.product!.composition.map((c, j) => (
                    <div key={j} className="row grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-mist py-1 last:border-0">
                      <span className="min-w-0 break-words">{c.name}</span>
                      <span className="text-right tabular-nums">{c.amount}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </article>
  );
}
