import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GMAIL_SCOPE, gmailConfigured, googleAuthUrl } from "@/lib/gmail";
import { requireRole } from "@/lib/session";

/** Admin: on to Google, to sign in with the shared mailbox. */
export async function GET(req: Request) {
  await requireRole("admin");
  const origin = new URL(req.url).origin;
  if (!gmailConfigured()) return NextResponse.redirect(`${origin}/settings/mail?error=config`);
  const state = randomBytes(24).toString("hex");
  (await cookies()).set("nk_google_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/api/google" });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(), redirect_uri: `${origin}/api/google/callback`, response_type: "code",
    scope: GMAIL_SCOPE, access_type: "offline", prompt: "consent select_account", state,
  });
  return NextResponse.redirect(`${googleAuthUrl()}?${params}`);
}
