import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatMass, formatNumber, formatQty } from "@/lib/i18n";
import { Card, Chip, Dot, Empty, Fact, PageHeader, type Tone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { SearchSelect } from "@/components/search-select";
import { formulaTone } from "@/lib/status";
import {
  addFormulaClaim, addFormulaLine, addFormulaPackaging, removeFormulaPackaging, approveFormulaVersion, discardFormulaDraft, newFormulaVersion,
  linkPendingLine, removeFormulaClaim, removeFormulaLine, removePendingLine, saveFormulaLine, saveFormulaVersion,
} from "@/app/actions";

type Formula = {
  id: string; code: string; name: string; name_bg: string | null; product_format: string; serving_size: string;
  serving_unit: "pcs" | "g" | "ml"; servings_per_pack: number | null; description: string | null;
  client: string | null; client_id: string | null; project_code: string | null; project_name: string | null;
  shell: string | null; shell_bg: string | null; calc_offer_id: string | null;
};
type Version = {
  id: string; version: number; status: string; shelf_life_months: number | null; change_note: string | null;
  notes: string | null; approved_at: string | null; approver: string | null;
};
type Line = {
  id: string; sku: string; name: string; name_bg: string | null; amount: string; unit: string; amount_mg: string;
  overage_pct: string; novel_food_status: string | null; input_mg_per_unit: string | null; kg_per_1000_packs: string | null;
  item_id: string; base_unit: string; available: string | null;
};
type Pending = { id: string; name: string; amount: string; unit: string; material_id: string | null };
type Checks = {
  line_count: number; novel_not_authorised: number; novel_to_review: number; shelf_life_months: number | null;
  min_item_shelf_life: number | null; shelf_life_exceeds_items: boolean; allergens: string | string[];
  is_vegan: boolean | null; is_vegetarian: boolean | null; fill_mg_per_serving: string; fill_mg_per_unit: string | null;
  shell_capacity_mg: string | null;
};
type Nutrient = { nutrient_id: string; name: string; name_bg: string | null; unit: string; amount: string; pct_nrv: string | null };
type Claim = {
  claim_id: string; claim_en: string; claim_bg: string | null; nutrient: string; nutrient_bg: string | null;
  min_pct_nrv: string; min_amount_mg: string | null; is_met: boolean;
};
type ClaimOption = { id: string; claim_en: string; claim_bg: string | null };
type ItemOption = { id: string; sku: string; name: string; name_bg: string | null; type: string };

// PGlite returns enum arrays as "{a,b}" text
const pgArray = (v: string | string[] | null) =>
  Array.isArray(v) ? v : (v ?? "").replace(/^\{|\}$/g, "").split(",").filter(Boolean);

export default async function FormulaPage({ params, searchParams }: PageProps<"/formulas/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, locale, t } = await requireStaff();
  const d = t.formulas.detail;
  const canEdit = user.role === "admin" || user.role === "sales";
  const isAdmin = user.role === "admin";
  const bgName = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const formula = (await tx.query<Formula>(
      `select f.id, f.code, f.name, f.name_bg, f.product_format, f.serving_size::text, f.serving_unit, f.servings_per_pack,
              f.description, c.legal_name as client, c.id as client_id, p.code as project_code, p.name as project_name,
              s.name as shell, s.name_bg as shell_bg, f.calc_offer_id
         from formulas f
         left join clients c on c.id = f.client_id
         left join projects p on p.id = f.project_id
         left join items s on s.id = f.shell_item_id
        where f.id = $1`, [id])).rows[0];
    if (!formula) return null;
    const versions = (await tx.query<Version>(
      `select v.id, v.version, v.status, v.shelf_life_months, v.change_note, v.notes, v.approved_at::text, pr.full_name as approver
         from formula_versions v left join profiles pr on pr.id = v.approved_by
        where v.formula_id = $1 order by v.version desc`, [id])).rows;
    const wanted = Number(sp.v);
    const current =
      versions.find((v) => v.version === wanted) ??
      versions.find((v) => v.status === "draft") ??
      versions.find((v) => v.status === "approved") ??
      versions[0];
    const lines = (await tx.query<Line>(
      `select d.id, d.sku, d.name, d.name_bg, d.amount::text, d.unit, d.amount_mg::text, d.overage_pct::text, d.novel_food_status,
              d.input_mg_per_unit::text, d.kg_per_1000_packs::text, d.item_id, i.base_unit, s.available::text
         from formula_line_details d join items i on i.id = d.item_id
         left join item_stock_summary s on s.item_id = d.item_id
        where d.version_id = $1 order by d.sort_order, d.name`, [current.id])).rows;
    const pending = (await tx.query<Pending>(
      "select id, name, amount::text, unit, material_id from formula_pending_lines where version_id = $1 order by sort_order, name",
      [current.id])).rows;
    const offer = formula.calc_offer_id
      ? (await tx.query<{ id: string; offer_no: string; units: string | null }>(
          "select id, offer_no, data ->> 'numberOfUnits' as units from calc_offers where id = $1", [formula.calc_offer_id])).rows[0] ?? null
      : null;
    const checks = (await tx.query<Checks>(
      `select line_count, novel_not_authorised, novel_to_review, shelf_life_months, min_item_shelf_life, shelf_life_exceeds_items,
              allergens::text[] as allergens, is_vegan, is_vegetarian, fill_mg_per_serving::text, fill_mg_per_unit::text,
              shell_capacity_mg::text
         from formula_version_checks where version_id = $1`, [current.id])).rows[0];
    const nutrients = (await tx.query<Nutrient>(
      `select nutrient_id, name, name_bg, unit, amount::text, pct_nrv::text
         from formula_version_nutrients where version_id = $1 order by sort_order`, [current.id])).rows;
    const claims = (await tx.query<Claim>(
      `select claim_id, claim_en, claim_bg, nutrient, nutrient_bg, min_pct_nrv::text, min_amount_mg::text, is_met
         from formula_version_claim_checks where version_id = $1 order by nutrient`, [current.id])).rows;
    const claimOptions = (await tx.query<ClaimOption>(
      `select c.id, c.claim_en, c.claim_bg from health_claims c join nutrients n on n.id = c.nutrient_id
        where c.is_active and c.id not in (select claim_id from formula_version_claims where version_id = $1)
        order by n.sort_order, c.claim_en`, [current.id])).rows;
    const items = (await tx.query<ItemOption>(
      `select id, sku, name, name_bg, type from items
        where is_active and type in ('raw_material', 'excipient', 'semi_finished') order by type, name`)).rows;
    const packaging = (await tx.query<{ id: string; sku: string; name: string; name_bg: string | null; qty_per_pack: string }>(
      `select fp.id, i.sku, i.name, i.name_bg, fp.qty_per_pack::text from formula_packaging fp join items i on i.id = fp.item_id
        where fp.version_id = $1 order by i.name`, [current.id])).rows;
    const packOptions = (await tx.query<{ id: string; sku: string; name: string; name_bg: string | null }>(
      "select id, sku, name, name_bg from items where is_active and type = 'packaging' order by name")).rows;
    return { formula, versions, current, lines, pending, offer, checks, nutrients, claims, claimOptions, items, packaging, packOptions };
  });
  if (!data) notFound();
  const { formula: f, versions, current: v, lines, pending, offer, checks: c, nutrients, claims, claimOptions, items, packaging, packOptions } = data;

  const isDraft = v.status === "draft";
  const editable = isDraft && canEdit;
  const hasDraft = versions.some((x) => x.status === "draft");
  const unitLabel = t.enums.servingUnit[f.serving_unit];
  const allergens = pgArray(c.allergens);

  const fillPerUnit = c.fill_mg_per_unit != null ? Number(c.fill_mg_per_unit) : null;
  const capacity = c.shell_capacity_mg != null ? Number(c.shell_capacity_mg) : null;
  const checkRows: { tone: Tone; text: string }[] = [
    c.novel_not_authorised > 0
      ? { tone: "red", text: fmt(d.novelBlocked, { n: c.novel_not_authorised }) }
      : c.novel_to_review > 0
        ? { tone: "amber", text: fmt(d.novelReview, { n: c.novel_to_review }) }
        : { tone: "green", text: d.novelOk },
    c.shelf_life_months == null
      ? { tone: "amber", text: d.shelfLifeMissing }
      : c.shelf_life_exceeds_items
        ? { tone: "amber", text: fmt(d.shelfLifeExceeds, { v: c.shelf_life_months, m: c.min_item_shelf_life ?? "" }) }
        : { tone: "green", text: fmt(d.shelfLifeOk, { v: c.shelf_life_months }) },
    { tone: "neutral", text: fmt(d.fillPerServing, { mg: formatMass(locale, c.fill_mg_per_serving) }) },
  ];
  if (fillPerUnit != null) {
    checkRows.push(
      capacity != null && fillPerUnit > capacity
        ? { tone: "red", text: fmt(d.fillOverCapacity, { mg: formatMass(locale, fillPerUnit), cap: formatMass(locale, capacity) }) }
        : { tone: "neutral", text: fmt(d.fillPerUnit, { mg: formatMass(locale, fillPerUnit) }) },
    );
  }
  // Stock for the offer quantity (or ?packs=): needed per stock item in its unit (lines of one item add up)
  const packsParam = Number(sp.packs);
  const offerUnits = Number(offer?.units);
  const packs = packsParam > 0 ? Math.round(packsParam) : offerUnits > 0 ? Math.round(offerUnits) : 1000;
  const stock = new Map<string, { name: string; unit: string; needed: number | null; available: number }>();
  for (const l of lines) {
    const kg = l.kg_per_1000_packs != null ? (Number(l.kg_per_1000_packs) * packs) / 1000 : null;
    const qty = kg == null ? null : l.base_unit === "kg" ? kg : l.base_unit === "g" ? kg * 1000 : null;
    const row = stock.get(l.item_id);
    if (row) row.needed = row.needed == null || qty == null ? null : row.needed + qty;
    else stock.set(l.item_id, { name: bgName(l), unit: l.base_unit, needed: qty, available: Number(l.available ?? 0) });
  }
  const itemOptions = (["raw_material", "excipient", "semi_finished"] as const).flatMap((ty) =>
    items.filter((i) => i.type === ty).map((i) => ({
      value: i.id, label: `${bgName(i)} · ${i.sku}`, group: t.enums.itemType[ty], keywords: `${i.name} ${i.name_bg ?? ""}`,
    })));
  // "Промени" opens the amount form of one line (?edit=line); the link again closes it
  const editing = typeof sp.edit === "string" ? sp.edit : null;
  const editHref = (line: string | null) => {
    const p = new URLSearchParams();
    if (typeof sp.v === "string") p.set("v", sp.v);
    if (typeof sp.packs === "string") p.set("packs", sp.packs);
    if (line) p.set("edit", line);
    const qs = p.toString();
    return `/formulas/${f.id}${qs ? `?${qs}` : ""}`;
  };
  const yesNo = (b: boolean | null) => (b == null ? d.unknown : b ? d.yes : d.no);

  // columns by the width of the card (.cq), not of the screen
  const lineGrid = editable
    ? "@md:grid-cols-[minmax(0,1fr)_90px_60px_80px] @3xl:grid-cols-[minmax(0,1fr)_100px_70px_100px_100px_88px]"
    : "@md:grid-cols-[minmax(0,1fr)_90px_60px] @3xl:grid-cols-[minmax(0,1fr)_100px_70px_100px_100px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/formulas" className="text-ink-2">{t.formulas.title}</Link> / {f.code}</>}
        title={bgName(f)}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={formulaTone(v.status)}>{t.enums.formulaStatus[v.status as "draft"]}</Chip>
            <span>
              {f.code} · {fmt(d.versionN, { n: v.version })} · {t.enums.productFormat[f.product_format as "capsule"]}
              {" · "}
              {f.client_id ? <Link href={`/clients/${f.client_id}`} className="text-ink">{f.client}{f.project_code ? ` · ${f.project_code}` : ""}</Link> : t.formulas.stock}
              {offer && <> · <Link href={`/offers/calc/${offer.id}`} className="text-ink">{fmt(t.formulas.fromOffer, { no: offer.offer_no })}</Link></>}
            </span>
          </span>
        }
      />

      <nav aria-label={d.versions} className="flex flex-wrap gap-1">
        {versions.map((x) => (
          <Link
            key={x.id}
            href={`/formulas/${f.id}?v=${x.version}`}
            aria-current={x.id === v.id ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-[13px] no-underline ${x.id === v.id ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
          >
            v{x.version} · {t.enums.formulaStatus[x.status as "draft"]}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------ left column */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={d.ingredients} id="lines-h">
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Fact label={d.serving}>{formatNumber(locale, f.serving_size, 3)} {unitLabel}</Fact>
              <Fact label={d.servingsPerPack}>{f.servings_per_pack ?? "—"}</Fact>
              <Fact label={d.shell}>{f.shell ? (locale === "bg" && f.shell_bg ? f.shell_bg : f.shell) : "—"}</Fact>
            </div>
            <div className="cq">
              <div className={`row cq-hide-xs border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${lineGrid}`}>
                <span>{d.item}</span><span>{d.amount}</span><span>{d.overage}</span>
                <span className="cq-hide-md">{d.perUnit}</span><span className="cq-hide-md">{d.perPack}</span>
                {editable && <span><span className="sr-only">{d.remove}</span></span>}
              </div>
              {lines.length === 0 && <div className="py-3"><Empty>{d.noLines}</Empty></div>}
              {lines.map((l) => (
                <div key={l.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 ${lineGrid}`}>
                  <div className="min-w-0">
                    <div className="font-semibold break-words">{bgName(l)}</div>
                    <div className="text-xs text-ink-2">
                      {l.sku}
                      {l.novel_food_status && l.novel_food_status !== "not_novel" && ` · Novel Food: ${t.enums.novelFood[l.novel_food_status as "pending"]}`}
                    </div>
                  </div>
                  <span className="font-semibold">{formatNumber(locale, l.amount, 3)} {l.unit}</span>
                  <span className="cq-hide-xs">{Number(l.overage_pct) ? `${formatNumber(locale, l.overage_pct)}%` : "—"}</span>
                  <span className="cq-hide-md">{l.input_mg_per_unit != null ? formatMass(locale, l.input_mg_per_unit) : "—"}</span>
                  <span className="cq-hide-md">{l.kg_per_1000_packs != null ? formatQty(locale, l.kg_per_1000_packs, "kg") : "—"}</span>
                  {editable && (
                    <div className="col-span-2 flex flex-col items-start @md:col-span-1 @md:items-end">
                      <form action={removeFormulaLine}>
                        <input type="hidden" name="line_id" value={l.id} />
                        <input type="hidden" name="formula_id" value={f.id} />
                        <button type="submit" title={d.remove} aria-label={`${d.remove}: ${bgName(l)}`}
                          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink hover:bg-mist">
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      </form>
                      <Link href={editHref(editing === l.id ? null : l.id)} scroll={false} aria-expanded={editing === l.id}
                        className="inline-flex min-h-11 items-center text-[13px] text-ink underline underline-offset-2">
                        {editing === l.id ? t.common.cancel : d.editLine}<span className="sr-only">: {bgName(l)}</span>
                      </Link>
                    </div>
                  )}
                  {editable && editing === l.id && (
                    <div className="col-span-full">
                      <ActionForm action={saveFormulaLine} submitLabel={t.common.save} resetOnSuccess={false}>
                        <input type="hidden" name="line_id" value={l.id} />
                        <input type="hidden" name="formula_id" value={f.id} />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <label className="field"><span>{d.amount} *</span><input name="amount" type="number" min="0.0001" step="any" required defaultValue={Number(l.amount)} className="input" /></label>
                          <label className="field"><span>{d.unit}</span>
                            <select name="unit" className="input" defaultValue={l.unit}>
                              <option value="mg">mg</option><option value="mcg">mcg</option><option value="g">g</option>
                            </select>
                          </label>
                          <label className="field"><span>{d.overagePct}</span>
                            <input name="overage_pct" type="number" min={0} max={100} step="any" defaultValue={Number(l.overage_pct)} className="input" />
                          </label>
                        </div>
                      </ActionForm>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {pending.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-mist pt-4">
                <h3 className="m-0 text-base font-bold">{d.pending}</h3>
                <p className="m-0 text-[13px] text-ink-2">{d.pendingNote} {isDraft && d.pendingBlocks}</p>
                {pending.map((p) => (
                  <div key={p.id} className="flex flex-col gap-2 rounded-sm border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                      <span className="min-w-0 flex-[1_1_200px] break-words"><span className="font-semibold">{p.name}</span> · {formatNumber(locale, p.amount, 3)} {p.unit}</span>
                      {editable && (
                        <form action={removePendingLine}>
                          <input type="hidden" name="pending_id" value={p.id} />
                          <input type="hidden" name="formula_id" value={f.id} />
                          <button type="submit" className="inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-[13px] text-ink underline underline-offset-2" aria-label={`${d.remove}: ${p.name}`}>{d.remove}</button>
                        </form>
                      )}
                    </div>
                    {editable && (
                      <ActionForm action={linkPendingLine} submitLabel={d.link} resetOnSuccess={false}>
                        <input type="hidden" name="pending_id" value={p.id} />
                        <input type="hidden" name="formula_id" value={f.id} />
                        <label className="field"><span>{d.stockItem} *</span>
                          <SearchSelect name="item_id" required placeholder={t.common.typeToSearch} noResults={t.common.noResults} options={itemOptions} />
                        </label>
                        {p.material_id && (
                          <label className="flex min-h-11 items-center gap-2 text-sm">
                            <input type="checkbox" name="remember" defaultChecked className="size-5" />{d.remember}
                          </label>
                        )}
                      </ActionForm>
                    )}
                  </div>
                ))}
              </div>
            )}

            {editable && (
              <div className="border-t border-mist pt-4">
                <h3 className="m-0 mb-3 text-base font-bold">{d.addLine}</h3>
                <ActionForm action={addFormulaLine} submitLabel={t.common.add}>
                  <input type="hidden" name="version_id" value={v.id} />
                  <input type="hidden" name="formula_id" value={f.id} />
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_100px_minmax(0,1fr)]">
                    <label className="field"><span>{d.item} *</span>
                      <SearchSelect name="item_id" required placeholder={t.common.typeToSearch} noResults={t.common.noResults} options={itemOptions} />
                    </label>
                    <label className="field"><span>{d.amount} *</span><input name="amount" type="number" min="0.0001" step="any" required className="input" /></label>
                    <label className="field"><span>{d.unit}</span>
                      <select name="unit" className="input" defaultValue="mg">
                        <option value="mg">mg</option><option value="mcg">mcg</option><option value="g">g</option>
                      </select>
                    </label>
                    <label className="field"><span>{d.overagePct}</span>
                      <input name="overage_pct" type="number" min={0} max={100} step="any" defaultValue={5} className="input" aria-describedby="overage-hint" />
                    </label>
                  </div>
                  <small id="overage-hint" className="-mt-2 text-xs text-ink-2">{d.overageHint}</small>
                </ActionForm>
              </div>
            )}
          </Card>

          <Card title={fmt(d.stockTitle, { n: formatNumber(locale, packs) })} id="stock-h">
            <p className="m-0 text-[13px] text-ink-2">{d.stockNote}</p>
            <form method="get" className="flex flex-wrap items-end gap-3">
              {typeof sp.v === "string" && <input type="hidden" name="v" value={sp.v} />}
              <label className="field min-w-0 flex-[0_1_200px]"><span>{d.packs}</span>
                <input name="packs" type="number" min={1} step={1} defaultValue={packs} className="input" />
              </label>
              <button type="submit" className="btn btn-outline">{d.show}</button>
            </form>
            {f.servings_per_pack == null && <p className="m-0 text-sm font-semibold">{d.noServings}</p>}
            <div>
              <div className="row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1.6fr)_120px_120px_minmax(0,1fr)]">
                <span>{d.item}</span><span>{d.needed}</span><span>{d.available}</span><span><span className="sr-only">{t.formulas.status}</span></span>
              </div>
              {stock.size === 0 && pending.length === 0 && <div className="py-3"><Empty>{d.noLines}</Empty></div>}
              {[...stock.entries()].map(([itemId, s]) => {
                const short = s.needed != null ? s.needed - s.available : null;
                return (
                  <div key={itemId} className="row grid-cols-2 gap-y-1 border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.6fr)_120px_120px_minmax(0,1fr)]">
                    <span className="col-span-2 min-w-0 font-semibold break-words md:col-span-1">{s.name}</span>
                    <span><span className="text-ink-2 md:hidden">{d.needed}: </span>{s.needed != null ? formatQty(locale, s.needed, s.unit) : "—"}</span>
                    <span><span className="text-ink-2 md:hidden">{d.available}: </span>{formatQty(locale, s.available, s.unit)}</span>
                    <span className="col-span-2 md:col-span-1">
                      {short == null ? null : short > 0
                        ? <Chip tone="red">{fmt(d.short, { qty: formatQty(locale, short, s.unit) })}</Chip>
                        : <Chip tone="green">{d.enough}</Chip>}
                    </span>
                  </div>
                );
              })}
              {pending.map((p) => (
                <div key={p.id} className="row grid-cols-2 gap-y-1 border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.6fr)_120px_120px_minmax(0,1fr)]">
                  <span className="col-span-2 min-w-0 font-semibold break-words md:col-span-1">{p.name}</span>
                  <span>—</span><span>—</span>
                  <span className="col-span-2 md:col-span-1"><Chip tone="amber">{d.notLinked}</Chip></span>
                </div>
              ))}
            </div>
          </Card>

          <Card title={d.packaging} id="packaging-h">
            <p className="m-0 text-[13px] text-ink-2">{d.packagingNote}</p>
            {packaging.length === 0 && <Empty>{d.noPackaging}</Empty>}
            {packaging.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-mist pb-3 text-sm last:border-0">
                <span className="min-w-0 flex-[1_1_200px] break-words"><span className="font-semibold">{bgName(p)}</span> <span className="text-ink-2">· {p.sku}</span></span>
                <span>{formatNumber(locale, p.qty_per_pack, 3)} {t.common.units}</span>
                {editable && (
                  <form action={removeFormulaPackaging}>
                    <input type="hidden" name="packaging_id" value={p.id} />
                    <input type="hidden" name="formula_id" value={f.id} />
                    <button type="submit" className="inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-[13px] text-ink underline underline-offset-2" aria-label={`${d.remove}: ${bgName(p)}`}>{d.remove}</button>
                  </form>
                )}
              </div>
            ))}
            {editable && (
              <ActionForm action={addFormulaPackaging} submitLabel={d.addPackaging}>
                <input type="hidden" name="version_id" value={v.id} />
                <input type="hidden" name="formula_id" value={f.id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <label className="field"><span>{d.item} *</span>
                    <SearchSelect name="item_id" required placeholder={t.common.typeToSearch} noResults={t.common.noResults}
                      options={packOptions.map((p) => ({ value: p.id, label: `${bgName(p)} · ${p.sku}`, keywords: `${p.name} ${p.name_bg ?? ""}` }))} />
                  </label>
                  <label className="field"><span>{d.qtyPerPack}</span><input name="qty_per_pack" type="number" min="0.0001" step="any" defaultValue={1} className="input" /></label>
                </div>
              </ActionForm>
            )}
          </Card>

          <Card title={d.nutrition} id="nutrition-h">
            {nutrients.length === 0 ? (
              <Empty>{d.noNutrients}</Empty>
            ) : (
              <div>
                <div className="row grid-cols-[minmax(0,1fr)_90px_64px] sm:grid-cols-[minmax(0,1fr)_110px_80px] border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2">
                  <span>{d.nutrient}</span><span>{d.perServing}</span><span>{d.nrv}</span>
                </div>
                {nutrients.map((n) => (
                  <div key={n.nutrient_id} className="row grid-cols-[minmax(0,1fr)_90px_64px] sm:grid-cols-[minmax(0,1fr)_110px_80px] border-b border-mist py-2.5 text-sm last:border-0">
                    <span className="min-w-0 break-words">{bgName(n)}</span>
                    <span>{formatNumber(locale, n.amount, 1)} {n.unit === "mcg" ? "µg" : n.unit}</span>
                    <span className="font-semibold">{n.pct_nrv != null ? `${formatNumber(locale, n.pct_nrv, 0)}%` : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={d.claims} id="claims-h">
            <p className="m-0 text-[13px] text-ink-2">{d.claimNote}</p>
            {claims.length === 0 && <Empty>{d.noClaims}</Empty>}
            {claims.map((cl) => (
              <div key={cl.claim_id} className="flex flex-wrap items-start justify-between gap-3 border-b border-mist pb-3 last:border-0">
                <div className="min-w-0 flex-[1_1_260px] text-sm">
                  <div className="break-words">{locale === "bg" && cl.claim_bg ? cl.claim_bg : cl.claim_en}</div>
                  <div className="mt-1">
                    {cl.is_met ? (
                      <Chip tone="green">{d.met}</Chip>
                    ) : (
                      <Chip tone="red">
                        {cl.min_amount_mg
                          ? fmt(d.notMetAmount, { min: formatMass(locale, cl.min_amount_mg) })
                          : fmt(d.notMet, { min: formatNumber(locale, cl.min_pct_nrv) })}
                      </Chip>
                    )}
                  </div>
                </div>
                {editable && (
                  <form action={removeFormulaClaim}>
                    <input type="hidden" name="version_id" value={v.id} />
                    <input type="hidden" name="claim_id" value={cl.claim_id} />
                    <input type="hidden" name="formula_id" value={f.id} />
                    <button type="submit" className="btn btn-outline">{d.remove}</button>
                  </form>
                )}
              </div>
            ))}
            {editable && claimOptions.length > 0 && (
              <ActionForm action={addFormulaClaim} submitLabel={d.addClaim}>
                <input type="hidden" name="version_id" value={v.id} />
                <input type="hidden" name="formula_id" value={f.id} />
                <label className="field"><span className="sr-only">{d.chooseClaim}</span>
                  <select name="claim_id" required className="input" defaultValue="" aria-label={d.chooseClaim}>
                    <option value="" disabled>{d.chooseClaim}</option>
                    {claimOptions.map((o) => <option key={o.id} value={o.id}>{locale === "bg" && o.claim_bg ? o.claim_bg : o.claim_en}</option>)}
                  </select>
                </label>
              </ActionForm>
            )}
          </Card>
        </div>

        {/* ----------------------------------------------- right column */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={d.checks} id="checks-h">
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm">
              {checkRows.map((r, i) => (
                <li key={i} className="flex gap-2.5"><Dot tone={r.tone} /><span className="min-w-0 break-words">{r.text}</span></li>
              ))}
            </ul>
            <div className="grid grid-cols-1 gap-3 border-t border-mist pt-3">
              <Fact label={d.allergens}>
                {allergens.length ? allergens.map((a) => t.enums.allergen[a as "milk"] ?? a).join(", ") : d.noAllergens}
              </Fact>
              <div className="grid grid-cols-2 gap-3">
                <Fact label={d.vegan}>{yesNo(c.is_vegan)}</Fact>
                <Fact label={d.vegetarian}>{yesNo(c.is_vegetarian)}</Fact>
              </div>
            </div>
          </Card>

          <Card title={d.settings} id="settings-h">
            {v.approved_at && <p className="m-0 text-sm text-ink-2">{fmt(d.approvedOn, { date: formatDate(locale, v.approved_at), name: v.approver ?? "—" })}</p>}
            {editable ? (
              <ActionForm action={saveFormulaVersion} submitLabel={t.common.save} resetOnSuccess={false}>
                <input type="hidden" name="version_id" value={v.id} />
                <input type="hidden" name="formula_id" value={f.id} />
                <label className="field"><span>{d.shelfLife}</span>
                  <input name="shelf_life_months" type="number" min={1} step={1} defaultValue={v.shelf_life_months ?? ""} className="input" />
                </label>
                <label className="field"><span>{d.changeNote}</span><input name="change_note" defaultValue={v.change_note ?? ""} className="input" /></label>
                <label className="field"><span>{d.notes}</span><textarea name="notes" defaultValue={v.notes ?? ""} className="input" /></label>
              </ActionForm>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <Fact label={d.shelfLife}>{v.shelf_life_months ?? "—"}</Fact>
                <Fact label={d.changeNote}>{v.change_note ?? "—"}</Fact>
                {v.notes && <Fact label={d.notes}><span className="whitespace-pre-line">{v.notes}</span></Fact>}
              </div>
            )}
          </Card>

          {canEdit && (
            <Card>
              {isDraft && !isAdmin && <p className="m-0 text-sm text-ink-2">{d.adminApproves}</p>}
              {isDraft && (
                <div className="btn-stack">
                  {isAdmin && (
                    <ActionForm action={approveFormulaVersion} submitLabel={d.approve} resetOnSuccess={false}>
                      <input type="hidden" name="version_id" value={v.id} />
                    </ActionForm>
                  )}
                  <form action={discardFormulaDraft}>
                    <input type="hidden" name="version_id" value={v.id} />
                    <input type="hidden" name="formula_id" value={f.id} />
                    <button type="submit" className="btn btn-primary">{d.discard}</button>
                  </form>
                </div>
              )}
              {!isDraft && <p className="m-0 text-sm text-ink-2">{d.lockedNote}</p>}
              {!hasDraft && (
                <ActionForm action={newFormulaVersion} submitLabel={d.newVersion} resetOnSuccess={false}>
                  <input type="hidden" name="formula_id" value={f.id} />
                  <label className="field"><span>{d.changeNote}</span><input name="change_note" className="input" /></label>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
