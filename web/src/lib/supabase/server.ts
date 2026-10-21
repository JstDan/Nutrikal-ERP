// Supabase Auth (email + password) on the server. Sessions live in
// cookies managed by @supabase/ssr; src/proxy.ts refreshes them.
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

/** True when the app signs users in through Supabase (otherwise: local development). */
export function supabaseConfigured(): boolean {
  const auth = !!(url() && anonKey());
  if (auth !== !!process.env.DATABASE_URL) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and DATABASE_URL together (web/.env.local)");
  }
  if (!auth && process.env.NODE_ENV === "production" && process.env.NK_LOCAL_DEMO !== "1") {
    throw new Error("Supabase is not configured: fill in web/.env.local (see .env.example)");
  }
  return auth;
}

export async function supabaseServer() {
  const jar = await cookies();
  return createServerClient(url(), anonKey(), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, c.options);
        } catch {
          // Server Components cannot set cookies; the proxy refreshes the session instead
        }
      },
    },
  });
}

/** Server-only admin client (Storage). Access is always checked in the database first. */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing (web/.env.local)");
  return createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
