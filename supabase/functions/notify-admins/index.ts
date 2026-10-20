// Supabase Edge Function: e-mails a new admin notification through Resend.
// Triggered by a Database Webhook on INSERT into public.notifications
// (Dashboard → Database → Webhooks → table notifications, event INSERT,
// type "Supabase Edge Functions", function notify-admins).
// Secrets: RESEND_API_KEY, MAIL_FROM (e.g. "Nutrikal ERP <erp@nutrikal.com>"),
// APP_URL (https://app.nutrikal.com). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Only notifications of active admins are mailed; each one once (emailed_at).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type Row = { id: number; user_id: string; kind: string; params: Record<string, unknown>; link: string | null; emailed_at: string | null };

const TEXT: Record<"bg" | "en", Record<string, string>> = {
  en: {
    stock_corrected: "Stock corrected by production: {item}, lot {lot} in {location}: {diff}. Reason: {reason}",
    delivery_received: "Delivery {code} received: {quantity} {unit} {item}, lot {lot} (+ {photos} photos)",
    mo_completed: "{code} ready to ship: batch {batch}, {quantity} packs. Materials over the tolerance: {over}",
    open: "Open in Nutrikal ERP",
  },
  bg: {
    stock_corrected: "Корекция от производството: {item}, партида {lot} в {location}: {diff}. Причина: {reason}",
    delivery_received: "Получена доставка {code}: {quantity} {unit} {item}, партида {lot} (+ {photos} снимки)",
    mo_completed: "{code} е готова за изпращане: партида {batch}, {quantity} опаковки. Материали над допустимата разлика: {over}",
    open: "Отвори в Nutrikal ERP",
  },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  const payload = await req.json().catch(() => null);
  const row = payload?.record as Row | undefined;
  if (!row || payload?.table !== "notifications" || row.emailed_at) return new Response("skip");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: user } = await db.from("profiles").select("email, role, locale, is_active").eq("id", row.user_id).single();
  if (!user || user.role !== "admin" || !user.is_active || !user.email) return new Response("not an admin");

  const locale: "bg" | "en" = user.locale === "en" ? "en" : "bg";
  const p = row.params ?? {};
  const item = String((locale === "bg" && p.item_bg) || p.item || "");
  const vars: Record<string, string> = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v ?? "")]));
  vars.item = item;
  const template = TEXT[locale][row.kind];
  if (!template) return new Response("no template");
  const text = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const url = `${Deno.env.get("APP_URL") ?? "https://app.nutrikal.com"}${row.link ?? "/notifications"}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM") ?? "Nutrikal ERP <erp@nutrikal.com>",
      to: [user.email],
      subject: text.length > 110 ? text.slice(0, 107) + "…" : text,
      text: `${text}\n\n${TEXT[locale].open}: ${url}`,
      html: `<p style="font-family:Arial,sans-serif;font-size:15px;color:#222831">${esc(text)}</p>
             <p><a href="${esc(url)}" style="font-family:Arial,sans-serif;color:#222831">${TEXT[locale].open}</a></p>`,
    }),
  });
  if (!res.ok) return new Response(`resend ${res.status}: ${await res.text()}`, { status: 502 });

  await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
  return new Response("sent");
});
