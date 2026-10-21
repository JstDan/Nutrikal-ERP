import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Edge middleware (not proxy.ts: Cloudflare runs edge middleware natively;
// Node proxies are experimental there). Keeps the Supabase sign-in fresh and sends signed-out visitors to /login.
// The real checks are in getSession() and in the database; this is the
// early, optimistic one. Without Supabase settings (local development) it does nothing.
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  if (!data?.claims && path !== "/login") {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    const redirect = NextResponse.redirect(to);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  // Everything except static files, images and the cron route (which has its own secret)
  matcher: ["/((?!_next/static|_next/image|api/cron|.*\.(?:ico|svg|png|jpg|jpeg|webp)$).*)"],
};
