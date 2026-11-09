// The release the server runs (NEXT_PUBLIC_BUILD_ID, set at build time): open pages compare it with their own.
// No sign-in needed and nothing else in it.
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
