import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { q } from "@/lib/db/engine";
import { encryptToken, exchangeCode, mailboxAddress } from "@/lib/gmail";
import { requireRole } from "@/lib/session";

/** Back from Google: keeps the encrypted token of the mailbox. */
export async function GET(req: Request) {
  const { user } = await requireRole("admin");
  const url = new URL(req.url);
  const done = (result: string) => NextResponse.redirect(`${url.origin}/settings/mail?${result}`);
  const jar = await cookies();
  const expected = jar.get("nk_google_state")?.value;
  jar.delete({ name: "nk_google_state", path: "/api/google" });
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return done("error=refused");
  try {
    const t = await exchangeCode(code, `${url.origin}/api/google/callback`);
    if (!t.refresh_token) return done("error=token");
    await q(user.id, "select gmail_connect($1, $2)", [await mailboxAddress(t.access_token), await encryptToken(t.refresh_token)]);
  } catch (e) {
    console.error("Gmail connect", e);
    return done("error=failed");
  }
  return done("connected=1");
}
