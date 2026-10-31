"use server";

import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { fmt } from "@/lib/i18n";
import { syncGmail } from "@/lib/gmail";
import { getSession, requireRole } from "@/lib/session";
import type { ActionState } from "@/app/actions";

export async function syncGmailNow(): Promise<ActionState> {
  await requireRole("admin");
  const { t } = await getSession();
  const r = await syncGmail();
  revalidatePath("/settings/mail");
  return { ok: true, message: fmt(t.adminSettings.mail.synced, { n: r.saved }) };
}

export async function disconnectGmail(): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select gmail_disconnect()");
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  revalidatePath("/settings/mail");
  return { ok: true, message: t.common.saved };
}
