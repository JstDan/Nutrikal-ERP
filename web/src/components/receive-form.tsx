import { withUser } from "@/lib/db/engine";
import type { SessionUser } from "@/lib/session";
import type { Dict } from "@/lib/i18n/en";
import { ActionForm } from "./action-form";
import { receiveGoods } from "@/app/actions";

/** Receiving form shared by staff (/inventory/receive) and the partner (/partner/receive).
 *  Lists only what the user may see: the partner gets partner locations and no suppliers. */
export async function ReceiveForm({ user, t }: { user: SessionUser; t: Dict }) {
  const r = t.receive;
  const { items, locations, suppliers } = await withUser(user.id, async (tx) => ({
    items: (await tx.query<{ id: string; sku: string; name: string; name_bg: string | null; base_unit: string; type: string }>(
      "select id, sku, name, name_bg, base_unit, type from items where is_active and type <> 'finished_good' order by type, name",
    )).rows,
    locations: (await tx.query<{ id: string; name: string; type: string }>(
      "select id, name, type from locations where is_active and type <> 'virtual' order by (type = 'quarantine') desc, name",
    )).rows,
    suppliers: (await tx.query<{ id: string; name: string }>("select id, name from suppliers where is_active order by name")).rows,
  }));
  const label = (i: (typeof items)[number]) => `${user.locale === "bg" && i.name_bg ? i.name_bg : i.name} · ${i.sku} (${i.base_unit})`;

  return (
    <ActionForm action={receiveGoods} submitLabel={r.submit}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="field md:col-span-2"><span>{r.item} *</span>
          <select name="item_id" required className="input" defaultValue="">
            <option value="" disabled>{r.chooseItem}</option>
            {(["raw_material", "excipient", "packaging", "semi_finished"] as const).map((ty) => {
              const group = items.filter((i) => i.type === ty);
              return group.length ? (
                <optgroup key={ty} label={t.enums.itemType[ty]}>
                  {group.map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <label className="field"><span>{r.location} *</span>
          <select name="location_id" required className="input">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{r.quantity} *</span><input name="quantity" type="number" min="0.0001" step="any" required className="input" /></label>
        {suppliers.length > 0 && (
          <label className="field"><span>{r.supplier}</span>
            <select name="supplier_id" className="input" defaultValue="">
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>{r.supplierLot}</span><input name="supplier_lot" className="input" /></label>
        <label className="field"><span>{r.manufactured}</span><input name="manufactured_on" type="date" className="input" /></label>
        <label className="field"><span>{r.expires}</span><input name="expires_on" type="date" className="input" aria-describedby="exp-hint" /><small id="exp-hint" className="text-xs text-ink-2">{r.expiresHint}</small></label>
        <label className="field md:col-span-2"><span>{r.reference}</span><input name="reference" className="input" /></label>
      </div>
    </ActionForm>
  );
}
