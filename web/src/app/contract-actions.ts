"use server";

// Production contracts (owner, Nov 2026). The team's actions run as the signed-in user (the database checks the
// role); the private link runs as anon and reaches only contract_public / contract_comment_public / contract_accept.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { q, qPublic } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

export type ContractResult = { ok?: boolean; error?: string; token?: string };
const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

const OPS = {
  make: "select create_order_contract($1, $2, $3) as r",
  save: "select save_order_contract($1, $2) as r",
  refresh: "select refresh_contract_schedule($1) as r",
  comment: "select add_contract_comment($1, $2) as r",
  sent: "select mark_order_contract_sent($1) as r",
  cancel: "select cancel_order_contract($1) as r",
  signed: "select mark_order_contract_signed($1) as r",
} as const;
export type ContractOp = keyof typeof OPS;

/** The client's country named in the contract's language ("Germany" / "Германия", not "DE"). */
async function countryName(orderId: string, locale: "bg" | "en", userId: string) {
  const [row] = await q<{ code: string }>(userId, "select c.country_code as code from sales_orders so join clients c on c.id = so.client_id where so.id = $1", [orderId]);
  if (!row?.code) return null;
  try { return new Intl.DisplayNames([locale === "bg" ? "bg" : "en"], { type: "region" }).of(row.code) ?? row.code; } catch { return row.code; }
}

/** One step on the contract of an order; the order page is refreshed. */
export async function contractOp(orderId: string, op: ContractOp, id: string, text?: string): Promise<ContractResult> {
  const { user } = await getSession();
  if (!uuid(orderId) || !uuid(id) || !OPS[op]) return { error: "Unknown action" };
  const params = op === "make" ? [id, text === "bg" || text === "en" ? text : null, await countryName(id, text === "bg" ? "bg" : "en", user.id)]
    : op === "save" || op === "comment" ? [id, text ?? ""] : [id];
  try {
    const [row] = await q<{ r: string | null }>(user.id, OPS[op], params);
    revalidatePath(`/orders/${orderId}`);
    return { ok: true, token: op === "sent" ? row?.r ?? undefined : undefined };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** Admin: the template in one language (Settings > Contract). */
export async function saveContractTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const locale = fd.get("locale") === "bg" ? "bg" : "en";
  const body = String(fd.get("body") ?? "");
  try {
    const rows = await q(user.id, "update contract_templates set body = $2 where locale = $1 returning locale", [locale, body]);
    if (!rows.length) return { error: t.boards.notAllowed };
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/settings/contract");
  return { ok: true, message: t.contract.settings.saved };
}

// ------------------------------------------------------------ the private link (no sign-in)
async function visitor() {
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return { ip, agent: h.get("user-agent") ?? "" };
}

export async function acceptContract(token: string, name: string, title: string, email: string): Promise<ContractResult> {
  if (!uuid(token)) return { error: "Not found" };
  const v = await visitor();
  try {
    await qPublic("select contract_accept($1, $2, $3, $4, $5, $6)", [token, name, title, email, v.ip, v.agent]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/contract/${token}`);
  return { ok: true };
}

export async function commentContract(token: string, name: string, email: string, body: string): Promise<ContractResult> {
  if (!uuid(token)) return { error: "Not found" };
  try {
    await qPublic("select contract_comment_public($1, $2, $3, $4)", [token, name, email, body]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/contract/${token}`);
  return { ok: true };
}
