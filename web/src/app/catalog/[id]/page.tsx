import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { formatMoney, formatNumber, fmt } from "@/lib/i18n";
import { addCatalogTier, linkCatalogRecipe, publishCatalogProduct, removeCatalogImage, removeCatalogTier, saveCatalogProduct, unpublishCatalogProduct, uploadCatalogImage } from "@/app/catalog-actions";
import { CATALOG_NAME_LANGS, PRODUCT_NAMES } from "@/lib/i18n/product-names";

type Product = {
  id: string; code: string; name: string; name_bg: string | null; description: string | null; description_bg: string | null;
  category_id: string | null; sort_order: number; is_published: boolean; problem: string | null;
  formula_id: string | null; formula_code: string | null; product_format: string | null; client: string | null;
  own_format: string | null; pack: string | null; pack_bg: string | null; min_qty: number; ingredients: { name: string; amount: string; spec?: string; basis?: string }[];
  review_status: string | null; internal_notes: string | null; sources: string | null; extra: string[];
  image: string | null; names: Partial<Record<string, string>>;
};
type Tier = { id: string; min_qty: number; unit_price: string };
type Category = { id: string; name: string; name_bg: string | null };

export default async function CatalogProductPage({ params }: PageProps<"/catalog/[id]">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const { id } = await params;
  const C = t.catalog;
  const canEdit = user.role === "admin" && !user.readOnly;

  const [p] = await q<Product>(user.id,
    `select p.id, p.code, p.name, p.name_bg, p.description, p.description_bg, p.category_id, p.sort_order, p.is_published,
            catalog_publish_problem(p.id) as problem, f.id as formula_id, f.code as formula_code,
            coalesce(f.product_format, p.product_format) as product_format, c.legal_name as client,
            p.product_format as own_format, p.pack, p.pack_bg, p.min_qty, p.ingredients, p.review_status, p.internal_notes, p.sources, p.image, p.names,
            coalesce((select array_agg(x.name order by x.sort_order) from catalog_product_categories l join catalog_categories x on x.id = l.category_id where l.product_id = p.id), '{}') as extra
       from catalog_products p
       left join formulas f on f.id = p.formula_id
       left join clients c on c.id = f.client_id
      where p.id = $1`, [id]);
  if (!p) notFound();
  const tiers = await q<Tier>(user.id, "select id, min_qty, unit_price::text from catalog_price_tiers where product_id = $1 order by min_qty", [id]);
  const categories = await q<Category>(user.id, "select id, name, name_bg from catalog_categories order by sort_order, name");
  const recipes = canEdit && !p.formula_id
    ? await q<{ id: string; code: string; name: string }>(user.id,
        "select f.id, f.code, f.name from formulas f where f.is_active and not exists (select 1 from catalog_products x where x.formula_id = f.id) order by f.code desc")
    : [];
  const formats = Object.entries(t.enums.productFormat);
  const displayName = locale === "bg" && p.name_bg ? p.name_bg : p.name;
  // What the open catalog shows now per language: set on the product, else product-names.ts
  const siteName = (l: (typeof CATALOG_NAME_LANGS)[number]) => p.names?.[l] || PRODUCT_NAMES[p.code]?.[l] || (l === "bg" ? p.name_bg ?? "" : "");
  const picture = p.image ?? (p.product_format === "powder" ? "/catalog/site/blank-pouch.webp" : "/catalog/site/blank-bottle.webp");
  const pictureFile = p.image ? `${p.code}.${p.image.split(".").pop()}` : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/catalog" className="text-ink-2">{C.title}</Link> / {p.code}</>}
        title={displayName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={p.is_published ? (p.problem ? "amber" : "green") : "neutral"}>{p.is_published ? (p.problem ? C.hidden : C.published) : C.draft}</Chip>
            {p.product_format && <span>{t.enums.productFormat[p.product_format as "capsule"]}</span>}
          </span>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title={C.details}>
            {canEdit ? (
              <ActionForm action={saveCatalogProduct} submitLabel={t.common.save} resetOnSuccess={false}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="code" value={p.code} />
                <label className="field"><span>{C.nameEn} *</span><input name="name" required defaultValue={p.name} className="input" /></label>
                <label className="field"><span>{C.nameBg}</span><input name="name_bg" defaultValue={p.name_bg ?? ""} className="input" /></label>
                <label className="field"><span>{C.descriptionEn}</span><textarea name="description" rows={3} defaultValue={p.description ?? ""} className="input" /></label>
                <label className="field"><span>{C.descriptionBg}</span><textarea name="description_bg" rows={3} defaultValue={p.description_bg ?? ""} className="input" /></label>
                <p className="m-0 text-sm text-ink-2">{C.claimsNote}</p>
                <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
                  <legend className="mb-1 p-0 text-sm font-semibold">{C.siteNames}</legend>
                  <p className="m-0 text-sm text-ink-2">{C.siteNamesNote}</p>
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    {CATALOG_NAME_LANGS.map((l) => (
                      <label key={l} className="field"><span>{C.langNames[l]}</span>
                        <input name={`name_${l}`} lang={l} defaultValue={siteName(l)} className="input" />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="field"><span>{C.category}</span>
                  <select name="category_id" defaultValue={p.category_id ?? ""} className="input">
                    <option value="">—</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{locale === "bg" && c.name_bg ? c.name_bg : c.name}</option>)}
                  </select>
                </label>
                {!p.formula_id && (
                  <>
                    <label className="field"><span>{C.format}</span>
                      <select name="product_format" defaultValue={p.own_format ?? ""} className="input">
                        <option value="">—</option>
                        {formats.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>{C.composition}</span><textarea name="ingredients" rows={8} defaultValue={p.ingredients.map((i) => [i.name, i.amount, i.spec, i.basis].filter((x) => x != null).join(" | ")).join("\n")} className="input" /></label>
                    <p className="m-0 text-sm text-ink-2">{C.compositionNote}</p>
                  </>
                )}
                {p.formula_id && (
                  <>
                    <input type="hidden" name="product_format" value={p.own_format ?? ""} />
                    <input type="hidden" name="ingredients" value={p.ingredients.map((i) => [i.name, i.amount, i.spec, i.basis].filter((x) => x != null).join(" | ")).join("\n")} />
                  </>
                )}
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="field"><span>{C.packEn}</span><input name="pack" defaultValue={p.pack ?? ""} className="input" /></label>
                  <label className="field"><span>{C.packBg}</span><input name="pack_bg" defaultValue={p.pack_bg ?? ""} className="input" /></label>
                </div>
                {p.formula_id && <p className="m-0 text-sm text-ink-2">{C.packNote}</p>}
                <label className="field"><span>{C.reviewLabel}</span>
                  <select name="review_status" defaultValue={p.review_status ?? ""} className="input">
                    <option value="">{C.reviewCleared}</option>
                    {Object.entries(C.review).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field"><span>{C.internalNotes}</span><textarea name="internal_notes" rows={4} defaultValue={p.internal_notes ?? ""} className="input" /></label>
                <label className="field"><span>{C.minOrder}</span><input name="min_qty" type="number" min={1} step={1} inputMode="numeric" defaultValue={p.min_qty} className="input" /></label>
                <label className="field"><span>{C.order}</span><input name="sort_order" type="number" inputMode="numeric" defaultValue={p.sort_order} className="input" /></label>
              </ActionForm>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <Fact label={C.nameEn}>{p.name}</Fact>
                <Fact label={C.nameBg}>{p.name_bg ?? "—"}</Fact>
                <Fact label={C.descriptionEn}>{p.description ?? "—"}</Fact>
                <Fact label={C.descriptionBg}>{p.description_bg ?? "—"}</Fact>
              </div>
            )}
          </Card>

          <Card title={C.prices}>
            <div className="flex flex-col gap-4">
              <p className="m-0 text-sm text-ink-2">{fmt(C.pricesNote, { n: formatNumber(locale, p.min_qty) })}</p>
              {tiers.length === 0 && <Empty>{C.noPrices}</Empty>}
              {tiers.map((tier) => (
                <div key={tier.id} className="row grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center border-b border-mist py-2 text-sm last:border-0">
                  <span>{fmt(C.fromQty, { n: formatNumber(locale, tier.min_qty) })}</span>
                  <span className="font-semibold">{formatMoney(locale, tier.unit_price, "EUR", 2)}</span>
                  {canEdit ? (
                    <form action={removeCatalogTier}>
                      <input type="hidden" name="id" value={tier.id} />
                      <button type="submit" aria-label={fmt(C.removeTier, { n: tier.min_qty })} className="grid h-11 w-11 place-items-center text-lg text-ink-2 hover:text-ink">×</button>
                    </form>
                  ) : <span />}
                </div>
              ))}
              {canEdit && (
                <ActionForm action={addCatalogTier} submitLabel={C.addTier}>
                  <input type="hidden" name="product_id" value={p.id} />
                  <div className="grid min-w-0 grid-cols-2 gap-3">
                    <label className="field"><span>{C.minQty} *</span><input name="min_qty" type="number" min={p.min_qty} step={1} required inputMode="numeric" className="input" /></label>
                    <label className="field"><span>{C.unitPrice} *</span><input name="unit_price" required inputMode="decimal" className="input" /></label>
                  </div>
                </ActionForm>
              )}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title={C.picture}>
            <div className="flex min-w-0 flex-col gap-3 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={picture} alt={fmt(C.pictureOf, { name: displayName })} width={640} height={769}
                   className="mx-auto h-64 w-auto max-w-full rounded-md border border-mist object-contain" />
              {!p.image && <p className="m-0 text-ink-2">{C.noPicture}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {p.image && <a href={p.image} download={pictureFile} className="btn btn-outline">{C.downloadPicture}</a>}
                {canEdit && p.image && (
                  <form action={removeCatalogImage}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="btn btn-outline">{C.removePicture}</button>
                  </form>
                )}
              </div>
              {canEdit && (
                <ActionForm action={uploadCatalogImage} submitLabel={C.replacePicture}>
                  <input type="hidden" name="id" value={p.id} />
                  <label className="field"><span>{C.uploadPicture}</span>
                    <input name="image" type="file" required accept="image/jpeg,image/png,image/webp" aria-describedby="picture-note" className="input" />
                  </label>
                  <p id="picture-note" className="m-0 text-[13px] text-ink-2">{C.pictureNote}</p>
                </ActionForm>
              )}
            </div>
          </Card>
          <Card title={C.publication}>
            <div className="flex flex-col gap-3 text-sm">
              {p.client && <p className="m-0 font-semibold">{fmt(C.clientRecipe, { client: p.client })}</p>}
              {p.extra.length > 0 && <p className="m-0 text-ink-2">{C.alsoIn}: {p.extra.join(", ")}</p>}
              {p.problem && <p className="m-0 text-ink-2">{C.problems[p.problem as "not_approved"] ?? p.problem}</p>}
              {canEdit && (p.is_published ? (
                <form action={unpublishCatalogProduct}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="btn btn-outline">{C.unpublish}</button>
                </form>
              ) : (
                <ActionForm action={publishCatalogProduct} submitLabel={C.publish} resetOnSuccess={false}>
                  <input type="hidden" name="id" value={p.id} />
                </ActionForm>
              ))}
            </div>
          </Card>
          {(p.internal_notes || p.sources) && (
            <Card title={C.internalNotes}>
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                {p.internal_notes && <p className="m-0 break-words whitespace-pre-wrap">{p.internal_notes}</p>}
                {p.sources && <p className="m-0 break-words whitespace-pre-wrap text-ink-2">{p.sources}</p>}
              </div>
            </Card>
          )}
          <Card title={C.recipe}>
            <div className="flex flex-col gap-2 text-sm">
              {p.formula_id
                ? <Link href={`/formulas/${p.formula_id}`} className="font-semibold text-ink">{p.formula_code}</Link>
                : <p className="m-0 font-semibold">{C.noRecipe}</p>}
              <p className="m-0 text-ink-2">{p.formula_id ? C.recipeNote : C.noRecipeNote}</p>
              {recipes.length > 0 && (
                <form action={linkCatalogRecipe} className="flex min-w-0 flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <label htmlFor="link-recipe" className="sr-only">{C.pickRecipe}</label>
                  <select id="link-recipe" name="formula_id" required defaultValue="" className="input min-w-0 flex-1">
                    <option value="" disabled>{C.pickRecipe}</option>
                    {recipes.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                  </select>
                  <button type="submit" className="btn btn-outline">{C.linkRecipe}</button>
                </form>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
