import { timingSafeEqual } from "node:crypto";
import { asSystem } from "@/lib/db/engine";
import { fmt, getDict, type Locale } from "@/lib/i18n";
import { mailConfigured, sendMail } from "@/lib/mail";

type Job = { id: string; status: string; code: string; email: string; locale: string | null };

// Hourly: tells clients with an account that their order has moved on. Authorization: Bearer <CRON_SECRET>.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  if (!mailConfigured()) return Response.json({ sent: 0, skipped: "mail not configured" });

  const url = `https://${process.env.PORTAL_HOST?.trim() || "portal.nutrikal.com"}`;
  const jobs = await asSystem<Job>("select id, status, code, email, locale from client_status_jobs()");
  let sent = 0;
  for (const j of jobs) {
    const l: Locale = j.locale === "bg" ? "bg" : "en";
    const t = getDict(l);
    const status = t.enums.orderStatus[j.status as "ready"] ?? j.status;
    const next = t.portal.next[j.status as "ready"] ?? "";
    await sendMail({
      to: j.email, cc: null, replyTo: null,
      subject: fmt(t.portal.staff.statusSubject, { code: j.code, status }),
      text: fmt(t.portal.staff.statusBody, { code: j.code, status, next, url }),
    }).then(() => { sent += 1; }).catch((e) => console.error("Status mail", e));
  }
  await asSystem("select client_status_done()");
  return Response.json({ sent });
}
