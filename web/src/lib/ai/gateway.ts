// The AI models, directly from OpenAI (Responses API): AI_BASE_URL and AI_API_KEY,
// AI_MODELS lists what people can pick ("GPT-6.1 Sol=gpt-6.1-sol,GPT-5.4 mini=gpt-5.4-mini"; the first is the default).

export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
export type Turn = { role: "user" | "assistant"; content: string };
export type RunTool = (name: string, rawArgs: string) => Promise<string>;
export type Answer = { text: string; tokensIn: number; tokensOut: number };

type Json = Record<string, unknown>;
const MAX_TOKENS = 8000;

const baseUrl = () => process.env.AI_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
const apiKey = () => process.env.AI_API_KEY?.trim() ?? "";

export function aiModels(): { label: string; id: string }[] {
  return (process.env.AI_MODELS ?? "").split(",").map((x) => {
    const at = x.indexOf("=");
    return { label: x.slice(0, at).trim(), id: x.slice(at + 1).trim() };
  }).filter((m) => m.label && m.id);
}

export const aiConfigured = () => baseUrl() !== "" && apiKey() !== "" && aiModels().length > 0;

/** One response, streamed: the text goes to onText as it comes; the last event holds all of it. */
async function respond(body: Json, onText?: (delta: string) => void): Promise<Json> {
  const res = await fetch(`${baseUrl()}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += value;
    const events = rest.split("\n\n");
    rest = events.pop() ?? "";
    for (const event of events) {
      const data = event.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
      if (!data || data === "[DONE]") continue;
      const e = JSON.parse(data) as { type: string; delta?: string; response?: Json; message?: string };
      if (e.type === "response.output_text.delta" && e.delta) onText?.(e.delta);
      if (e.type === "response.completed") return e.response ?? {};
      if (e.type === "response.failed" || e.type === "response.incomplete" || e.type === "error") {
        throw new Error(`${e.type} ${e.message ?? JSON.stringify(e.response ?? {}).slice(0, 300)}`);
      }
    }
  }
  throw new Error("The answer stopped");
}

/**
 * A full answer, with the tool calls in between. An empty text means no answer within the rounds.
 * onText gets the text as it is written, and null when what came so far is to be dropped.
 * Tool calls are function_call items; each result is a function_call_output item with the same call_id.
 * store: false: OpenAI keeps no copy of the responses, so the reasoning travels back encrypted with each round.
 */
export async function converse(model: string, system: string, turns: Turn[], tools: ToolDefinition[], run: RunTool, rounds: number, onText?: (delta: string | null) => void): Promise<Answer> {
  const input: Json[] = [{ role: "system", content: system }, ...turns];
  const answer: Answer = { text: "", tokensIn: 0, tokensOut: 0 };
  for (let round = 0; round < rounds; round++) {
    const data = await respond({
      model, input, tool_choice: "auto", store: false, include: ["reasoning.encrypted_content"],
      tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })),
    }, onText) as { output?: Json[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const output = data.output ?? [];
    answer.tokensIn += data.usage?.input_tokens ?? 0;
    answer.tokensOut += data.usage?.output_tokens ?? 0;
    const calls = output.filter((x) => x.type === "function_call");
    if (calls.length === 0) {
      answer.text = output.filter((x) => x.type === "message")
        .flatMap((x) => (x.content as Json[] | undefined) ?? [])
        .filter((p) => p.type === "output_text").map((p) => p.text).join("\n").trim();
      return answer;
    }
    // Text before a tool call is not the answer
    onText?.(null);
    input.push(...output);
    input.push(...await Promise.all(calls.map(async (c) => ({
      type: "function_call_output", call_id: c.call_id, output: await run(String(c.name), String(c.arguments ?? "{}")),
    }))));
  }
  return answer;
}
