import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Edge middleware (not proxy.ts: Cloudflare runs edge middleware natively;
// Node proxies are experimental there). Keeps the Supabase sign-in fresh and sends signed-out visitors to /login.
// The real checks are in getSession() and in the database; this is the
// early, optimistic one. Without Supabase settings (local development) it does nothing.
const PUBLIC_PAGE = "/public-catalog";
const PUBLIC_APIS = ["/api/catalog-enquiry", "/api/catalog-chat"];

export async function middleware(request: NextRequest) {
  // The open catalogue: on its own address nothing else of the app can be reached
  const path = request.nextUrl.pathname;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const onCatalogHost = host === (process.env.CATALOG_HOST?.trim() || "catalog.nutrikal.com");
  if (onCatalogHost || path === PUBLIC_PAGE || PUBLIC_APIS.includes(path)) {
    const headers = new Headers(request.headers);
    headers.set("x-nk-public", "1");
    const lang = request.nextUrl.searchParams.get("lang");
    headers.set("x-nk-locale", lang === "bg" || lang === "en" ? lang : /^bg\b/i.test(request.headers.get("accept-language") ?? "") ? "bg" : "en");
    if (PUBLIC_APIS.includes(path)) return NextResponse.next({ request: { headers } });
    const to = request.nextUrl.clone();
    to.pathname = PUBLIC_PAGE;
    return NextResponse.rewrite(to, { request: { headers } });
  }

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
  matcher: ["/((?!_next/static|_next/image|api/cron|.*\.(?:ico|svg|png|jpg|jpeg|webp|pdf)$).*)"],
};
