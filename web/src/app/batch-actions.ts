"use server";

// Quality of lots, dispatch, credit and debit notes, general settings.
// Every rule is in the database; these only pass the values on as the user.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { LOT_BUCKET, MAX_FILE_BYTES, newDeliveryPath, putFile } from "@/lib/files";
import { loadSettings } from "@/lib/calculator/db";
import type { ActionState } from "@/app/actions";

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Runs one statement as the user and refreshes the app. */
async function run(sql: string, params: unknown[]): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, sql, params);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.common.saved };
}

// ---------------------------------------------------------------- quality
export async function setLotStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("select set_lot_qc_status($1, $2::qc_status, $3)", [str(fd, "lot_id"), str(fd, "status"), str(fd, "reason")]);
}

export async function attachCoa(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const lot = str(fd, "lot_id");
  const file = fd.get("coa");
  if (!lot || !(file instanceof File) || file.size === 0 || file.size > MAX_FILE_BYTES) return { error: t.quality.coaInvalid };
  const key = newDeliveryPath(lot, file.type);
  if (!key) return { error: t.quality.coaInvalid };
  try {
    await putFile(LOT_BUCKET, key, Buffer.from(await file.arrayBuffer()), file.type);
    await q(user.id, "select set_lot_coa($1, $2)", [lot, key]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.quality.coaSaved };
}

// --------------------------------------------------------------- dispatch
export async function dispatchOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const order = str(fd, "order_id");
  // One row per batch: use_<n> = "lot_id|location_id", qty_<n> = quantity
  const lines: { lot_id: string; location_id: string; quantity: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("use_") || typeof v !== "string") continue;
    const qty = num(fd, "qty_" + k.slice(4));
    const [lot_id, location_id] = v.split("|");
    if (lot_id && location_id && qty) lines.push({ lot_id, location_id, quantity: qty });
  }
  let id: string;
  try {
    const [r] = await q<{ id: string }>(
      user.id, "select dispatch_order($1, $2::date, $3::jsonb, $4, $5, $6, $7) as id",
      [order, str(fd, "dispatched_on"), JSON.stringify(lines), str(fd, "carrier"), str(fd, "tracking"), str(fd, "notes"), fd.get("override") === "on"]);
    id = r.id;
  } catch (e) {
    // No batch chosen: usually none is released yet, so say where that is done
    const msg = errorText(e);
    return { error: msg === "Enter the batches to dispatch" ? t.dispatch.noBatches : msg };
  }
  revalidatePath("/", "layout");
  redirect(`/orders/${order}/delivery/${id}`);
}

// ------------------------------------------------- credit and debit notes
export async function createInvoiceNote(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [r] = await q<{ id: string }>(user.id, "select create_invoice_note($1, $2::invoice_kind, $3) as id",
      [str(fd, "invoice_id"), str(fd, "kind"), str(fd, "reason")]);
    id = r.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/invoices", "layout");
  redirect(`/invoices/${id}`);
}

export async function saveNoteLine(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("select save_note_line($1, $2, $3, $4, $5)",
    [str(fd, "note_id"), str(fd, "line_id"), str(fd, "description"), num(fd, "quantity"), num(fd, "unit_price")]);
}

export async function deleteNoteLine(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select delete_note_line($1, $2)", [str(fd, "note_id"), str(fd, "line_id")]);
  revalidatePath("/invoices", "layout");
}

export async function deleteInvoiceNote(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select delete_invoice_note($1)", [str(fd, "note_id")]);
  revalidatePath("/invoices", "layout");
  redirect("/invoices");
}

// ------------------------------------------------- invoices without an order
export async function createClientInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [r] = await q<{ id: string }>(user.id, "select create_client_invoice($1, $2, $3::date, $4, $5, $6) as id",
      [str(fd, "client_id"), num(fd, "vat_pct"), str(fd, "due_date"), str(fd, "method"), str(fd, "ref"), str(fd, "notes")]);
    id = r.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/invoices", "layout");
  redirect(`/invoices/${id}`);
}

export async function saveInvoiceTerms(_: ActionState, fd: FormData): Promise<ActionState> {
  // The basis is kept only at 0 % VAT: the text of the list, or what the person wrote
  const basis = num(fd, "vat_pct") === 0 ? str(fd, "vat_basis_other") ?? str(fd, "vat_basis") : null;
  return run("select set_client_invoice_terms($1, $2, $3::date, $4::date, $5, $6, $7)",
    [str(fd, "invoice_id"), num(fd, "vat_pct"), str(fd, "tax_date"), str(fd, "due_date"), str(fd, "method"), str(fd, "notes"), basis]);
}

/** Any VAT rate on a draft invoice of an order; at 0 % the reason printed (owner, Nov 2026). */
export async function setInvoiceVatRate(_: ActionState, fd: FormData): Promise<ActionState> {
  const basis = num(fd, "vat_pct") === 0 ? str(fd, "vat_basis_other") ?? str(fd, "vat_basis") : null;
  return run("select set_invoice_vat_rate($1, $2, $3)", [str(fd, "invoice_id"), num(fd, "vat_pct"), basis]);
}

/** A line from the list of services (Settings > Calculator); it can be changed on the draft. */
export async function addServiceLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const preset = (await loadSettings(user.id)).service_presets[Number(str(fd, "service"))];
  if (!preset) return { error: t.invoices.direct.service };
  return run("select save_note_line($1, null, $2, 1, $3)", [str(fd, "note_id"), preset.description, preset.price]);
}

export async function makeProforma(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  const id = str(fd, "invoice_id");
  try {
    await q(user.id, "select proforma_from_draft($1)", [id]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/invoices", "layout");
  redirect(`/invoices/${id}?proforma=1`);
}

export async function copyInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    id = (await q<{ id: string }>(user.id, "select copy_client_invoice($1) as id", [str(fd, "invoice_id")]))[0].id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/invoices", "layout");
  redirect(`/invoices/${id}`);
}

export async function addInvoicePayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("select add_invoice_payment($1, $2::date, $3, $4, $5)",
    [str(fd, "invoice_id"), str(fd, "paid_on"), num(fd, "amount"), str(fd, "method"), str(fd, "note")]);
}

export async function deleteInvoicePayment(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select delete_invoice_payment($1)", [str(fd, "id")]);
  revalidatePath("/invoices", "layout");
}

// --------------------------------------------------------------- settings
export async function saveGeneralSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, `update company_settings set production_variance_pct = $1, require_waybill_photo = $2, expiry_warning_days = coalesce($3, expiry_warning_days), offer_followup_days = coalesce($4, offer_followup_days)`,
      [num(fd, "tolerance"), fd.get("waybill") === "on", num(fd, "expiry_days"), num(fd, "offer_days")]);
    const next = num(fd, "next_invoice");
    if (next) await q(user.id, "update number_series set next_number = $1 where key = 'invoice'", [next]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/settings");
  return { ok: true, message: t.common.saved };
}

/** Share the certificate of a batch with its client in the customer panel, or take it back. */
export async function shareCoa(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select lot_coa_share($1, $2)", [String(fd.get("lot_id") ?? ""), fd.get("on") === "on"]);
  revalidatePath("/quality");
}
