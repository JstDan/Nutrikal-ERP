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

async function post(path: string, body: Json): Promise<Json> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: false }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as Json;
}

/**
 * A full answer, with the tool calls in between. An empty text means no answer within the rounds.
 * Tool calls are function_call items; each result is a function_call_output item with the same call_id.
 * store: false: OpenAI keeps no copy of the responses, so the reasoning travels back encrypted with each round.
 */
export async function converse(model: string, system: string, turns: Turn[], tools: ToolDefinition[], run: RunTool, rounds: number): Promise<Answer> {
  const input: Json[] = [{ role: "system", content: system }, ...turns];
  const answer: Answer = { text: "", tokensIn: 0, tokensOut: 0 };
  for (let round = 0; round < rounds; round++) {
    const data = await post("/responses", {
      model, input, tool_choice: "auto", store: false, include: ["reasoning.encrypted_content"],
      tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })),
    }) as { output?: Json[]; usage?: { input_tokens?: number; output_tokens?: number } };
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
    input.push(...output);
    input.push(...await Promise.all(calls.map(async (c) => ({
      type: "function_call_output", call_id: c.call_id, output: await run(String(c.name), String(c.arguments ?? "{}")),
    }))));
  }
  return answer;
}
