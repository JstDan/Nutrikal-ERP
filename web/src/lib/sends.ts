import { q } from "@/lib/db/engine";
import { mailConfigured } from "@/lib/mail";
import { fmt, getDict } from "@/lib/i18n";
import type { SendInfo, SendKind } from "@/components/send-document";

/** What the send card shows: the proposed e-mail in the document's language and the earlier sends of the document. */
export async function loadSendInfo(userId: string, userName: string, kind: SendKind, refId: string, o: {
  to?: string | null; orderId?: string; title: string; no: string; lang: "bg" | "en";
}): Promise<SendInfo> {
  const history = await q<SendInfo["history"][number]>(
    userId,
    `select s.id, s.recipient, s.status, s.error, s.created_at::text, p.full_name as sender
       from document_sends s left join profiles p on p.id = s.sent_by
      where s.ref_id = $1 and s.kind = $2 order by s.created_at desc limit 10`, [refId, kind]);
  const client = o.orderId
    ? (await q<{ email: string | null }>(
        userId,
        `select coalesce(nullif(c.billing_email::text, ''),
                  (select ct.email::text from contacts ct where ct.client_id = c.id and ct.email is not null order by ct.is_primary desc, ct.created_at limit 1)) as email
           from sales_orders so join clients c on c.id = so.client_id where so.id = $1`, [o.orderId]))[0]?.email
    : null;
  const M = getDict(o.lang).send.mail;
  const values = { title: o.title, no: o.no, lower: o.title.toLocaleLowerCase(o.lang), name: userName };
  return {
    kind, refId, history, configured: mailConfigured(), to: o.to ?? client ?? "",
    subject: fmt(M.subject, values), body: fmt(M.body, values),
  };
}
