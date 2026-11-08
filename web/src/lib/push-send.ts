// Pushes the waiting notifications to the devices where their people switched notifications on (Web Push).
// Called by the minute job and, a few seconds after a chat message, by the sender's request (owner, Nov 2026:
// phone notifications for the chat). push_claim marks what it returns, so nothing goes twice.
import { asSystem } from "@/lib/db/engine";
import { getDict, type Locale } from "@/lib/i18n";
import { notificationText, type NotificationRow } from "@/lib/notifications";
import { pushConfigured, sendPush } from "@/lib/webpush";

type Job = { notification_id: string; kind: string; params: Record<string, unknown>; link: string | null; locale: string; subscription_id: string; endpoint: string; p256dh: string; auth: string };
const CHAT = ["chat_message", "chat_mention", "chat_reply", "chat_huddle"];

/** p_min_age: what the person read in that time (they were looking) is not pushed. */
export async function pushPending(minAgeSeconds = 5): Promise<{ sent: number; notifications: number; gone: number }> {
  if (!pushConfigured()) return { sent: 0, notifications: 0, gone: 0 };
  const jobs = await asSystem<Job>("select * from push_claim(make_interval(secs => $1))", [minAgeSeconds]);
  const gone: string[] = [], ok: string[] = [];
  let sent = 0;
  for (const j of jobs) {
    const locale: Locale = j.locale === "en" ? "en" : "bg";
    const t = getDict(locale);
    const row: NotificationRow = { id: j.notification_id, kind: j.kind, params: j.params, link: j.link, created_at: "", read_at: null };
    const head = notificationText(row, t, locale);
    const chat = CHAT.includes(j.kind);
    const words = typeof j.params.text === "string" ? j.params.text : "";
    // A chat message reads as in Slack: who and where above, the words below; one notification per conversation
    const channel = chat ? new URL(j.link ?? "/", "https://x").searchParams.get("c") : null;
    try {
      const status = await sendPush(j, {
        title: chat && words ? head : "Nutrikal",
        body: chat && words ? words : head,
        link: j.link ?? "/notifications",
        tag: channel ? `chat-${channel}` : `n${j.notification_id}`,
        urgent: chat,
      });
      if (status === 404 || status === 410) gone.push(j.subscription_id);
      else if (status < 300) { ok.push(j.subscription_id); sent += 1; }
      else console.error("Push", status, new URL(j.endpoint).host);
    } catch (e) {
      console.error("Push", e);
    }
  }
  const ids = [...new Set(jobs.map((j) => j.notification_id))];
  if (gone.length || ok.length) await asSystem("select push_done($1::bigint[], $2::uuid[], $3::uuid[])", [[], [...new Set(gone)], [...new Set(ok)]]);
  return { sent, notifications: ids.length, gone: gone.length };
}
