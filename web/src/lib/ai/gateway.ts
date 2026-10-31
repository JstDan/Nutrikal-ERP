// The AI models, through one gateway with one key (Kie.ai): AI_BASE_URL and AI_API_KEY choose it,
// AI_MODELS lists what people can pick ("Claude=claude-opus-5-5,ChatGPT=gpt-6-1-sol"; the first is the default).
// The gateway speaks the format of each maker: Claude models the Messages API, GPT models the Responses API.

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

/** The gateway can report a failure with HTTP 200, in the body. */
async function post(path: string, body: Json): Promise<Json> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: false }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as Json;
  if (data.error || (data.code !== undefined && data.code !== 200)) throw new Error(text.slice(0, 300));
  return data;
}

/** Claude: tool calls are tool_use blocks; the reply goes back unchanged, the results in one user message. */
async function claude(model: string, system: string, turns: Turn[], tools: ToolDefinition[], run: RunTool, rounds: number): Promise<Answer> {
  const messages: Json[] = [...turns];
  const answer: Answer = { text: "", tokensIn: 0, tokensOut: 0 };
  for (let round = 0; round < rounds; round++) {
    const data = await post("/claude/v1/messages", {
      model, system, messages, max_tokens: MAX_TOKENS,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    }) as { content?: Json[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const content = data.content ?? [];
    answer.tokensIn += data.usage?.input_tokens ?? 0;
    answer.tokensOut += data.usage?.output_tokens ?? 0;
    const calls = content.filter((b) => b.type === "tool_use");
    if (calls.length === 0) {
      answer.text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return answer;
    }
    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: await Promise.all(calls.map(async (c) => ({
        type: "tool_result", tool_use_id: c.id, content: await run(String(c.name), JSON.stringify(c.input ?? {})),
      }))),
    });
  }
  return answer;
}

/** GPT: tool calls are function_call items; each result is a function_call_output item with the same call_id. */
async function gpt(model: string, system: string, turns: Turn[], tools: ToolDefinition[], run: RunTool, rounds: number): Promise<Answer> {
  const input: Json[] = [{ role: "system", content: system }, ...turns];
  const answer: Answer = { text: "", tokensIn: 0, tokensOut: 0 };
  for (let round = 0; round < rounds; round++) {
    const data = await post("/codex/v1/responses", {
      model, input, tool_choice: "auto",
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
    input.push(...calls);
    input.push(...await Promise.all(calls.map(async (c) => ({
      type: "function_call_output", call_id: c.call_id, output: await run(String(c.name), String(c.arguments ?? "{}")),
    }))));
  }
  return answer;
}

/** A full answer, with the tool calls in between. An empty text means no answer within the rounds. */
export function converse(model: string, system: string, turns: Turn[], tools: ToolDefinition[], run: RunTool, rounds: number): Promise<Answer> {
  return (model.startsWith("claude") ? claude : gpt)(model, system, turns, tools, run, rounds);
}
