/** Sends a question and passes the answer on as it is written. */
export async function streamAnswer(fd: FormData, onText: (text: string) => void): Promise<{ id?: string; error?: string; answer?: string }> {
  const res = await fetch("/api/assistant", { method: "POST", body: fd });
  if (!res.ok || !res.body) return { error: String(res.status) };
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  let rest = "";
  let result: { id?: string; error?: string; answer?: string } = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += value;
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      const m = JSON.parse(line) as { text?: string; reset?: boolean; id?: string; error?: string; answer?: string };
      if (m.reset) text = "";
      if (m.text) text += m.text;
      if (m.reset || m.text) onText(text);
      if (m.id || m.error || m.answer) result = m;
    }
  }
  return result;
}
