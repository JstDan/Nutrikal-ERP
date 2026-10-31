"use client";

import { useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/app/actions";
import { fmt, formatNumber, formatPrice, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { SearchCombobox } from "@/components/calculator/search-combobox";

export type OrderableOffer = {
  id: string; offer_no: string; product: string | null; client_id: string; units: number; unit_price: number; created_at: string;
  /** The offer quantity and its other price levels, smallest first. */
  levels: { units: number; price: number }[];
};
export type OrderableClient = { id: string; name: string; country: string; vat_number: string | null };
export type ServiceOption = { description: string; price: number };

type Service = { key: string; description: string; quantity: string; price: string; on: boolean; custom: boolean };

const toNum = (s: string) => {
  const n = Number(s.replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
};
/** Bulgarian clients pay 20% VAT; EU clients with a VAT number and clients outside the EU 0%. */
const defaultVat = (c: OrderableClient | undefined) => (!c || c.country === "BG" ? "20" : "0");

/** Sales: client (with offers to order) → one or more of its offers → extra services → create the unpaid order. */
export function NewOrderForm({ action, clients, offers, presets, initialClient, initialOffer, locale, text }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  clients: OrderableClient[];
  offers: OrderableOffer[];
  presets: ServiceOption[];
  initialClient: string | null;
  initialOffer: string | null;
  locale: Locale;
  text: Dict["orders"]["new"];
}) {
  const n = text;
  const [state, formAction, pending] = useActionState(action, {});
  const [clientId, setClientId] = useState<string | null>(clients.some((c) => c.id === initialClient) ? initialClient : null);
  const [picked, setPicked] = useState<string[]>(offers.some((o) => o.id === initialOffer && o.client_id === initialClient) ? [initialOffer!] : []);
  /** Chosen quantity per offer (the offer quantity unless another level is picked). */
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [services, setServices] = useState<Service[]>(() =>
    presets.map((p, i) => ({ key: `p${i}`, description: p.description, quantity: "1", price: String(p.price), on: false, custom: false })));
  const client = clients.find((c) => c.id === clientId);
  const [vat, setVat] = useState(defaultVat(client));

  const clientOffers = useMemo(() => offers.filter((o) => o.client_id === clientId), [offers, clientId]);
  const levelOf = (o: OrderableOffer) => o.levels.find((l) => l.units === levels[o.id]) ?? { units: o.units, price: o.unit_price };
  const money = (x: number) => formatPrice(locale, x);
  const chosen = services.filter((s) => s.on);
  const total =
    clientOffers.filter((o) => picked.includes(o.id)).reduce((a, o) => a + levelOf(o).units * levelOf(o).price, 0) +
    chosen.reduce((a, s) => a + (toNum(s.quantity) ?? 0) * (toNum(s.price) ?? 0), 0);
  const payload = JSON.stringify(chosen.map((s) => ({ description: s.description.trim(), quantity: toNum(s.quantity), unit_price: toNum(s.price) })));

  const update = (key: string, patch: Partial<Service>) => setServices((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const pickClient = (c: OrderableClient | null) => {
    setClientId(c?.id ?? null);
    setPicked([]);
    setVat(defaultVat(c ?? undefined));
  };

  if (clients.length === 0) return <p className="m-0 text-sm text-ink-2">{n.noClients}</p>;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="client_id" value={clientId ?? ""} />
      <input type="hidden" name="services" value={payload} />

      <section aria-labelledby="no-client" className="flex flex-col gap-2">
        <h2 id="no-client" className="m-0 text-base font-bold">1. {n.client} *</h2>
        {client ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line p-3">
            <div className="min-w-0">
              <div className="font-semibold break-words">{client.name}</div>
              <div className="text-xs text-ink-2">{[client.country, client.vat_number].filter(Boolean).join(" · ")}</div>
            </div>
            <button type="button" className="btn btn-outline" onClick={() => pickClient(null)}>{n.changeClient}</button>
          </div>
        ) : (
          <>
            <SearchCombobox
              id="order-client"
              items={clients}
              searchText={(c) => `${c.name} ${c.vat_number ?? ""}`}
              optionKey={(c) => c.id}
              onPick={pickClient}
              placeholder={n.clientPlaceholder}
              listLabel={n.client}
              noResults={n.noResults}
              renderOption={(c) => (
                <span className="min-w-0 flex-1 break-words">
                  {c.name}
                  <span className="block text-xs text-ink-2">{[c.country, c.vat_number].filter(Boolean).join(" · ")}</span>
                </span>
              )}
            />
            <p id="order-client-msg" className="m-0 text-[13px] text-ink-2">{n.clientHint}</p>
          </>
        )}
      </section>

      {client && (
        <>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-base font-bold">2. {n.offers} *</legend>
            <p className="m-0 text-[13px] text-ink-2">{n.offersHint}</p>
            {clientOffers.map((o) => (
              <div key={o.id} className="flex flex-col gap-2 rounded-sm border border-line p-3">
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="offer_id"
                  value={o.id}
                  checked={picked.includes(o.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))}
                  className="mt-1 size-5 shrink-0"
                />
                <span className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-4 gap-y-1">
                  <span className="min-w-0 break-words">
                    <strong>{o.offer_no}</strong> · {o.product ?? "—"}
                    <span className="block text-xs text-ink-2">{fmt(n.offerLine, { units: formatNumber(locale, levelOf(o).units), price: money(levelOf(o).price) })}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{money(levelOf(o).units * levelOf(o).price)}</span>
                </span>
              </label>
              {picked.includes(o.id) && o.levels.length > 1 && (
                <label className="field ml-8 max-w-[360px]"><span>{n.level}</span>
                  <select name={`level_${o.id}`} className="input" value={levelOf(o).units}
                    onChange={(e) => setLevels((all) => ({ ...all, [o.id]: Number(e.target.value) }))}>
                    {o.levels.map((l) => (
                      <option key={l.units} value={l.units}>{fmt(n.levelOption, { units: formatNumber(locale, l.units), price: money(l.price) })}</option>
                    ))}
                  </select>
                </label>
              )}
              </div>
            ))}
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-base font-bold">3. {n.services}</legend>
            <p className="m-0 text-[13px] text-ink-2">{n.servicesHint}</p>
            {services.map((s) => (
              <div
                key={s.key}
                className="grid items-end gap-3 rounded-sm border border-line p-3 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_88px_120px_auto]"
              >
                <div className="col-span-2 flex min-h-11 items-center gap-3 md:col-span-1">
                  {!s.custom && (
                    <input
                      id={`svc-on-${s.key}`}
                      type="checkbox"
                      checked={s.on}
                      onChange={(e) => update(s.key, { on: e.target.checked })}
                      className="size-5 shrink-0"
                    />
                  )}
                  {s.custom ? (
                    <label className="field min-w-0 flex-1">
                      <span>{n.otherDescription} *</span>
                      <input value={s.description} onChange={(e) => update(s.key, { description: e.target.value })} className="input" required />
                    </label>
                  ) : (
                    <label htmlFor={`svc-on-${s.key}`} className="min-w-0 cursor-pointer break-words font-semibold">{s.description}</label>
                  )}
                </div>
                <label className="field">
                  <span>{n.quantity}</span>
                  <input inputMode="numeric" value={s.quantity} disabled={!s.on} onChange={(e) => update(s.key, { quantity: e.target.value })} className="input" />
                </label>
                <label className="field">
                  <span>{n.price} (€)</span>
                  <input inputMode="decimal" value={s.price} disabled={!s.on} onChange={(e) => update(s.key, { price: e.target.value })} className="input" />
                </label>
                {s.custom ? (
                  <button type="button" className="btn btn-outline col-span-2 md:col-span-1" onClick={() => setServices((all) => all.filter((x) => x.key !== s.key))}>
                    {n.remove}
                  </button>
                ) : (
                  <span className="hidden md:block" />
                )}
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setServices((all) => [...all, { key: crypto.randomUUID(), description: "", quantity: "1", price: "", on: true, custom: true }])}
              >
                + {n.other}
              </button>
            </div>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="mb-1 p-0 text-base font-bold">4. {n.vat}</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="field">
                <span>{n.vat}</span>
                <input name="vat_pct" type="number" min={0} max={100} step="any" value={vat} onChange={(e) => setVat(e.target.value)} className="input" />
              </label>
              <label className="field"><span>{n.customerRef}</span><input name="customer_ref" className="input" /></label>
              <label className="field"><span>{n.requested}</span><input name="requested_date" type="date" className="input" /></label>
            </div>
            <p className="m-0 text-[13px] text-ink-2">{n.vatHint}</p>
            <label className="field"><span>{n.notes}</span><textarea name="notes" className="input" /></label>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-4">
            <div className="text-sm">{n.total}: <strong className="tabular-nums">{money(total)}</strong></div>
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" aria-live="polite" className="m-0 text-sm">
                {state.error && <span className="font-semibold text-red-ink">{state.error}</span>}
              </p>
              <button type="submit" className="btn btn-primary" disabled={pending || picked.length === 0}>
                {pending ? "…" : n.submit}
              </button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
