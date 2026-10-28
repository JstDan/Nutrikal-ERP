import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatPrice, formatQty } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { Card, Chip, Empty, PageHeader, type Tone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { DELIVERY_LINES } from "@/lib/deliveries";
import { cancelDelivery, createDeliveries, receiveDelivery, updateDelivery } from "@/app/actions";
import { PhotoInput } from "@/components/photo-input";
import { SearchSelect } from "@/components/search-select";
import { FileGallery, type DeliveryFile } from "@/components/file-gallery";
import { PurchaseShortages, type Shortage } from "@/components/purchase-shortages";
import { PurchaseRequests } from "@/components/purchase-requests";

type Row = {
  id: string; code: string; status: string; item_id: string; sku: string; name: string; name_bg: string | null; base_unit: string;
  supplier_id: string | null; supplier: string | null; quantity: string; received: string; remaining: string; expected_on: string | null; unit_price: string | null;
  currency: string; po_reference: string | null; location_id: string | null; location: string | null; request_code: string | null;
  note: string | null; is_overdue: boolean; is_partial: boolean; closed_at: string | null; days: number | null;
};
type DLot = { delivery_id: string; lot_number: string; quantity: string; received_on: string };
type DFile = DeliveryFile & { delivery_id: string };
type Opt = { id: string; name: string };
type ItemOpt = { id: string; sku: string; name: string; name_bg: string | null; base_unit: string; type: string };
type Req = { id: string; code: string; item_id: string; quantity: string; needed_by: string | null };

const TABS = ["open", "received", "cancelled"] as const;
// a fourth tab: the purchase requests from production
const ALL_TABS = [...TABS, "requests"] as const;
const GROUPS = ["overdue", "week", "later", "none"] as const;

function group(r: Row): (typeof GROUPS)[number] {
  if (r.days === null) return "none";
  if (r.days < 0) return "overdue";
  return r.days <= 7 ? "week" : "later";
}

function statusChip(r: Row, t: Dict): { tone: Tone; text: string } {
  const D = t.deliveries;
  if (r.status === "open") {
    if (r.is_overdue) return { tone: "red", text: D.overdue };
    if (r.is_partial) return { tone: "amber", text: D.partial };
    return { tone: "neutral", text: t.enums.deliveryStatus.open };
  }
  return { tone: r.status === "received" ? "green" : "neutral", text: t.enums.deliveryStatus[r.status as "received"] };
}

export default async function DeliveriesPage({ searchParams }: PageProps<"/deliveries">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const openId = typeof sp.open === "string" && /^[0-9a-f-]{36}$/i.test(sp.open) ? sp.open : null;
  let tab = typeof sp.status === "string" && (ALL_TABS as readonly string[]).includes(sp.status) ? sp.status : "open";
  const requestId = typeof sp.request === "string" && /^[0-9a-f-]{36}$/i.test(sp.request) ? sp.request : null;
  const canEdit = user.role === "admin";
  const D = t.deliveries;

  const data = await withUser(user.id, async (tx) => {
    const canSee = (await tx.query<{ ok: boolean }>("select has_role('admin') or can_see_purchase_prices() as ok")).rows[0]?.ok ?? false;
    // A link to one delivery (e.g. from a notification) opens the tab it is in
    if (openId && canSee) {
      const st = (await tx.query<{ status: string }>("select status from expected_deliveries where id = $1", [openId])).rows[0]?.status;
      if (st) tab = st;
    }
    const rows = canSee && tab !== "requests"
      ? (await tx.query<Row>(
          `select d.id, d.code, d.status, d.item_id, i.sku, i.name, i.name_bg, i.base_unit, d.supplier_id, s.name as supplier,
                  d.quantity::text, d.received::text, d.remaining::text, d.expected_on::text, d.unit_price::text, d.currency,
                  d.po_reference, d.location_id, l.name as location, pr.code as request_code, d.note, d.is_overdue, d.is_partial,
                  d.closed_at::text, (d.expected_on - current_date) as days
             from expected_delivery_overview d
             join items i on i.id = d.item_id
             left join suppliers s on s.id = d.supplier_id
             left join locations l on l.id = d.location_id
             left join purchase_requests pr on pr.id = d.purchase_request_id
            where d.status::text = $1
            order by case when $1 = 'open' then d.expected_on end nulls last, d.closed_at desc nulls last, d.code
            limit 300`,
          [tab],
        )).rows
      : [];
    const lots = rows.length
      ? (await tx.query<DLot>(
          `select l.expected_delivery_id as delivery_id, l.lot_number, m.quantity::text, l.received_on::text
             from lots l join stock_movements m on m.lot_id = l.id and m.type = 'receipt'
            where l.expected_delivery_id = any($1::uuid[]) order by l.lot_number`,
          [rows.map((r) => r.id)],
        )).rows
      : [];
    const files = rows.length
      ? (await tx.query<DFile>(
          `select id, delivery_id, file_name, content_type, kind, uploaded_at::text from delivery_attachments
            where delivery_id = any($1::uuid[]) order by uploaded_at`, [rows.map((r) => r.id)])).rows
      : [];
    const photoRule = (await tx.query<{ on: boolean }>("select require_waybill_photo as on from company_settings limit 1")).rows[0]?.on ?? true;
    const form = canEdit
      ? {
          items: (await tx.query<ItemOpt>(
            "select id, sku, name, name_bg, base_unit, type from items where is_active and type <> 'finished_good' order by type, name")).rows,
          suppliers: (await tx.query<Opt>("select id, name from suppliers where is_active order by name")).rows,
          locations: (await tx.query<Opt>(
            "select id, name from locations where is_active and type <> 'virtual' order by (code = 'NK-WH') desc, (type = 'quarantine') desc, name")).rows,
          request: requestId
            ? (await tx.query<Req>(
                "select id, code, item_id, quantity::text, needed_by::text from purchase_requests where id = $1 and status in ('open', 'ordered')",
                [requestId])).rows[0]
            : undefined,
          shortages: tab === "open"
            ? (await tx.query<Shortage>(
                `select source, purchase_request_id, request_code, item_id, sku, name, name_bg, base_unit, quantity::text,
                        reorder_level::text, available::text, supplier_id, unit_price::text
                   from purchase_shortages order by source = 'request' desc, name`)).rows
            : [],
        }
      : undefined;
    return { canSee, rows, lots, files, photoRule, form };
  });

  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);
  const unit = (u: string) => (u === "pcs" ? t.common.units : u);
  const grid = "md:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_160px] lg:grid-cols-[minmax(0,1.6fr)_110px_repeat(3,minmax(0,1fr))_160px]";
  const head = `row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`;

  const supplierSelect = (r: Row) => (
    <label className="field"><span>{D.supplier}</span>
      <SearchSelect name="supplier_id" emptyLabel="—" defaultValue={r.supplier_id ?? ""} placeholder={t.common.typeToSearch} noResults={t.common.noResults}
        options={(data.form?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
    </label>
  );

  const renderRow = (r: Row) => {
    const chip = statusChip(r, t);
    const lots = data.lots.filter((l) => l.delivery_id === r.id);
    const q = (n: string) => formatQty(locale, n, r.base_unit);
    return (
      <details key={r.id} id={`d-${r.id}`} open={r.id === openId} className="group border-b border-mist last:border-0">
        <summary className={`row cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] py-3.5 text-sm ${grid} [&::-webkit-details-marker]:hidden`}>
          <div className="min-w-0">
            <div className="font-semibold break-words">
              <span aria-hidden="true" className="inline-block w-4 transition-transform group-open:rotate-90">▸</span>
              {nm(r)}
            </div>
            <div className="pl-4 text-xs text-ink-2">
              {r.code}{r.supplier ? ` · ${r.supplier}` : ""}
              <span className="md:hidden"> · {formatDate(locale, r.expected_on)} · {q(r.remaining)}</span>
            </div>
          </div>
          <span className={`hide-sm ${r.is_overdue ? "font-semibold text-red-ink" : ""}`}>{r.expected_on ? formatDate(locale, r.expected_on) : D.noDate}</span>
          <span className="hide-sm text-right">{q(r.quantity)}</span>
          <span className="hide-md text-right">{q(r.received)}</span>
          <span className="hide-md text-right font-bold">{q(r.remaining)}</span>
          <Chip tone={chip.tone}>{chip.text}</Chip>
        </summary>

        <div className="mb-4 flex flex-col gap-4 rounded bg-canvas px-4 py-3 text-sm">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div><div className="text-xs text-ink-2">{D.poReference}</div>{r.po_reference ?? "—"}</div>
            <div><div className="text-xs text-ink-2">{D.location}</div>{r.location ?? "—"}</div>
            <div><div className="text-xs text-ink-2">{D.unitPrice}</div>{r.unit_price != null ? `${formatPrice(locale, r.unit_price, r.currency, 4)} / ${unit(r.base_unit)}` : "—"}</div>
            <div><div className="text-xs text-ink-2">{t.purchasing.code}</div>{r.request_code ? <Link href="/deliveries?status=requests&rs=ordered" className="text-ink">{r.request_code}</Link> : "—"}</div>
            <div className="md:hidden"><div className="text-xs text-ink-2">{D.received}</div>{q(r.received)}</div>
            <div className="md:hidden"><div className="text-xs text-ink-2">{D.remaining}</div>{q(r.remaining)}</div>
          </div>
          {r.note && <p className="m-0 break-words text-ink-2">{r.note}</p>}
          {lots.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-[1px] uppercase text-ink-2">{D.lots}</span>
              {lots.map((l) => (
                <span key={l.lot_number}>{l.lot_number} · {q(l.quantity)} · {formatDate(locale, l.received_on)}</span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-[1px] uppercase text-ink-2">{D.files}</span>
            <FileGallery files={data.files.filter((f) => f.delivery_id === r.id)} locale={locale} empty={D.noFiles} />
          </div>

          {canEdit && r.status === "received" && data.form && (
            <div className="flex flex-col gap-2 rounded border border-line bg-white p-4">
              <h3 className="m-0 text-base font-bold">{D.terms}</h3>
              <p className="m-0 text-[13px] text-ink-2">{D.termsNote}</p>
              <ActionForm action={updateDelivery} submitLabel={t.common.save} resetOnSuccess={false}>
                <input type="hidden" name="delivery_id" value={r.id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {supplierSelect(r)}
                  <label className="field"><span>{D.quantity} *</span><input name="quantity" type="number" min="0.0001" step="any" required defaultValue={Number(r.quantity)} className="input" /></label>
                  <label className="field"><span>{D.unitPrice}</span><input name="unit_price" type="number" min="0" step="any" defaultValue={r.unit_price != null ? Number(r.unit_price) : undefined} className="input" /></label>
                </div>
              </ActionForm>
            </div>
          )}

          {canEdit && r.status === "open" && data.form && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2 rounded border border-line bg-white p-4">
                <h3 className="m-0 text-base font-bold">{D.receive}</h3>
                <p className="m-0 text-[13px] text-ink-2">{D.receiveNote}</p>
                <ActionForm action={receiveDelivery} submitLabel={D.receive}>
                  <input type="hidden" name="delivery_id" value={r.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="field"><span>{D.receiveQty} *</span>
                      <input name="quantity" type="number" min="0.0001" step="any" required defaultValue={Number(r.remaining) > 0 ? Number(r.remaining) : undefined} className="input" />
                    </label>
                    <label className="field"><span>{D.location} *</span>
                      <select name="location_id" required className="input" defaultValue={r.location_id ?? ""}>
                        <option value="" disabled>—</option>
                        {data.form.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>{D.supplierLot}</span><input name="supplier_lot" className="input" /></label>
                    <label className="field"><span>{D.reference}</span><input name="reference" className="input" /></label>
                    <label className="field"><span>{D.manufactured}</span><input name="manufactured_on" type="date" className="input" /></label>
                    <label className="field"><span>{D.expires}</span><input name="expires_on" type="date" className="input" /></label>
                  </div>
                  <PhotoInput name="photos" label={D.photos} hint={D.photosHint} required={data.photoRule}
                    preparing={t.factory.deliveries.preparing} ready={t.factory.deliveries.ready} error={t.factory.deliveries.photoError} />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name="close" className="h-5 w-5" /> {D.close}
                  </label>
                </ActionForm>
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 rounded border border-line bg-white p-4">
                  <h3 className="m-0 text-base font-bold">{D.edit}</h3>
                  <ActionForm action={updateDelivery} submitLabel={t.common.save} resetOnSuccess={false}>
                    <input type="hidden" name="delivery_id" value={r.id} />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {supplierSelect(r)}
                      <label className="field"><span>{D.expectedOn}</span><input name="expected_on" type="date" defaultValue={r.expected_on ?? ""} className="input" /></label>
                      <label className="field"><span>{D.quantity} *</span><input name="quantity" type="number" min="0.0001" step="any" required defaultValue={Number(r.quantity)} className="input" /></label>
                      <label className="field"><span>{D.unitPrice}</span><input name="unit_price" type="number" min="0" step="any" defaultValue={r.unit_price != null ? Number(r.unit_price) : undefined} className="input" /></label>
                      <label className="field"><span>{D.poReference}</span><input name="po_reference" defaultValue={r.po_reference ?? ""} className="input" /></label>
                    </div>
                  </ActionForm>
                </div>
                <div className="flex flex-col gap-2 rounded border border-line bg-white p-4">
                  <p className="m-0 text-[13px] text-ink-2">{D.cancelNote}</p>
                  <ActionForm action={cancelDelivery} submitLabel={D.cancel}>
                    <input type="hidden" name="delivery_id" value={r.id} />
                  </ActionForm>
                </div>
              </div>
            </div>
          )}
        </div>
      </details>
    );
  };

  const form = data.form;
  const reqItem = form?.request ? form.items.find((i) => i.id === form.request!.item_id) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={D.title}
        subtitle={D.subtitle}
        actions={canEdit && (
          <>
            <Link href="/deliveries/orders" className="btn btn-outline">{t.purchaseOrders.open}</Link>
            <Link href="/deliveries/orders#new" className="btn btn-outline">{t.purchaseOrders.newOrder}</Link>
            <a href="#new" className="btn btn-primary">{D.new}</a>
          </>
        )}
      />
      {!canEdit && <p className="m-0 text-sm text-ink-2">{D.readOnly}</p>}
      {form && tab === "open" && <PurchaseShortages rows={form.shortages} suppliers={form.suppliers} locale={locale} t={t} />}

      <nav aria-label={D.status} className="flex flex-wrap gap-1">
        {ALL_TABS.map((s) => (
          <Link
            key={s}
            href={s === "open" ? "/deliveries" : `/deliveries?status=${s}`}
            aria-current={tab === s ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-full border px-3.5 text-[13px] no-underline ${tab === s ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
          >
            {s === "requests" ? D.requestsTab : t.enums.deliveryStatus[s]}
          </Link>
        ))}
      </nav>

      {tab === "requests" ? (
        <PurchaseRequests user={user} locale={locale} t={t} status={typeof sp.rs === "string" ? sp.rs : undefined} />
      ) : !data.canSee ? (
        <Card><Empty>{D.noAccess}</Empty></Card>
      ) : (
        <section aria-label={D.title} className="card px-5 pt-2 pb-3">
          <div className={head}>
            <span>{D.item}</span><span>{D.expectedOn}</span><span className="text-right">{D.expected}</span>
            <span className="hide-md text-right">{D.received}</span><span className="hide-md text-right">{D.remaining}</span><span>{D.status}</span>
          </div>
          {data.rows.length === 0 && <div className="py-4"><Empty>{D.empty}</Empty></div>}
          {tab === "open"
            ? GROUPS.map((g) => {
                const rows = data.rows.filter((r) => group(r) === g);
                return rows.length ? (
                  <div key={g}>
                    <h2 className={`m-0 border-b border-mist pt-4 pb-2 text-xs font-semibold tracking-[1px] uppercase ${g === "overdue" ? "text-red-ink" : "text-ink-2"}`}>
                      {D.groups[g]} · {rows.length}
                    </h2>
                    {rows.map(renderRow)}
                  </div>
                ) : null;
              })
            : data.rows.map(renderRow)}
        </section>
      )}

      {form && (
        <Card title={D.newTitle} id="new">
          <p className="m-0 text-[13px] text-ink-2">
            {form.request ? fmt(D.forRequest, { code: form.request.code }) : D.newNote}
          </p>
          <ActionForm action={createDeliveries} submitLabel={D.submit}>
            {form.request && <input type="hidden" name="purchase_request_id" value={form.request.id} />}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="field"><span>{D.supplier}</span>
                <SearchSelect name="supplier_id" emptyLabel="—" placeholder={t.common.typeToSearch} noResults={t.common.noResults} options={form.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
              </label>
              <label className="field"><span>{D.expectedOn}</span>
                <input name="expected_on" type="date" defaultValue={form.request?.needed_by ?? ""} className="input" />
              </label>
              <label className="field"><span>{D.poReference}</span><input name="po_reference" className="input" /></label>
              <label className="field"><span>{D.location} *</span>
                <select name="location_id" required className="input">
                  {form.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-col gap-3">
              {Array.from({ length: form.request ? 1 : DELIVERY_LINES }, (_, i) => (
                <fieldset key={i} className="m-0 grid grid-cols-1 gap-3 rounded border border-line p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <legend className="px-1 text-xs font-semibold tracking-[1px] uppercase text-ink-2">{fmt(D.line, { n: i + 1 })}</legend>
                  {form.request && reqItem ? (
                    <div className="field">
                      <span>{D.item}</span>
                      <input type="hidden" name="item_0" value={reqItem.id} />
                      <span className="flex min-h-11 items-center font-semibold">{nm(reqItem)} · {reqItem.sku}</span>
                    </div>
                  ) : (
                    <label className="field"><span>{D.item}{i === 0 ? " *" : ""}</span>
                      <SearchSelect name={`item_${i}`} required={i === 0} placeholder={t.common.typeToSearch} noResults={t.common.noResults}
                        options={(["raw_material", "excipient", "packaging", "semi_finished"] as const).flatMap((ty) =>
                          form.items.filter((x) => x.type === ty).map((x) => ({
                            value: x.id, label: `${nm(x)} · ${x.sku} (${x.base_unit})`, group: t.enums.itemType[ty], keywords: `${x.name} ${x.name_bg ?? ""}`,
                          })))} />
                    </label>
                  )}
                  <label className="field"><span>{D.quantity}</span>
                    <input name={`quantity_${i}`} type="number" min="0.0001" step="any" defaultValue={i === 0 && form.request ? Number(form.request.quantity) : undefined} className="input" />
                  </label>
                  <label className="field"><span>{D.unitPrice}</span>
                    <input name={`unit_price_${i}`} type="number" min="0" step="any" className="input" />
                  </label>
                </fieldset>
              ))}
            </div>
            <label className="field"><span>{D.note}</span><input name="note" className="input" /></label>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
