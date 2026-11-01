import { Wordmark } from "@/components/logo";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

/** The head shared by every Nutrikal document: wordmark on the ink band (white when plain, as on offers), title, then number and dates. */
export function DocHeader({ title, meta, sellerName, logoDataUrl, plain = false }: { title: string; meta: string[]; sellerName: string; logoDataUrl: string | null; plain?: boolean }) {
  return (
    <header>
      <div className={plain ? "doc-band doc-band-plain" : "doc-band"}>
        {logoDataUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logoDataUrl} alt={sellerName} className="doc-logo" />
          : <Wordmark height={22} inverted={!plain} />}
        <h1 className="doc-title">{title}</h1>
      </div>
      {meta.length > 0 && (
        <dl className="doc-meta">
          {meta.map((line, i) => {
            const at = line.indexOf(": ");
            return at > 0 ? (
              <div key={i}><dt>{line.slice(0, at)}</dt><dd>{line.slice(at + 2)}</dd></div>
            ) : (
              <div key={i}><dt aria-hidden="true">&nbsp;</dt><dd>{line}</dd></div>
            );
          })}
        </dl>
      )}
    </header>
  );
}

/** Proforma, invoice, purchase order or delivery note on screen and printed, from the same model as its PDF file. */
export function SalesDocument({ model: m, lang, sellerName }: { model: ProformaPdfModel; lang: string; sellerName: string }) {
  const party = (p: ProformaPdfModel["seller"]) => (
    <section className="flex min-w-0 flex-col gap-0.5">
      <h2 className="doc-label">{p.heading}</h2>
      {p.lines.map((line, i) => (
        <div key={i} className={i === 0 ? "text-[15px] font-semibold break-words" : "text-ink-2 break-words"}>{line}</div>
      ))}
    </section>
  );

  return (
    <article lang={lang} className="doc doc-brand">
      <DocHeader title={m.title} meta={m.meta} sellerName={sellerName} logoDataUrl={m.logoDataUrl} />
      <div className="doc-body">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {party(m.seller)}
          {party(m.buyer)}
        </div>

        <section className="flex flex-col">
          <div className="doc-th doc-row hide-sm">
            <span>{m.head[0]}</span><span className="text-right">{m.head[1]}</span>
            <span className="text-right">{m.head[2]}</span><span className="text-right">{m.head[3]}</span>
          </div>
          {m.rows.map((x, i) => (
            <div key={i} className="doc-row doc-line">
              <span className="doc-cell-main min-w-0 break-words">
                <span className="font-medium">{x.description}</span>
                {x.note && <span className="block text-xs text-ink-2">{x.note}</span>}
              </span>
              <span className="doc-num">{x.quantity}</span>
              <span className="doc-num">{x.unitPrice}</span>
              <span className="doc-num font-semibold">{x.amount}</span>
            </div>
          ))}
          {m.totals.length > 0 && (
            <div className="doc-totals">
              {m.totals.map(([label, value], i) => (
                <div key={i} className={i === m.totals.length - 1 ? "doc-total-due" : "doc-total"}>
                  <span>{label}</span><span>{value}</span>
                </div>
              ))}
            </div>
          )}
          {m.vatNote && <p className="m-0 mt-3 text-xs text-ink-2">{m.vatNote}</p>}
        </section>

        {m.bank.heading && (
          <section className="doc-section">
            <h2 className="doc-label">{m.bank.heading}</h2>
            {m.bank.lines.map((line, i) => <div key={i} className="break-words">{line}</div>)}
          </section>
        )}
        {m.notes && <p className="m-0 whitespace-pre-line">{m.notes}</p>}
      </div>
      {m.footer && <footer className="doc-foot">{m.footer}</footer>}
    </article>
  );
}
