"use server";

// Repeat order, preparing production, e-mailing documents.
// Every rule is in the database; these only pass the values on as the user.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import { fmt } from "@/lib/i18n";
import { mailConfigured, sendMail } from "@/lib/mail";
import { GmailSendScopeError } from "@/lib/gmail";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const MAX_PDF_BASE64 = 14_000_000;

export async function copyOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    id = (await q<{ id: string }>(user.id, "select copy_order($1) as id", [str(fd, "order_id")]))[0].id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/orders/${id}`);
}

export async function prepareProduction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const d = t.orders.detail;
  try {
    const [{ r }] = await q<{ r: { created: number; reserved: number; requested: number; no_recipe: string[]; no_servings?: string[] } }>(
      user.id, "select prepare_order_production($1, $2::date) as r", [str(fd, "order_id"), str(fd, "planned_date")]);
    revalidatePath("/", "layout");
    const done = fmt(d.prepared, { created: r.created, reserved: r.reserved, requested: r.requested });
    const notes = [
      r.no_recipe.length ? fmt(d.preparedNoRecipe, { names: r.no_recipe.join(", ") }) : "",
      r.no_servings?.length ? fmt(d.preparedNoServings, { names: r.no_servings.join(", ") }) : "",
    ].filter(Boolean);
    return { ok: true, message: [done, ...notes].join(" ") };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** Out of the list of offers waiting for a reminder. */
export async function closeOfferFollowup(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "insert into calc_offer_closed (offer_id) values ($1) on conflict do nothing", [str(fd, "offer_id")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.common.saved };
}

/** The send is logged before the e-mail leaves, with its result after. */
export async function sendDocument(fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const S = t.send;
  const pdf = str(fd, "pdf");
  const text = str(fd, "body");
  const subject = str(fd, "subject");
  const to = str(fd, "to");
  const cc = str(fd, "cc");
  const fileName = (str(fd, "file_name") ?? "document.pdf").replace(/[\\/:*?"<>|\r\n]+/g, "_");
  if (!(await mailConfigured())) return { error: S.notConfigured };
  // A PDF file starts with %PDF-
  if (!pdf || !pdf.startsWith("JVBERi0") || pdf.length > MAX_PDF_BASE64 || !text || !subject || !to) return { error: S.failed };
  let id: string;
  try {
    id = (await q<{ id: string }>(user.id, "select begin_document_send($1, $2, $3, $4, $5) as id",
      [str(fd, "kind"), str(fd, "ref_id"), to, cc, subject]))[0].id;
  } catch (e) {
    return { error: errorText(e) };
  }
  try {
    // The sender's own signature goes under the message (owner, Nov 2026)
    const [me] = await q<{ email: string | null; signature: string | null }>(user.id,
      "select p.email::text, s.html as signature from profiles p left join mail_signatures s on s.user_id = p.id where p.id = auth.uid()");
    await sendMail({ to, cc, replyTo: me?.email ?? null, subject, text, signature: me?.signature ?? null, attachment: { filename: fileName, base64: pdf } });
  } catch (e) {
    await q(user.id, "select finish_document_send($1, $2)", [id, errorText(e)]);
    revalidatePath("/", "layout");
    return { error: e instanceof GmailSendScopeError ? S.reconnect : S.failed };
  }
  await q(user.id, "select finish_document_send($1)", [id]);
  revalidatePath("/", "layout");
  return { ok: true, message: fmt(S.sent, { to }) };
}
