import { redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import { getSession, homeFor } from "@/lib/session";

// Open a notification: mark it read and go to the page it is about.
export async function GET(_req: Request, ctx: RouteContext<"/notifications/[id]">) {
  const { id } = await ctx.params;
  const { user } = await getSession();
  if (!/^\d+$/.test(id)) redirect("/notifications");
  const [n] = await q<{ link: string | null }>(user.id, "select link from notifications where id = $1", [id]);
  if (!n) redirect("/notifications");
  await q(user.id, "select mark_notifications_read(array[$1::bigint])", [id]);
  // Only app-internal links
  redirect(n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : homeFor(user.role));
}
