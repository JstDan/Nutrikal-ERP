import { timingSafeEqual } from "node:crypto";
import { asSystem } from "@/lib/db/engine";
import { getDict, type Locale } from "@/lib/i18n";
import { notificationText, type NotificationRow } from "@/lib/notifications";
import { pushConfigured, sendPush } from "@/lib/webpush";

type Job = { notification_id: string; kind: string; params: Record<string, unknown>; link: string | null; locale: string; subscription_id: string; endpoint: string; p256dh: string; auth: string };

// Every minute: new notifications go to the devices where their users switched notifications on (Web Push).
// Authorization: Bearer <CRON_SECRET>.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  if (!pushConfigured()) return Response.json({ sent: 0, skipped: "push not configured" });

  const jobs = await asSystem<Job>("select * from push_jobs()");
  const gone: string[] = [], ok: string[] = [];
  let sent = 0;
  for (const j of jobs) {
    const locale: Locale = j.locale === "en" ? "en" : "bg";
    const t = getDict(locale);
    const row: NotificationRow = { id: j.notification_id, kind: j.kind, params: j.params, link: j.link, created_at: "", read_at: null };
    try {
      const status = await sendPush(j, { title: "Nutrikal", body: notificationText(row, t, locale), link: j.link ?? "/notifications", tag: `n${j.notification_id}` });
      if (status === 404 || status === 410) gone.push(j.subscription_id);
      else if (status < 300) { ok.push(j.subscription_id); sent += 1; }
      else console.error("Push", status, new URL(j.endpoint).host);
    } catch (e) {
      console.error("Push", e);
    }
  }
  const ids = [...new Set(jobs.map((j) => j.notification_id))];
  if (ids.length) await asSystem("select push_done($1::bigint[], $2::uuid[], $3::uuid[])", [ids, [...new Set(gone)], [...new Set(ok)]]);
  return Response.json({ sent, notifications: ids.length, gone: gone.length });
}
