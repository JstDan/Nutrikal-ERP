import type { Dict } from "@/lib/i18n/en";
import { ActionForm } from "./action-form";
import { createItem, updateItem } from "@/app/actions";

export type ItemRecord = {
  id: string; sku: string; type: string; name: string; name_bg: string | null; base_unit: string; latin_name: string | null;
  novel_food_status: string | null; novel_food_reference: string | null; shelf_life_months: number | null; reorder_level: string | null;
  storage_conditions: string | null; allergens: string[]; is_vegan: boolean | null; is_vegetarian: boolean | null;
  regulatory_notes: string | null; notes: string | null; is_active: boolean;
};

const TYPES = ["raw_material", "excipient", "packaging", "semi_finished"] as const;
const UNITS = ["kg", "g", "l", "ml", "pcs"] as const;
const NOVEL = ["not_novel", "authorised", "pending", "not_authorised", "unknown"] as const;
const ALLERGENS = [
  "cereals_gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk",
  "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs",
] as const;

/** Create (no item) or edit an item. Code, type and base unit are fixed once created. */
export function ItemForm({ t, item }: { t: Dict; item?: ItemRecord }) {
  const I = t.items;
  const tri = (v: boolean | null | undefined) => (v === true ? "true" : v === false ? "false" : "");
  const unitLabel = (u: string) => (u === "pcs" ? t.common.units : u);

  return (
    <ActionForm action={item ? updateItem : createItem} submitLabel={item ? t.common.save : I.create} resetOnSuccess={false}>
      {item && <input type="hidden" name="item_id" value={item.id} />}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {item ? (
          <div className="field md:col-span-2">
            <span>{I.sku} · {I.type} · {I.baseUnit}</span>
            <span className="flex min-h-11 items-center font-semibold">
              {item.sku} · {t.enums.itemType[item.type as "raw_material"]} · {unitLabel(item.base_unit)}
            </span>
          </div>
        ) : (
          <>
            <label className="field"><span>{I.sku} *</span>
              <input name="sku" required className="input" aria-describedby="sku-hint" />
              <small id="sku-hint" className="text-xs text-ink-2">{I.skuHint}</small>
            </label>
            <label className="field"><span>{I.type} *</span>
              <select name="type" required className="input" defaultValue="raw_material">
                {TYPES.map((ty) => <option key={ty} value={ty}>{t.enums.itemType[ty]}</option>)}
              </select>
            </label>
            <label className="field"><span>{I.baseUnit} *</span>
              <select name="base_unit" required className="input" defaultValue="kg" aria-describedby="unit-hint">
                {UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
              </select>
              <small id="unit-hint" className="text-xs text-ink-2">{I.baseUnitHint}</small>
            </label>
          </>
        )}
        <label className="field"><span>{I.name} *</span><input name="name" required defaultValue={item?.name} className="input" /></label>
        <label className="field"><span>{I.nameBg}</span><input name="name_bg" defaultValue={item?.name_bg ?? ""} className="input" /></label>
        <label className="field"><span>{I.latinName}</span><input name="latin_name" defaultValue={item?.latin_name ?? ""} className="input" /></label>
        <label className="field"><span>{I.novelFood}</span>
          <select name="novel_food_status" className="input" defaultValue={item?.novel_food_status ?? "unknown"}>
            {NOVEL.map((n) => <option key={n} value={n}>{t.enums.novelFood[n]}</option>)}
          </select>
        </label>
        <label className="field"><span>{I.novelFoodRef}</span><input name="novel_food_reference" defaultValue={item?.novel_food_reference ?? ""} className="input" /></label>
        <label className="field"><span>{I.shelfLife}</span>
          <input name="shelf_life_months" type="number" min="1" step="1" defaultValue={item?.shelf_life_months ?? undefined} className="input" />
        </label>
        <label className="field"><span>{I.reorderLevel}</span>
          <input name="reorder_level" type="number" min="0" step="any" defaultValue={item?.reorder_level != null ? Number(item.reorder_level) : undefined} className="input" aria-describedby="reorder-hint" />
          <small id="reorder-hint" className="text-xs text-ink-2">{I.reorderHint}</small>
        </label>
        <label className="field"><span>{I.storage}</span><input name="storage_conditions" defaultValue={item?.storage_conditions ?? ""} className="input" /></label>
        <label className="field"><span>{I.vegan}</span>
          <select name="is_vegan" className="input" defaultValue={tri(item?.is_vegan)}>
            <option value="">{I.unknown}</option><option value="true">{I.yes}</option><option value="false">{I.no}</option>
          </select>
        </label>
        <label className="field"><span>{I.vegetarian}</span>
          <select name="is_vegetarian" className="input" defaultValue={tri(item?.is_vegetarian)}>
            <option value="">{I.unknown}</option><option value="true">{I.yes}</option><option value="false">{I.no}</option>
          </select>
        </label>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0 md:col-span-2">
          <legend className="mb-2 text-[13px] font-semibold">{I.allergens}</legend>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            {ALLERGENS.map((a) => (
              <label key={a} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="allergens" value={a} defaultChecked={item?.allergens.includes(a)} className="h-5 w-5" />
                {t.enums.allergen[a]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field md:col-span-2"><span>{I.regulatoryNotes}</span>
          <textarea name="regulatory_notes" rows={2} defaultValue={item?.regulatory_notes ?? ""} className="input" />
        </label>
        <label className="field md:col-span-2"><span>{I.notes}</span>
          <textarea name="notes" rows={2} defaultValue={item?.notes ?? ""} className="input" />
        </label>
        {item && (
          <label className="flex min-h-11 items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="is_active" defaultChecked={item.is_active} className="h-5 w-5" /> {I.active}
          </label>
        )}
      </div>
    </ActionForm>
  );
}
