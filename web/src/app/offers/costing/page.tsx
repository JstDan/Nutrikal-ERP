import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { saveFormatCosting } from "@/app/actions";

type Row = {
  product_format: string; fee_per_pack: string; fee_per_1000_units: string; fee_per_kg: string; setup_fee: string;
  loss_pct: string; default_margin_pct: string; min_order_packs: number | null;
};

export default async function CostingPage() {
  const { user, t } = await requireRole("admin", "sales");
  const c = t.offers.costingPage;
  const isAdmin = user.role === "admin";
  const rows = await q<Row>(
    user.id,
    `select product_format, fee_per_pack::text, fee_per_1000_units::text, fee_per_kg::text, setup_fee::text, loss_pct::text,
            default_margin_pct::text, min_order_packs
       from format_costing order by array_position(enum_range(null::product_format), product_format)`,
  );
  const n = (v: string) => String(Number(v));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={c.title} subtitle={c.subtitle} crumb={<Link href="/offers" className="text-ink-2">{t.offers.title}</Link>} />
      {!isAdmin && <p className="m-0 text-sm text-ink-2">{c.adminOnly}</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.product_format} title={t.enums.productFormat[r.product_format as "capsule"]}>
            <ActionForm action={saveFormatCosting} submitLabel={t.common.save} resetOnSuccess={false}>
              <input type="hidden" name="product_format" value={r.product_format} />
              <fieldset disabled={!isAdmin} className="m-0 grid grid-cols-1 gap-3 border-0 p-0 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
                <label className="field"><span>{c.feePerPack}</span><input name="fee_per_pack" type="number" min={0} step="any" defaultValue={n(r.fee_per_pack)} className="input" /></label>
                <label className="field"><span>{c.feePer1000}</span><input name="fee_per_1000_units" type="number" min={0} step="any" defaultValue={n(r.fee_per_1000_units)} className="input" /></label>
                <label className="field"><span>{c.feePerKg}</span><input name="fee_per_kg" type="number" min={0} step="any" defaultValue={n(r.fee_per_kg)} className="input" /></label>
                <label className="field"><span>{c.setupFee}</span><input name="setup_fee" type="number" min={0} step="any" defaultValue={n(r.setup_fee)} className="input" /></label>
                <label className="field"><span>{c.lossPct}</span><input name="loss_pct" type="number" min={0} max={99} step="any" defaultValue={n(r.loss_pct)} className="input" /></label>
                <label className="field"><span>{c.margin}</span><input name="default_margin_pct" type="number" min={0} max={99} step="any" defaultValue={n(r.default_margin_pct)} className="input" /></label>
                <label className="field"><span>{c.minOrder}</span><input name="min_order_packs" type="number" min={1} step={1} defaultValue={r.min_order_packs ?? ""} className="input" /></label>
              </fieldset>
            </ActionForm>
          </Card>
        ))}
      </div>
    </div>
  );
}
