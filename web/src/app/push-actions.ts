"use server";

// This device gets the signed-in user's notifications, or no longer (save_push_subscription checks the user).
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscription(sub: Sub, agent: string): Promise<{ ok?: boolean; error?: string }> {
  const { user } = await getSession();
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "Invalid subscription" };
  try {
    await q(user.id, "select save_push_subscription($1, $2, $3, $4)", [sub.endpoint, sub.keys.p256dh, sub.keys.auth, agent.slice(0, 300)]);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { user } = await getSession();
  await q(user.id, "select delete_push_subscription($1)", [endpoint]).catch(() => undefined);
}

/** The bell's number. */
export async function notificationCount(): Promise<number> {
  const { user } = await getSession();
  return (await q<{ n: number }>(user.id, "select count(*)::int as n from notifications where read_at is null"))[0]?.n ?? 0;
}
