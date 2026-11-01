import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { qPublic } from "@/lib/db/engine";
import { aiConfigured } from "@/lib/ai/gateway";
import { salesReply } from "@/lib/ai/catalog-sales";
import type { Turn } from "@/lib/ai/gateway";

const MAX_BYTES = 4000;

/** A daily hash of the address: enough for the limits, and not an address. */
function visitorKey(request: Request) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  return createHash("sha256").update(`${ip}|${new Date().toISOString().slice(0, 10)}|${process.env.AI_API_KEY ?? ""}`).digest("hex");
}

/** One question from the open catalog; the answer comes line by line as JSON. */
export async function POST(request: Request) {
  if (!aiConfigured()) return NextResponse.json({ error: "failed" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "invalid" }, { status: 400 });
  let body: { chat?: string; locale?: string; text?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const chat = /^[0-9a-f-]{36}$/i.test(body.chat ?? "") ? body.chat! : null;
  let turn: { chat: string; history: Turn[] };
  try {
    [{ turn }] = await qPublic<{ turn: { chat: string; history: Turn[] } }>("select catalog_chat_turn($1, $2, $3, $4) as turn", [chat, visitorKey(request), body.locale ?? "en", String(body.text ?? "")]);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("catalog_chat_limit")) return NextResponse.json({ error: "busy" }, { status: 429 });
    if (message.includes("catalog_invalid")) return NextResponse.json({ error: "invalid" }, { status: 400 });
    console.error("Catalog chat", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(out) {
      const send = (x: unknown) => out.enqueue(encoder.encode(`${JSON.stringify(x)}\n`));
      send({ chat: turn.chat });
      try {
        const answer = await salesReply(turn.history, (delta) => send({ delta }), (add) => send({ add }));
        if (answer.text) await qPublic("select catalog_chat_reply($1, $2)", [turn.chat, answer.text]);
        send({ done: true, empty: !answer.text });
      } catch (e) {
        console.error("Catalog chat", e);
        send({ error: "failed" });
      }
      out.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
