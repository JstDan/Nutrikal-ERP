import { NextResponse } from "next/server";
import { qPublic } from "@/lib/db/engine";

const MAX_BYTES = 20000;
const MIN_FILL_MS = 2000;

/**
 * An enquiry from the open catalogue. Everything is checked again in catalog_submit_enquiry.
 * A filled hidden field or a form sent at once is a script: it gets a calm answer and nothing is saved.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "invalid" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (body.website || Date.now() - Number(body.started_at) < MIN_FILL_MS) return NextResponse.json({ number: null });
  try {
    const [row] = await qPublic<{ no: string }>("select catalog_submit_enquiry($1::jsonb) as no", [JSON.stringify(body)]);
    if (typeof body.chat_id === "string" && /^[0-9a-f-]{36}$/i.test(body.chat_id)) await qPublic("select catalog_chat_link($1, $2)", [body.chat_id, row.no]);
    return NextResponse.json({ number: row.no });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("catalog_busy")) return NextResponse.json({ error: "busy" }, { status: 429 });
    if (message.includes("catalog_invalid")) return NextResponse.json({ error: "invalid" }, { status: 400 });
    console.error("Catalogue enquiry", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
