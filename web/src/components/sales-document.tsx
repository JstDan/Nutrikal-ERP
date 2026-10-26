import { Wordmark } from "@/components/logo";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

/** Proforma or invoice on screen (and when printed), from the same model as its PDF file. */
export function SalesDocument({ model: m, lang, sellerName }: { model: ProformaPdfModel; lang: string; sellerName: string }) {
  const grid = "grid-cols-[minmax(0,1fr)_56px_96px_104px]";
  const party = (p: ProformaPdfModel["seller"]) => (
    <section className="flex min-w-0 flex-col gap-1">
      <h2 className="label m-0">{p.heading}</h2>
      {p.lines.map((line, i) => (
        <div key={i} className={i === 0 ? "font-semibold break-words" : "text-ink-2 break-words"}>{line}</div>
      ))}
    </section>
  );

  return (
    <article lang={lang} className="card flex flex-col gap-6 p-6 text-sm sm:p-10 print:border-0 print:p-0">
      <header className="flex flex-wrap justify-between gap-6">
        <div className="min-w-0">
          {m.logoDataUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={m.logoDataUrl} alt={sellerName} className="mb-2 h-[26px] w-auto" />
            : <Wordmark height={26} className="mb-2" />}
        </div>
        <div className="min-w-0 text-right">
          <h1 className="m-0 text-[28px] font-extrabold tracking-[0.6px]">{m.title}</h1>
          {m.meta.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {party(m.seller)}
        {party(m.buyer)}
      </div>

      <section className="flex flex-col">
        <div className={`row ${grid} border-b border-line py-1.5 font-semibold`}>
          <span>{m.head[0]}</span><span className="text-right">{m.head[1]}</span>
          <span className="text-right">{m.head[2]}</span><span className="text-right">{m.head[3]}</span>
        </div>
        {m.rows.map((x, i) => (
          <div key={i} className={`row ${grid} border-b border-mist py-1.5`}>
            <span className="min-w-0 break-words">
              {x.description}
              {x.note && <span className="block text-xs text-ink-2">{x.note}</span>}
            </span>
            <span className="text-right">{x.quantity}</span>
            <span className="text-right">{x.unitPrice}</span>
            <span className="text-right">{x.amount}</span>
          </div>
        ))}
        <div className="ml-auto flex w-full max-w-[320px] flex-col gap-1 pt-3">
          {m.totals.map(([label, value], i) => {
            const last = i === m.totals.length - 1;
            return (
              <div key={i} className={`flex justify-between gap-4 ${last ? "border-t border-line pt-1 text-base font-bold" : ""}`}>
                <span>{label}</span><span>{value}</span>
              </div>
            );
          })}
        </div>
        {m.vatNote && <p className="m-0 mt-2 text-xs text-ink-2">{m.vatNote}</p>}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="label m-0">{m.bank.heading}</h2>
        {m.bank.lines.map((line, i) => <div key={i} className="break-words">{line}</div>)}
      </section>

      {m.notes && <p className="m-0 whitespace-pre-line">{m.notes}</p>}
      {m.footer && <p className="m-0 text-xs text-ink-2">{m.footer}</p>}
    </article>
  );
}
