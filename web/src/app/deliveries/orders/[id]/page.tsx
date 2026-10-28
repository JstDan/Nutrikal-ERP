import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, getDict, type Locale } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader, type Tone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { SearchSelect } from "@/components/search-select";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";
import {
  addPurchaseOrderLine, cancelPurchaseOrder, removePurchaseOrderLine, savePurchaseOrder, savePurchaseOrderLine, sendPurchaseOrder,
} from "@/app/purchase-order-actions";

type Po = {
  id: string; code: string; status: "draft" | "sent" | "cancelled"; order_date: string; expected_on: string | null;
  location_id: string | null; location: string | null; currency: string; notes: string | null; sent_at: string | null;
  supplier: string; supplier_address: string | null; supplier_country: string | null; supplier_vat: string | null;
  supplier_contact: string | null; supplier_email: string | null; supplier_phone: string | null;
};
type Line = {
  id: string; item_id: string; sku: string; name: string; name_bg: string | null; base_unit: string;
  quantity: string; unit_price: string | null; delivery_code: string | null;
};
type Seller = { company_name: string; company_id: string; company_vat: string; company_address: string; company_email: string; company_phone: string; logo_data_url: string | null };
type Opt = { id: string; name: string };
type ItemOpt = { id: string; sku: string; name: string; name_bg: string | null; type: string };

const poTone = (s: string): Tone => (s === "sent" ? "green" : s === "draft" ? "amber" : "neutral");

