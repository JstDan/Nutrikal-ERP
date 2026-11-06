import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatQty } from "@/lib/i18n";
import { Card, Empty, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { SearchSelect } from "@/components/search-select";
import { transferStock } from "@/app/actions";

type Loc = { id: string; name: string };
type Lot = {
  lot_id: string; location_id: string; location: string; lot_number: string; supplier_lot: string | null;
  sku: string; name: string; name_bg: string | null; base_unit: string; quantity: string; qc_status: string;
};

/** Transfer between warehouses (Admin; owner, Nov 2026): a lot, from where it is, to another warehouse. */
export default async function TransferPage({ searchParams }: PageProps<"/inventory/transfer">) {
  const { user, locale, t } = await requireRole("admin");
  const T = t.inventory.transfer;
  const sp = await searchParams;
  const from = typeof sp.from === "string" && /^[0-9a-f-]{36}$/i.test(sp.from) ? sp.from : "";

  const { locations, lots } = await withUser(user.id, async (tx) => ({
    locations: (await tx.query<Loc>(
      "select id, name from locations where is_active and type <> 'virtual' order by (code = 'NK-WH') desc, (code = 'G-PRO') desc, name")).rows,
    lots: (await tx.query<Lot>(
      `select b.lot_id, b.location_id, l.name as location, b.lot_number, lo.supplier_lot, i.sku, i.name, i.name_bg, i.base_unit,
              b.quantity::text, b.qc_status
         from stock_balances b join locations l on l.id = b.location_id join lots lo on lo.id = b.lot_id join items i on i.id = b.item_id
        where b.quantity > 0 and ($1 = '' or b.location_id::text = $1)
        order by l.name, i.name, b.expires_on nulls last, b.lot_number`, [from])).rows,
  }));
  const fromName = locations.find((l) => l.id === from)?.name;
  const nm = (x: Lot) => (locale === "bg" && x.name_bg ? x.name_bg : x.name);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={T.title}
        subtitle={T.subtitle}
        crumb={<Link href={`/inventory${from ? `?loc=${from}` : ""}`} className="text-ink-2">{t.inventory.title}</Link>}
      />
      <Card>
        <form method="get" className="mb-4">
          <label className="field max-w-[360px]"><span>{T.from}</span>
            <select name="from" defaultValue={from} className="input">
              <option value="">{t.inventory.allWarehouses}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-outline mt-2">{T.showLots}</button>
        </form>

        {lots.length === 0 ? <Empty>{T.noLots}</Empty> : (
          <ActionForm action={transferStock} submitLabel={T.submit}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="field md:col-span-2"><span>{T.lot} *</span>
                <SearchSelect name="lot_location" required placeholder={t.common.typeToSearch} noResults={t.common.noResults}
                  options={lots.map((x) => ({
                    value: `${x.lot_id}|${x.location_id}`,
                    label: `${nm(x)} · ${x.lot_number}`,
                    hint: `${formatQty(locale, x.quantity, x.base_unit)} · ${t.enums.qcStatus[x.qc_status as "released"]}`,
                    group: x.location,
                    keywords: `${x.sku} ${x.name} ${x.name_bg ?? ""} ${x.supplier_lot ?? ""}`,
                  }))} />
              </label>
              <label className="field"><span>{T.to} *</span>
                <select name="to_location_id" required defaultValue="" className="input">
                  <option value="" disabled>—</option>
                  {locations.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label className="field"><span>{T.quantity} *</span>
                <input name="quantity" type="number" min="0.0001" step="any" required className="input" />
              </label>
              <label className="field md:col-span-2"><span>{T.reason}</span><input name="reason" className="input" /></label>
            </div>
            {fromName && <p className="m-0 text-[13px] text-ink-2">{fmt(T.fromNote, { from: fromName })}</p>}
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
