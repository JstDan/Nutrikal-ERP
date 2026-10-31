import { ask } from "@/lib/ai/ask";
import { requireRole } from "@/lib/session";

/** One question, answered as it is written: a JSON object per line (text, then done or error). */
export async function POST(req: Request) {
  await requireRole("admin", "sales");
  const fd = await req.formData();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
      const r = await ask(fd, (delta) => send(delta === null ? { reset: true } : { text: delta }));
      send(r);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
