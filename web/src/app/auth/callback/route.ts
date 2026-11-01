import { redirect } from "next/navigation";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

// The link in the password e-mail: exchanges its one-time code for a session, then asks for the new password.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code || !supabaseConfigured()) redirect("/login");
  const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
  redirect(error ? "/forgot-password" : "/reset-password");
}
