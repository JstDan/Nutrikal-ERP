import type { ReactNode } from "react";
import Link from "next/link";
import { DispatchCard } from "@/components/dispatch-card";
import { OrderStages } from "@/components/order-stages";
import { ClientFiles } from "@/components/client-files";
import { ClientMessages } from "@/components/client-messages";
import { OrderCorrections } from "@/components/order-corrections";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, Fold, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { orderTone } from "@/lib/status";
import { calcOfferCapsulesSql } from "@/lib/calculator/catalogCapsules";
import { addOrderLine, linkOrderLineFormula, openOrderInvoice, removeOrderLine, saveOrder, setOrderStatus, setOrderTransport } from "@/app/actions";
import { copyOrder, prepareProduction } from "@/app/shortcut-actions";
import { loadBoard, loadTemplates } from "@/lib/tasks";
import { TaskBoard } from "@/components/tasks/board";
import { CancelPayment, ConfirmFinalPayment, ConfirmFirstPayment } from "@/components/tasks/payment-dialog";
import { supabaseConfigured } from "@/lib/supabase/server";
import { deleteOrder } from "@/app/trash-actions";
import { loadContractCard } from "@/lib/contracts";
import { ContractCard } from "@/components/contract-card";
import { OrderClientRequests } from "@/components/order-client-requests";

type Overview = { id: string; code: string; status: string; requested_date: string | null; client: string; client_id: string };
type Line = {
  id: string; quantity: number; project_id: string | null; project_code: string | null; project_name: string | null; formula_id: string | null;
  formula_code: string | null; formula_version: number | null; formula_version_id: string | null; product: string; product_bg: string | null;
  offer_id: string | null; kind: "offer" | "calc_offer" | "service"; calc_offer_id: string | null; calc_offer_no: string | null;
  capsules: number | null;
};
type Approved = { id: string; code: string; name: string; name_bg: string | null; version: number; calc_offer_id: string | null };
type Commercial = {
  currency: string; deposit_pct: string | null; deposit_amount: string | null; vat_pct: string | null; balance_terms: "before_dispatch" | "net_days" | null; balance_net_days: number | null;
  deposit_received_on: string | null; balance_received_on: string | null; customer_ref: string | null; notes: string | null;
  transport_amount: string | null;
};
type Mo = { id: string; code: string; status: string; sales_order_line_id: string; quantity: number; produced_quantity: number | null };
type FinalLine = { line_id: string; kind: string; ordered: number; produced: number | null; quantity: number };
type OfferOption = { offer_id: string; code: string; product: string; product_bg: string | null; quantity: number; unit_price: string };
type Meta = { created_at: string; created_by: string | null; owner: string | null; country: string };
type OrderInvoice = { id: string; purpose: "full" | "advance" | "final"; status: "draft" | "issued"; number: string | null };