export default async function PurchaseOrderPage({ params }: PageProps<"/deliveries/orders/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireStaff();
  const P = t.purchaseOrders;
  const isAdmin = user.role === "admin";

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const po = (await tx.query<Po>(
      `select o.id, o.code, o.status, o.order_date::text, o.expected_on::text, o.location_id, l.name as location, o.currency, o.notes,
              o.sent_at::text, s.name as supplier, s.address as supplier_address, s.country_code as supplier_country,
              s.vat_number as supplier_vat, s.contact_name as supplier_contact, s.email::text as supplier_email, s.phone as supplier_phone
         from purchase_orders o join suppliers s on s.id = o.supplier_id left join locations l on l.id = o.location_id
        where o.id = $1`, [id])).rows[0];
    if (!po) return null;
    const lines = (await tx.query<Line>(
      `select pl.id, pl.item_id, i.sku, i.name, i.name_bg, i.base_unit, pl.quantity::text, pl.unit_price::text, d.code as delivery_code
         from purchase_order_lines pl join items i on i.id = pl.item_id
         left join expected_deliveries d on d.id = pl.expected_delivery_id
        where pl.purchase_order_id = $1 order by pl.sort_order, i.name`, [id])).rows;
    const seller = (await tx.query<Seller>(
      "select company_name, company_id, company_vat, company_address, company_email, company_phone, logo_data_url from calc_settings limit 1")).rows[0];
    const edit = isAdmin && po.status === "draft"
      ? {
          locations: (await tx.query<Opt>(
            "select id, name from locations where is_active and type <> 'virtual' order by (code = 'NK-WH') desc, name")).rows,
          items: (await tx.query<ItemOpt>(
            "select id, sku, name, name_bg, type from items where is_active and type in ('raw_material', 'excipient', 'packaging') order by type, name")).rows,
        }
      : null;
    return { po, lines, seller, edit };
  });
  if (!data) notFound();
  const { po, lines, seller: s, edit } = data;

  const nm = (o: { name: string; name_bg: string | null }, l: Locale = locale) => (l === "bg" && o.name_bg ? o.name_bg : o.name);
  const unitOf = (u: string, l: Locale = locale) => (u === "pcs" ? getDict(l).common.units : u);
  const money = (n: number | string, l: Locale = locale) => formatPrice(l, n, po.currency, 2);
  const total = lines.reduce((a, x) => a + Number(x.quantity) * Number(x.unit_price ?? 0), 0);

  // The PDF for the supplier, in English or Bulgarian
  const pdf = (l: Locale): ProformaPdfModel => {
    const D = getDict(l).purchaseOrders.pdf;
    return {
      fileName: `${po.code}-${l}.pdf`,
      title: D.title,
      meta: [`${D.number} ${po.code}`, `${D.date}: ${formatDate(l, po.order_date)}`,
        ...(po.expected_on ? [`${D.expected}: ${formatDate(l, po.expected_on)}`] : [])],
      seller: {
        heading: D.supplier,
        lines: [po.supplier, [po.supplier_address, po.supplier_country].filter(Boolean).join(", "),
          po.supplier_vat ? `${D.vatNo}: ${po.supplier_vat}` : "", po.supplier_contact ?? "",
          [po.supplier_email, po.supplier_phone].filter(Boolean).join(" · ")].filter(Boolean),
      },
      buyer: {
        heading: D.buyer,
        lines: [s?.company_name ?? "", s?.company_address ?? "",
          s?.company_id ? `${D.companyId}: ${s.company_id}` : "", s?.company_vat ? `${D.vatNo}: ${s.company_vat}` : "",
          [s?.company_email, s?.company_phone].filter(Boolean).join(" · "),
          po.location ? `${D.deliverTo}: ${po.location}` : ""].filter(Boolean),
      },
      head: [D.description, D.quantity, D.unitPrice, D.amount],
      rows: lines.map((x) => ({
        description: nm(x, l),
        note: fmt(D.code, { sku: x.sku }),
        quantity: `${formatNumber(l, x.quantity, 3)} ${unitOf(x.base_unit, l)}`,
        unitPrice: x.unit_price != null ? formatPrice(l, x.unit_price, po.currency, 2) : "—",
        amount: x.unit_price != null ? money(Number(x.quantity) * Number(x.unit_price), l) : "—",
      })),
      totals: [[D.total, money(total, l)]],
      vatNote: null,
      bank: { heading: "", lines: [] },
      notes: po.notes,
      footer: D.footer,
      logoDataUrl: s?.logo_data_url ?? null,
    };
  };

  const draft = po.status === "draft";
  const editable = !!edit;
  const grid = editable
    ? "md:grid-cols-[minmax(0,1.6fr)_130px_130px_110px_44px]"
    : "md:grid-cols-[minmax(0,1.6fr)_130px_130px_110px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/deliveries" className="text-ink-2">{P.back}</Link> / <Link href="/deliveries/orders" className="text-ink-2">{P.title}</Link> / {po.code}</>}
        title={`${po.code} · ${po.supplier}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Chip tone={poTone(po.status)}>{P.statuses[po.status]}</Chip>{formatDate(locale, po.order_date)}</span>}
        actions={lines.length > 0 && (
          <>
            <ProformaPdfButton model={pdf("en")} label={P.pdfEn} errorText={P.downloadFailed} />
            <ProformaPdfButton model={pdf("bg")} label={P.pdfBg} errorText={P.downloadFailed} />
          </>
        )}
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={P.lines} id="po-lines-h">
          <div>
            <div className={`row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
              <span>{P.item}</span><span>{P.quantity}</span><span>{P.unitPrice}</span><span className="text-right">{P.amount}</span>
              {editable && <span><span className="sr-only">{P.remove}</span></span>}
            </div>
            {lines.length === 0 && <div className="py-3"><Empty>{P.noLines}</Empty></div>}
            {lines.map((x) => (
              <div key={x.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 ${grid}`}>
                <div className="min-w-0">
                  <div className="font-semibold break-words">{nm(x)}</div>
                  <div className="text-xs text-ink-2">{x.sku}{x.delivery_code ? ` · ${x.delivery_code}` : ""}</div>
                </div>
                {editable ? (
                  <ActionForm action={savePurchaseOrderLine} submitLabel={t.common.save} resetOnSuccess={false} className="col-span-2 md:col-span-2">
                    <input type="hidden" name="line_id" value={x.id} />
                    <input type="hidden" name="po_id" value={po.id} />
                    <div className="grid grid-cols-2 gap-3">
                      <label className="field"><span className="md:sr-only">{P.quantity} ({unitOf(x.base_unit)})</span>
                        <input name="quantity" type="number" min="0.001" step="any" required defaultValue={Number(x.quantity)} className="input" />
                      </label>
                      <label className="field"><span className="md:sr-only">{P.unitPrice}</span>
                        <input name="unit_price" type="number" min={0} step="any" defaultValue={x.unit_price != null ? Number(x.unit_price) : ""} className="input" />
                      </label>
                    </div>
                  </ActionForm>
                ) : (
                  <>
                    <span>{formatNumber(locale, x.quantity, 3)} {unitOf(x.base_unit)}</span>
                    <span className="hide-sm">{x.unit_price != null ? formatPrice(locale, x.unit_price, po.currency, 2) : "—"}</span>
                  </>
                )}
                <span className="hide-sm text-right font-semibold">{x.unit_price != null ? money(Number(x.quantity) * Number(x.unit_price)) : "—"}</span>
                {editable && (
                  <form action={removePurchaseOrderLine}>
                    <input type="hidden" name="line_id" value={x.id} />
                    <input type="hidden" name="po_id" value={po.id} />
                    <button type="submit" title={P.remove} aria-label={`${P.remove}: ${nm(x)}`}
                      className="inline-flex size-11 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink hover:bg-mist">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </form>
                )}
              </div>
            ))}
            <div className="flex justify-end gap-4 pt-3 text-base font-bold">
              <span>{P.total}</span><span>{money(total)}</span>
            </div>
          </div>

          {editable && edit && (
            <div className="border-t border-mist pt-4">
              <h3 className="m-0 mb-3 text-base font-bold">{P.addLine}</h3>
              <ActionForm action={addPurchaseOrderLine} submitLabel={t.common.add}>
                <input type="hidden" name="po_id" value={po.id} />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_130px_130px]">
                  <label className="field"><span>{P.item} *</span>
                    <SearchSelect name="item_id" required placeholder={t.common.typeToSearch} noResults={t.common.noResults}
                      options={edit.items.map((i) => ({ value: i.id, label: `${nm(i)} · ${i.sku}`, group: t.enums.itemType[i.type as "raw_material"], keywords: `${i.name} ${i.name_bg ?? ""}` }))} />
                  </label>
                  <label className="field"><span>{P.quantity} *</span><input name="quantity" type="number" min="0.001" step="any" required className="input" /></label>
                  <label className="field"><span>{P.unitPrice}</span><input name="unit_price" type="number" min={0} step="any" className="input" /></label>
                </div>
              </ActionForm>
            </div>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title={P.title} id="po-h">
            {editable && edit ? (
              <ActionForm action={savePurchaseOrder} submitLabel={t.common.save} resetOnSuccess={false}>
                <input type="hidden" name="po_id" value={po.id} />
                <label className="field"><span>{P.expectedOn}</span><input name="expected_on" type="date" defaultValue={po.expected_on ?? ""} className="input" /></label>
                <label className="field"><span>{P.location}</span>
                  <select name="location_id" defaultValue={po.location_id ?? ""} className="input">
                    <option value="">—</option>
                    {edit.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="field"><span>{P.notes}</span><textarea name="notes" defaultValue={po.notes ?? ""} className="input" /></label>
              </ActionForm>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <Fact label={P.expectedOn}>{formatDate(locale, po.expected_on)}</Fact>
                <Fact label={P.location}>{po.location ?? "—"}</Fact>
                {po.notes && <Fact label={P.notes}><span className="whitespace-pre-line">{po.notes}</span></Fact>}
              </div>
            )}
          </Card>

          {isAdmin && draft && (
            <Card>
              <p className="m-0 text-sm text-ink-2">{P.sendNote}</p>
              <div className="btn-stack">
                <ActionForm action={sendPurchaseOrder} submitLabel={P.send} resetOnSuccess={false}>
                  <input type="hidden" name="po_id" value={po.id} />
                </ActionForm>
                <ActionForm action={cancelPurchaseOrder} submitLabel={P.cancel} resetOnSuccess={false}>
                  <input type="hidden" name="po_id" value={po.id} />
                </ActionForm>
              </div>
            </Card>
          )}
          {po.status === "sent" && <Card><p className="m-0 text-sm">{fmt(P.sentOn, { date: formatDate(locale, po.sent_at) })} <Link href="/deliveries" className="text-ink">{P.back}</Link></p></Card>}
          {po.status === "cancelled" && <Card><p className="m-0 text-sm">{P.cancelledNote}</p></Card>}
        </div>
      </div>
    </div>
  );
}
