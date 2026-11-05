"use server";

// E-mail signatures: everyone saves their own, Admin anyone's (the rule is in mail_signature_set()).
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { cleanSignature } from "@/lib/signature";

export async function saveSignature(userId: string, html: string): Promise<{ ok?: boolean; error?: string }> {
  const { user, t } = await getSession();
  const S = t.signature;
  if (user.readOnly) return { error: t.common.readOnly };
  const clean = cleanSignature(html);
  if (html.trim() && !clean) return { error: S.invalid };
  try {
    await q(user.id, "select mail_signature_set($1, $2)", [userId, clean]);
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  revalidatePath("/signature");
  revalidatePath("/settings/users");
  return { ok: true };
}
