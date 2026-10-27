"use server";

// Purchase orders (admin). Drafts are written directly (row-level security: admin only; the
// triggers lock sent and cancelled orders); generating, sending and cancelling go through the
// database functions.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import type { ActionState } from "@/app/actions";

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v == null ? null : Number(v.replace(",", "."));
};
const path = (id: string | null) => `/deliveries/orders${id ? `/${id}` : ""}`;

/** The ticked missing lines (pick = row index; item_N, qty_N, supplier_N, price_N, request_N) -> one order per supplier. */
export async function generatePurchaseOrders(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const P = t.purchaseOrders;
  const lines = fd.getAll("pick").map(String).map((i) => ({
    item_id: str(fd, `item_${i}`),
    quantity: num(fd, `qty_${i}`),
    supplier_id: str(fd, `supplier_${i}`),
    unit_price: num(fd, `price_${i}`),
    purchase_request_id: str(fd, `request_${i}`),
  }));
  if (!lines.length) return { error: P.pickOne };
  let ids: string[];
  try {
    ids = (await q<{ ids: string[] }>(user.id, "select generate_purchase_orders($1::jsonb) as ids", [JSON.stringify(lines)]))[0].ids;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/deliveries", "layout");
  if (ids.length === 1) redirect(path(ids[0]));
  return { ok: true, message: fmt(P.generated, { n: ids.length }) };
}

export async function savePurchaseOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const id = str(fd, "po_id");
  try {
    await q(user.id, "update purchase_orders set expected_on = $2::date, location_id = $3, notes = $4 where id = $1",
      [id, str(fd, "expected_on"), str(fd, "location_id"), str(fd, "notes")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(path(id));
  return { ok: true, message: t.common.saved };
}

export async function savePurchaseOrderLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "update purchase_order_lines set quantity = $2, unit_price = $3 where id = $1",
      [str(fd, "line_id"), num(fd, "quantity"), num(fd, "unit_price")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(path(str(fd, "po_id")));
  return { ok: true, message: t.common.saved };
}

export async function addPurchaseOrderLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const id = str(fd, "po_id");
  try {
    await q(user.id,
      `insert into purchase_order_lines (purchase_order_id, item_id, quantity, unit_price, sort_order)
       values ($1, $2, $3, $4, (select coalesce(max(sort_order), 0) + 1 from purchase_order_lines where purchase_order_id = $1))`,
      [id, str(fd, "item_id"), num(fd, "quantity"), num(fd, "unit_price")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(path(id));
  return { ok: true, message: t.common.saved };
}

export async function removePurchaseOrderLine(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from purchase_order_lines where id = $1", [str(fd, "line_id")]);
  revalidatePath(path(str(fd, "po_id")));
}

export async function sendPurchaseOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const id = str(fd, "po_id");
  try {
    await q(user.id, "select send_purchase_order($1)", [id]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/deliveries", "layout");
  revalidatePath("/inventory");
  return { ok: true, message: t.common.saved };
}

export async function cancelPurchaseOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const id = str(fd, "po_id");
  try {
    await q(user.id, "select cancel_purchase_order($1)", [id]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/deliveries", "layout");
  return { ok: true, message: t.common.saved };
}