// Next steps offered per status (the database decides what is allowed)
const NEXT: Record<string, string[]> = {
  draft: ["confirmed", "cancelled"],
  unpaid: ["confirmed", "cancelled"],
  // in_production comes by itself when a manufacturing order is sent to Production (release_mo)
  confirmed: ["cancelled"],
  in_production: ["ready", "cancelled"],
  // ready: dispatched with its batches on the Dispatch card
  dispatched: ["closed"],
};

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const initialTask = typeof sp.task === "string" ? sp.task : null;
  const { user, locale, t } = await requireStaff();
  const d = t.orders.detail;
  const canEdit = user.role === "admin" || user.role === "sales";
  const isAdmin = user.role === "admin";
  const productName = (l: { product: string; product_bg: string | null }) => (locale === "bg" && l.product_bg ? l.product_bg : l.product);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const o = (await tx.query<Overview>(
      "select id, code, status, requested_date::text, client, client_id from sales_order_overview where id = $1", [id])).rows[0];
    if (!o) return null;
    const lines = (await tx.query<Line>(
      `select l.id, l.quantity, l.project_id, l.project_code, l.project_name, l.formula_id, l.formula_code, l.formula_version, l.formula_version_id,
              l.product, l.product_bg, l.offer_id, l.kind, l.calc_offer_id, l.calc_offer_no, ${calcOfferCapsulesSql("co")} as capsules
         from sales_order_line_overview l left join calc_offers co on co.id = l.calc_offer_id
        where l.order_id = $1 order by l.sort_order`, [id])).rows;
    const mos = (await tx.query<Mo>(
      `select id, code, status, sales_order_line_id, quantity, produced_quantity from manufacturing_orders
        where sales_order_line_id in (select id from sales_order_line_overview where order_id = $1) order by code`, [id])).rows;
    const c = canEdit
      ? (await tx.query<Commercial>(
          `select currency, deposit_pct::text, deposit_amount::text, vat_pct::text, balance_terms, balance_net_days, deposit_received_on::text, balance_received_on::text,
                  customer_ref, notes, transport_amount::text from sales_orders where id = $1`, [id])).rows[0]
      : undefined;
    const prices = canEdit
      ? (await tx.query<{ id: string; unit_price: string; offer_code: string }>(
          `select l.id, l.unit_price::text, of.code as offer_code from sales_order_lines l left join offers of on of.id = l.offer_id
            where l.order_id = $1`, [id])).rows
      : [];
    const offerOptions = canEdit && o.status === "draft"
      ? (await tx.query<OfferOption>(
          `select of.id as offer_id, of.code, f.name as product, f.name_bg as product_bg, t.quantity, t.unit_price::text
             from offers of join offer_tiers t on t.offer_id = of.id
             join formula_versions v on v.id = of.formula_version_id join formulas f on f.id = v.formula_id
            where of.client_id = $1 and of.status in ('sent', 'accepted') and of.project_id is not null and t.unit_price is not null
            order by of.code desc, t.quantity`, [o.client_id])).rows
      : [];
    // Approved formulas a calculator line can be made from (the client's own or general ones)
    const approved = isAdmin && ["confirmed", "in_production"].includes(o.status) && lines.some((l) => l.kind === "calc_offer" && !l.formula_version_id)
      ? (await tx.query<Approved>(
          `select v.id, f.code, f.name, f.name_bg, v.version, f.calc_offer_id from formula_versions v join formulas f on f.id = v.formula_id
            where v.status = 'approved' and (f.client_id is null or f.client_id = $1
                  or f.calc_offer_id in (select calc_offer_id from sales_order_lines where order_id = $2))
            order by f.client_id is null, f.code`, [o.client_id, o.id])).rows
      : [];
    const meta = (await tx.query<Meta>(
      `select so.created_at::text, cp.full_name as created_by, op.full_name as owner, cl.country_code as country
         from sales_orders so join clients cl on cl.id = so.client_id
         left join profiles cp on cp.id = so.created_by left join profiles op on op.id = cl.owner_id
        where so.id = $1`, [id])).rows[0];
    const invoices = canEdit
      ? (await tx.query<OrderInvoice>(
          "select id, purpose, status, number from invoices where order_id = $1 and kind = 'invoice'", [id])).rows
      : [];
    // The final proforma: the units made once every batch is produced, and transport
    const final = canEdit
      ? {
          lines: (await tx.query<FinalLine>("select line_id, kind, ordered, produced, quantity from order_final_lines($1)", [id])).rows,
          totals: (await tx.query<{ net: string; gross: string }>("select net::text, gross::text from order_totals($1)", [id])).rows[0],
          done: (await tx.query<{ done: boolean }>("select order_production_done($1) as done", [id])).rows[0].done,
        }
      : null;
    // The task board: admin and sales only (row-level security returns nothing to anyone else)
    const board = canEdit ? await loadBoard(tx, id) : null;
    const templates = canEdit ? await loadTemplates(tx) : [];
    return { o, lines, mos, c, prices, offerOptions, approved, meta, invoices, board, templates, final };
  });
  if (!data) notFound();
  const { o, lines, mos, c, prices, offerOptions, approved, meta, invoices, board, templates, final } = data;
  const products = lines.filter((l) => l.kind !== "service");
  const services = lines.filter((l) => l.kind === "service");
  // Payment of the proforma: admin confirms it with Confirm first payment (it also makes the task board)
  const next = (NEXT[o.status] ?? []).filter((s) => !(o.status === "unpaid" && s === "confirmed"));

  const price = new Map(prices.map((p) => [p.id, p]));
  const total = lines.reduce((s, l) => s + Number(price.get(l.id)?.unit_price ?? 0) * l.quantity, 0);
  const money = (n: number | string) => formatPrice(locale, n, c?.currency ?? "EUR");
  const isDraft = o.status === "draft";
  const balanceText = c ? fmt(t.enums.balanceTerms[c.balance_terms ?? "before_dispatch"], { days: c.balance_net_days ?? 0 }) : "";

  const T = t.tasks;
  const H = T.header;
  const depPct = Number(c?.deposit_pct ?? 0);
  const gross = Math.round(total * (1 + Number(c?.vat_pct ?? 0) / 100) * 100) / 100;
  // Advance + final payment: the board decides once it exists; before that, the deposit % of the order
  const twoPayments = board ? board.board.payment_mode === "split" : depPct > 0 && depPct < 100;
  const paid = !!c?.deposit_received_on && !["draft", "unpaid", "cancelled"].includes(o.status);
  const paymentText = !c ? "" : !paid ? H.notPaid
    : !twoPayments ? H.paidFull
    : `${c.deposit_amount != null ? fmt(H.advancePaidAmount, { amount: money(c.deposit_amount) }) : fmt(H.advancePaid, { pct: formatNumber(locale, depPct) })} · ${c.balance_received_on ? H.balancePaid : H.balanceDue}`;
  const invoiceOf = (p: OrderInvoice["purpose"]) => invoices.find((x) => x.purpose === p);
  const F = t.orders.final;
  // Documents of the order (owner, Nov 2026): its offers, the proformas and the invoices, each opened from here
  const invoiceDoc = (p: OrderInvoice["purpose"], label: string) => {
    const x = invoiceOf(p);
    return { key: p, label, href: x ? `/invoices/${x.id}` : null, note: x ? (x.status === "draft" ? F.docDraft : x.number ?? "") : F.docNone };
  };
  const offerDocs = [...new Map(products.filter((l) => l.calc_offer_id || l.offer_id).map((l) => [l.calc_offer_id ?? l.offer_id!, l.calc_offer_id
    ? { key: l.calc_offer_id, label: fmt(F.docOffer, { no: l.calc_offer_no ?? "" }), href: `/offers/calc/${l.calc_offer_id}`, note: "" }
    : { key: l.offer_id!, label: F.docOfferOld, href: `/offers/${l.offer_id}`, note: "" }])).values()];
  const docs: { key: string; label: string; href: string | null; note: string }[] = [
    ...offerDocs,
    { key: "proforma", label: twoPayments ? F.docAdvanceProforma : F.docProforma, href: `/orders/${o.id}/proforma`, note: "" },
    ...(twoPayments
      ? [invoiceDoc("advance", F.docAdvanceInvoice),
         { key: "final-proforma", label: F.docFinalProforma, href: final?.done ? `/orders/${o.id}/proforma?final=1` : null, note: final?.done ? "" : F.docFinalPending },
         invoiceDoc("final", F.docFinalInvoice)]
      : [invoiceDoc("full", F.docInvoice)]),
  ];
  // The advance received (VAT included), else its % of the order as ordered
  const advancePaid = c?.deposit_amount != null ? Number(c.deposit_amount) : Math.round(gross * depPct) / 100;
  const finalIssued = invoices.some((x) => (x.purpose === "final" || x.purpose === "full") && x.status === "issued");
  // Once the goods are ready, before they leave (owner, Nov 2026): the invoice due next (the advance one first when it is still open)
  const shipped = ["dispatched", "closed"].includes(o.status);
  const dueInvoice: OrderInvoice["purpose"] | null = !canEdit || !(shipped || o.status === "ready") || finalIssued ? null
    : !twoPayments ? "full" : invoiceOf("advance")?.status !== "issued" ? "advance" : c?.balance_received_on ? "final" : null;
  // The production contract (optional; never holds the order up): Admin and Sales
  const contract = canEdit && o.status !== "cancelled" ? await loadContractCard(user.id, user.name, o.id, o.code) : null;
  const showPrepare = isAdmin && ["confirmed", "in_production"].includes(o.status)
    && products.some((l) => !mos.some((m) => m.sales_order_line_id === l.id && m.status !== "cancelled"));
  const doneTasks = board ? board.tasks.filter((x) => x.status === "done").length : 0;
  // Corrections until a batch is sent to production (the database checks it again)
  const correctable = canEdit && !user.readOnly && ["draft", "unpaid", "confirmed"].includes(o.status)
    && !mos.some((m) => ["released", "in_production", "completed"].includes(m.status));
  const realtime = supabaseConfigured()
    ? { url: process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim() }
    : null;
  // Orders paid before the task manager get their board with Confirm first payment too
  const showFirstPayment = user.canPay && !board && ["unpaid", "confirmed", "in_production", "ready"].includes(o.status);
  const showFinalPayment = user.canPay && twoPayments && paid && !c?.balance_received_on;
  // A payment confirmed by mistake (the database also refuses it once the order is sent to production)
  const showCancelPayment = user.canPay && o.status === "confirmed" && !!c?.deposit_received_on && !invoices.some((x) => x.status === "issued");
  const invoiceButton = (purpose: OrderInvoice["purpose"], label: string) => {
    const inv = invoiceOf(purpose);
    return (
      <ActionForm key={purpose} action={openOrderInvoice} submitLabel={inv?.number ? `${label} · ${inv.number}` : label} resetOnSuccess={false}>
        <input type="hidden" name="order_id" value={o.id} />
        <input type="hidden" name="purpose" value={purpose} />
      </ActionForm>
    );
  };

  const statusButton = (s: string) => (
    <ActionForm key={s} action={setOrderStatus} submitLabel={d.toStatus[s as "confirmed"]} resetOnSuccess={false}>
      <input type="hidden" name="order_id" value={o.id} />
      <input type="hidden" name="status" value={s} />
    </ActionForm>
  );

  // The one thing to do now; everything less common is under Other actions
  const primaryFinal = showFinalPayment && o.status === "ready" && c?.balance_terms !== "net_days";
  const toSend = mos.find((m) => ["simulation", "scheduled"].includes(m.status));
  const unplanned = products.some((l) => !mos.some((m) => m.sales_order_line_id === l.id && m.status !== "cancelled"));
  const note = (text: string) => <p className="m-0 text-sm text-ink-2">{text}</p>;
  const finalPayment = (<>{note(T.payment.finalNote)}<ConfirmFinalPayment orderId={o.id} T={T} /></>);
  const firstPayment = (
    <ConfirmFirstPayment orderId={o.id} T={T} locale={locale} templates={templates} defaultPct={c?.deposit_pct != null ? depPct : null}
      gross={gross} currency={c?.currency ?? "EUR"} />
  );
  let primaryStatus: string | null = null;
  let step: ReactNode = null;
  if (canEdit) {
    if (showFirstPayment && o.status === "unpaid") {
      step = (<>{note(d.unpaidNote)}{firstPayment}</>);
    } else if (o.status === "unpaid") {
      step = note(d.unpaidSales);
    } else if (isDraft) {
      primaryStatus = "confirmed";
      step = statusButton("confirmed");
    } else if (showPrepare) {
      step = (
        <ActionForm action={prepareProduction} submitLabel={d.prepareProduction} resetOnSuccess={false}>
          <input type="hidden" name="order_id" value={o.id} />
          {note(d.prepareNote)}
          <label className="field max-w-[260px]"><span>{d.prepareDate}</span><input name="planned_date" type="date" className="input" /></label>
        </ActionForm>
      );
    } else if (["confirmed", "in_production"].includes(o.status) && unplanned) {
      step = note(d.stepWaitAdmin);
    } else if (["confirmed", "in_production"].includes(o.status) && toSend) {
      step = (<>{note(d.stepSend)}<Link href={`/production/${toSend.id}`} className="btn btn-primary self-start">{fmt(d.openMo, { code: toSend.code })}</Link></>);
    } else if (o.status === "in_production" && final?.done) {
      primaryStatus = "ready";
      step = statusButton("ready");
    } else if (["confirmed", "in_production"].includes(o.status)) {
      step = note(d.stepProducing);
    } else if (primaryFinal) {
      step = finalPayment;
    } else if (o.status === "ready" && !dueInvoice) {
      step = (
        <>
          {note(user.canPay ? d.stepDispatch : t.dispatch.onlyAdmin)}
          {user.canPay && <a href="#dispatch-h" className="btn btn-primary self-start">{t.dispatch.submit}</a>}
        </>
      );
    } else if (dueInvoice) {
      step = (<>{note(shipped ? d.invoiceNoteShipped : d.invoiceNote)}{invoiceButton(dueInvoice, invoiceOf(dueInvoice) ? d.openInvoice : d.makeInvoice)}</>);
    } else if (shipped && showFinalPayment) {
      step = finalPayment;
    } else if (shipped && !finalIssued) {
      step = note(H.finalInvoiceAfter);
    } else if (o.status === "dispatched") {
      primaryStatus = "closed";
      step = statusButton("closed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/orders" className="text-ink-2">{t.orders.title}</Link> / {o.code}</>}
        title={`${o.code} · ${o.client}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as "draft"]}</Chip>
            <span>{t.orders.products}: {products.length}{c ? ` · ${money(total)}` : ""}</span>
          </span>
        }
        actions={(correctable || (canEdit && ["draft", "unpaid"].includes(o.status))) ? (
          <span className="flex flex-wrap gap-2">
            {correctable && <Link href={`/orders/new?edit=${o.id}`} className="btn btn-primary">{d.editOrder}</Link>}
            {canEdit && ["draft", "unpaid"].includes(o.status) && <Link href={`/orders/${o.id}/proforma`} className="btn btn-outline">{d.exportProforma}</Link>}
          </span>
        ) : undefined}
      />

      <section aria-label={o.code} className="card grid grid-cols-2 gap-x-6 gap-y-3 p-5 sm:grid-cols-3 sm:p-6 xl:grid-cols-6">
        <Fact label={H.client}><Link href={`/clients/${o.client_id}`} className="text-ink">{o.client}</Link>{meta?.country ? ` · ${meta.country}` : ""}</Fact>
        {c && <Fact label={H.ref}>{c.customer_ref || "—"}</Fact>}
        <Fact label={H.created}>{formatDate(locale, meta?.created_at.slice(0, 10) ?? null)}{meta?.created_by ? ` · ${meta.created_by}` : ""}</Fact>
        <Fact label={H.owner}>{meta?.owner ?? "—"}</Fact>
        {c && <Fact label={H.payment}>{paymentText}</Fact>}
        {board && <Fact label={H.progress}>{fmt(T.progress, { done: doneTasks, total: board.tasks.length })}</Fact>}
      </section>

      {o.status !== "cancelled" && (
        <section aria-label={t.orders.stages.label} className="card p-5 sm:p-6">
          <OrderStages t={t} done={{
            paid: paid || ["confirmed", "in_production", "ready", "dispatched", "closed"].includes(o.status),
            planned: mos.some((m) => m.status !== "cancelled"),
            produced: !!final?.done || ["ready", "dispatched", "closed"].includes(o.status),
            ready: ["ready", "dispatched", "closed"].includes(o.status),
            dispatched: shipped,
            invoiced: finalIssued,
            closed: o.status === "closed",
          }} />
        </section>
      )}

      {step && <Card title={d.nextStep} id="next-h" className="border-ink">{step}</Card>}

      <Card title={d.lines} id="lines-h">
        {products.length === 0 && <Empty>{d.noLines}</Empty>}
        {products.map((l) => {
          const p = price.get(l.id);
          const lineMos = mos.filter((m) => m.sales_order_line_id === l.id);
          return (
            <div key={l.id} className="flex flex-col gap-3 border-b border-mist pb-4 last:border-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-[1_1_240px]">
                  <div className="font-semibold break-words">
                    {l.capsules ? fmt(d.withCapsules, { name: productName(l), n: formatNumber(locale, l.capsules) }) : productName(l)}
                  </div>
                  <div className="text-xs text-ink-2">
                    {l.kind === "calc_offer" && l.calc_offer_id && (
                      <Link href={`/offers/calc/${l.calc_offer_id}`} className="text-ink-2">{fmt(d.calcOffer, { no: l.calc_offer_no ?? "" })}</Link>
                    )}
                    {l.formula_code && <>{l.kind === "calc_offer" && " · "}{l.project_code} · {l.project_name} · {fmt(t.offers.detail.formulaVersion, { code: l.formula_code, n: l.formula_version ?? 0 })}</>}
                    {l.offer_id && p?.offer_code && <> · <Link href={`/offers/${l.offer_id}`} className="text-ink-2">{p.offer_code}</Link></>}
                  </div>
                </div>
                {isDraft && canEdit && (
                  <form action={removeOrderLine}>
                    <input type="hidden" name="line_id" value={l.id} />
                    <input type="hidden" name="order_id" value={o.id} />
                    <button type="submit" className="btn btn-outline" aria-label={`${d.remove}: ${productName(l)}`}>{d.remove}</button>
                  </form>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                <Fact label={d.quantity}>{formatNumber(locale, l.quantity)} {t.common.units}</Fact>
                {p && <Fact label={d.unitPrice}>{money(p.unit_price)}</Fact>}
                {p && <Fact label={d.lineTotal}><strong>{money(Number(p.unit_price) * l.quantity)}</strong></Fact>}
                <Fact label={d.production}>
                  {lineMos.length === 0 ? "—" : (
                    <span className="flex flex-col gap-1">
                      {lineMos.map((m) => (
                        <Link key={m.id} href={`/production/${m.id}`} className="text-ink">
                          {m.code} · {t.enums.moStatus[m.status as "simulation"]}{m.status === "completed" && m.produced_quantity != null ? ` · ${formatNumber(locale, m.produced_quantity)} ${t.common.units}` : ""}
                        </Link>
                      ))}
                    </span>
                  )}
                </Fact>
              </div>
              {isAdmin && l.kind === "calc_offer" && !l.formula_version_id && ["confirmed", "in_production"].includes(o.status) && (
                <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
                  <div className="text-sm font-semibold">{d.formula}</div>
                  <p className="m-0 text-[13px] text-ink-2">{d.formulaHint}</p>
                  {approved.length === 0 ? (
                    <p className="m-0 text-[13px] font-semibold">{d.noApproved} <Link href="/formulas" className="text-ink">{t.nav.formulas}</Link></p>
                  ) : (
                    <ActionForm action={linkOrderLineFormula} submitLabel={d.linkFormula} resetOnSuccess={false}>
                      <input type="hidden" name="line_id" value={l.id} />
                      <label className="field"><span>{d.chooseFormula} *</span>
                        <select name="formula_version_id" required className="input" defaultValue={approved.find((v) => v.calc_offer_id && v.calc_offer_id === l.calc_offer_id)?.id ?? ""}>
                          <option value="" disabled>—</option>
                          {approved.map((v) => (
                            <option key={v.id} value={v.id}>{fmt(t.offers.detail.formulaVersion, { code: v.code, n: v.version })} · {productName({ product: v.name, product_bg: v.name_bg })}</option>
                          ))}
                        </select>
                      </label>
                    </ActionForm>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {services.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-mist pt-4">
            <h3 className="m-0 text-base font-bold">{t.orders.new.services}</h3>
            {services.map((l) => {
              const p = price.get(l.id);
              return (
                <div key={l.id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-2 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_120px_120px]">
                  <span className="min-w-0 break-words">{l.product}</span>
                  <span className="hide-sm">{formatNumber(locale, l.quantity)} × {p ? money(p.unit_price) : "—"}</span>
                  <strong className="text-right">{p ? money(Number(p.unit_price) * l.quantity) : ""}</strong>
                </div>
              );
            })}
          </div>
        )}
        {isDraft && canEdit && offerOptions.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-mist pt-4">
            <h3 className="m-0 text-base font-bold">{d.addLine}</h3>
            <p className="m-0 text-[13px] text-ink-2">{d.addLineNote}</p>
            <ActionForm action={addOrderLine} submitLabel={t.common.add}>
              <input type="hidden" name="order_id" value={o.id} />
              <label className="field"><span>{d.chooseOffer} *</span>
                <select name="offer_quantity" required className="input" defaultValue="">
                  <option value="" disabled>—</option>
                  {offerOptions.map((x) => (
                    <option key={x.offer_id + x.quantity} value={`${x.offer_id}|${x.quantity}`}>
                      {x.code} · {productName(x)} · {formatNumber(locale, x.quantity)} × {money(x.unit_price)}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          </div>
        )}
      </Card>

      <DispatchCard orderId={o.id} status={o.status} isAdmin={user.canPay} userId={user.id} locale={locale} t={t}
        balanceDue={!!c && c.balance_terms === "before_dispatch" && !c.balance_received_on} />

      {contract && (
        <Fold title={t.contract.title} open={!!contract.k && contract.k.status !== "signed"}>
          <ContractCard orderId={o.id} k={contract.k} comments={contract.comments} versions={contract.versions} seller={contract.seller} link={contract.link}
            canSign={isAdmin && !user.readOnly} canEdit={!user.readOnly} send={contract.send} sendText={t.send} C={t.contract} locale={locale} />
        </Fold>
      )}
      <OrderClientRequests orderId={o.id} clientId={o.client_id} userId={user.id} locale={locale} t={t}
        canHandle={!user.readOnly && (user.role === "admin" || user.role === "sales")}
        canSendLabels={!user.readOnly && (user.role === "admin" || user.role === "sales" || user.access === "designer")} />
      <ClientFiles clientId={o.client_id} orderId={o.id} userId={user.id} isAdmin={isAdmin} canShare={!user.readOnly && (user.role === "admin" || user.role === "sales")} locale={locale} t={t} />

      {(user.role === "admin" || user.role === "sales") && <ClientMessages clientId={o.client_id} orderId={o.id} userId={user.id} canWrite={!user.readOnly} locale={locale} t={t} />}

      {canEdit && board && (
        <Fold title={T.title} note={fmt(T.progress, { done: doneTasks, total: board.tasks.length })} open={!!initialTask}>
          <TaskBoard orderId={o.id} locale={locale} userId={user.id} isAdmin={isAdmin} data={board} T={T}
            templates={templates} initialTask={initialTask} realtime={realtime} />
        </Fold>
      )}
      {canEdit && !board && !["draft", "unpaid", "cancelled"].includes(o.status) && (
        <Fold title={T.title}><Empty>{isAdmin ? T.legacyAdmin : T.legacySales}</Empty></Fold>
      )}

      {c && canEdit && o.status !== "cancelled" && (
        <Fold title={F.title}>
          <p className="m-0 text-sm text-ink-2">{F.docsNote}</p>
          <div className="flex min-w-0 flex-col">
            {docs.map((x) => (
              <div key={x.key} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 border-b border-mist py-1 text-sm last:border-0">
                {x.href
                  ? <Link href={x.href} className="min-w-0 font-semibold break-words text-ink">{x.label}</Link>
                  : <span className="min-w-0 break-words text-ink-2">{x.label}</span>}
                {x.note && <span className="text-ink-2">{x.note}</span>}
              </div>
            ))}
          </div>
          {final && paid && (
            <>
              <p className="m-0 mt-2 text-sm font-semibold">{F.finalTitle}</p>
              <p className="m-0 text-sm text-ink-2">{final.done ? F.done : F.pending}</p>

            {final.done && products.map((l) => {
              const x = final.lines.find((y) => y.line_id === l.id);
              return x ? (
                <div key={l.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="min-w-0 break-words">{productName(l)}</span>
                  <span className="font-semibold">{fmt(F.orderedProduced, { ordered: formatNumber(locale, x.ordered), produced: formatNumber(locale, x.quantity) })}</span>
                </div>
              ) : null;
            })}
            {!finalIssued && (
              <ActionForm action={setOrderTransport} submitLabel={t.common.save} resetOnSuccess={false}>
                <input type="hidden" name="order_id" value={o.id} />
                <label className="field"><span>{F.transport}</span>
                  <input name="transport" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={c.transport_amount ?? ""} className="input" />
                </label>
                <p className="m-0 text-xs text-ink-2">{F.transportNote}</p>
              </ActionForm>
            )}
            {finalIssued && <Fact label={F.transport}>{c.transport_amount ? money(c.transport_amount) : "—"}</Fact>}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 xl:grid-cols-1">
              <Fact label={F.total}>{money(final.totals?.gross ?? 0)}</Fact>
              {twoPayments && <Fact label={F.advance}>{money(advancePaid)}</Fact>}
              {twoPayments && <Fact label={F.due}><strong>{money(Math.max(0, Number(final.totals?.gross ?? 0) - advancePaid))}</strong></Fact>}
            </div>
            </>
          )}
        </Fold>
      )}

      {c && correctable && (
        <OrderCorrections orderId={o.id} clientId={o.client_id} currency={c.currency} vatPct={c.vat_pct}
          balanceTerms={c.balance_terms} balanceNetDays={c.balance_net_days} userId={user.id} locale={locale} t={t} />
      )}

      {c ? (
        <Fold title={d.payments} note={paymentText}>
          <p className="m-0 text-sm">
            {c.deposit_amount != null ? <>{fmt(d.depositAmount, { amount: money(c.deposit_amount) })} · </>
              : c.deposit_pct != null && Number(c.deposit_pct) > 0 && <>{fmt(d.depositAmount, { amount: money(total * Number(c.deposit_pct) / 100) })} · </>}
            {balanceText}
          </p>
          <ActionForm action={saveOrder} submitLabel={t.common.save} resetOnSuccess={false}>
            <input type="hidden" name="order_id" value={o.id} />
            <div className="grid grid-cols-1 gap-3">
              <label className="field"><span>{d.depositPct}</span><input name="deposit_pct" type="number" min={0} max={100} step="any" defaultValue={c.deposit_pct ?? ""} className="input" /></label>
              {isAdmin ? (
                <>
                  <label className="field"><span>{d.depositReceived}</span><input name="deposit_received_on" type="date" defaultValue={c.deposit_received_on ?? ""} className="input" /></label>
                  <label className="field"><span>{d.balanceReceived}</span><input name="balance_received_on" type="date" defaultValue={c.balance_received_on ?? ""} className="input" /></label>
                </>
              ) : (
                <>
                  <Fact label={d.depositReceived}>{formatDate(locale, c.deposit_received_on)}</Fact>
                  <Fact label={d.balanceReceived}>{formatDate(locale, c.balance_received_on)}</Fact>
                  <p className="m-0 text-xs text-ink-2">{d.datesAdminOnly}</p>
                </>
              )}
              <label className="field"><span>{d.requested}</span><input name="requested_date" type="date" defaultValue={o.requested_date ?? ""} className="input" /></label>
              <label className="field"><span>{d.customerRef}</span><input name="customer_ref" defaultValue={c.customer_ref ?? ""} className="input" /></label>
              <label className="field"><span>{d.notes}</span><textarea name="notes" defaultValue={c.notes ?? ""} className="input" /></label>
            </div>
          </ActionForm>
        </Fold>
      ) : (
        <Fold title={d.payments}>
          <Fact label={d.requested}>{formatDate(locale, o.requested_date)}</Fact>
        </Fold>
      )}

      {canEdit && (
        <Fold title={d.moreActions}>
          {/* Paid: the invoice replaces the proforma */}
          {!["draft", "unpaid", "cancelled"].includes(o.status) && (twoPayments ? (
            <div className="flex flex-wrap items-start gap-3">
              {invoiceButton("advance", H.advanceInvoice)}
              {c?.balance_received_on && invoiceButton("final", H.finalInvoice)}
            </div>
          ) : invoiceButton("full", d.exportInvoice))}
          {/* Orders paid before the task manager get their board here */}
          {showFirstPayment && o.status !== "unpaid" && firstPayment}
          {showFinalPayment && !primaryFinal && !shipped && <ConfirmFinalPayment orderId={o.id} T={T} />}
          {showCancelPayment && <CancelPayment orderId={o.id} T={T} />}
          {next.filter((x) => x !== primaryStatus).map((x) => statusButton(x))}
          <ActionForm action={copyOrder} submitLabel={d.repeatOrder} resetOnSuccess={false}>
            <input type="hidden" name="order_id" value={o.id} />
            <p className="m-0 text-sm text-ink-2">{d.repeatNote}</p>
          </ActionForm>
        </Fold>
      )}

      {/* Admin deletes an order before production; it waits in the trash 30 days (the database checks the rest) */}
      {isAdmin && !user.readOnly && ["draft", "unpaid", "confirmed", "cancelled"].includes(o.status) && (
        <Fold title={t.orderDelete.title}>
          <p className="m-0 text-sm text-ink-2">{t.orderDelete.note}</p>
          <details>
            <summary className="btn btn-outline w-fit cursor-pointer list-none text-red-ink">{t.orderDelete.button}</summary>
            <div className="mt-2 flex max-w-[420px] flex-col gap-2 rounded-sm border border-red-line bg-red-tint p-3">
              <p className="m-0 text-sm font-semibold text-red-ink">{fmt(t.orderDelete.confirm, { code: o.code })}</p>
              <ActionForm action={deleteOrder} submitLabel={t.orderDelete.button} resetOnSuccess={false}>
                <input type="hidden" name="order_id" value={o.id} />
              </ActionForm>
            </div>
          </details>
        </Fold>
      )}
    </div>
  );
}
