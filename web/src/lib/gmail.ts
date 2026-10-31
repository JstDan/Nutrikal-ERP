import { asSystem } from "@/lib/db/engine";

// The shared mailbox, read only. Connected once by Admin; the job brings new mail, oldest pages first served
// by Gmail newest first, a few pages per run. GOOGLE_STUB_URL replaces Google's addresses in tests.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const PAGES_PER_RUN = 3;
const PER_PAGE = 50;
const MAX_BODY = 20000;
/** Gmail limits the cost of requests per minute: one message at a time, with a pause. */
const PAUSE_MS = 500;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stub = () => process.env.GOOGLE_STUB_URL?.trim().replace(/\/+$/, "") ?? "";
const url = (host: string, path: string) => `${stub() || host}${path}`;
export const googleAuthUrl = () => url("https://accounts.google.com", "/o/oauth2/v2/auth");
const tokenUrl = () => url("https://oauth2.googleapis.com", "/token");
const gmailUrl = (path: string) => url("https://gmail.googleapis.com", `/gmail/v1/users/me${path}`);

export const gmailConfigured = () =>
  !!process.env.GOOGLE_CLIENT_ID?.trim() && !!process.env.GOOGLE_CLIENT_SECRET?.trim() && !!process.env.GMAIL_TOKEN_KEY?.trim();

// ---------------------------------------------------------------- the token, encrypted
const toBytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));
const key = () => crypto.subtle.importKey("raw", toBytes(process.env.GMAIL_TOKEN_KEY!.trim()), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function encryptToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(token));
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(data).toString("base64")}`;
}

async function decryptToken(value: string): Promise<string> {
  const [iv, data] = value.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: toBytes(iv) }, await key(), toBytes(data)));
}

// ---------------------------------------------------------------- Google
async function token(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), ...body }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}`);
  return res.json();
}

export const exchangeCode = (code: string, redirectUri: string) =>
  token({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });

async function gmail<T>(access: string, path: string): Promise<T> {
  const res = await fetch(gmailUrl(path), { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(`Gmail ${res.status}: ${detail?.error?.message ?? ""}`);
  }
  return res.json();
}

const isQuota = (e: unknown) => e instanceof Error && /Gmail (403|429).*(quota|rate limit)/i.test(e.message);

export const mailboxAddress = async (access: string) => (await gmail<{ emailAddress: string }>(access, "/profile")).emailAddress;

// ---------------------------------------------------------------- one message
type Part = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
type Message = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate: string; payload: Part };

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const walk = (p: Part): Part[] => [p, ...(p.parts ?? []).flatMap(walk)];
const addresses = (v: string | undefined) => (v?.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map((a) => a.toLowerCase());

/** The text of a message; HTML only when there is no plain text. Marked up text is reduced to plain text. */
export function bodyOf(payload: Part): string {
  const parts = walk(payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain) return decode(plain.body!.data!);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (!html) return "";
  return decode(html.body!.data!)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

export function toMail(m: Message) {
  const header = (name: string) => m.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value;
  const from = addresses(header("from"));
  const to = [...addresses(header("to")), ...addresses(header("cc"))];
  const out = !!m.labelIds?.includes("SENT");
  return {
    gmail_id: m.id, thread_id: m.threadId, direction: out ? "out" : "in",
    from_address: header("from") ?? "", to_addresses: [header("to"), header("cc")].filter(Boolean).join(", ") || null,
    parties: out ? to : from,
    subject: header("subject") ?? null, snippet: m.snippet ?? null, body: bodyOf(m.payload).slice(0, MAX_BODY),
    has_attachments: walk(m.payload).some((p) => !!p.filename),
    sent_at: new Date(Number(m.internalDate)).toISOString(),
  };
}

// ---------------------------------------------------------------- the job
type State = { email: string; token_enc: string; sync_from: string; page_token: string | null; chunk_no: number; address_key: string | null };

/** The list of client addresses is searched in groups. Mail from anyone else is not read at all. */
const TERMS_PER_SEARCH = 25;
const searchFor = (terms: string[], from: string) => {
  const who = terms.flatMap((t) => [`from:${t}`, `to:${t}`]).join(" ");
  return encodeURIComponent(`after:${from.replaceAll("-", "/")} -in:chats {${who}}`);
};
const fingerprint = async (terms: string[]) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(terms.join(",")))).toString("base64");

/** A few pages of client mail; the next run goes on. A finished pass starts the next one from a day before it. */
export async function syncGmail(): Promise<{ connected: boolean; saved: number; paused?: boolean; error?: string }> {
  const [state] = await asSystem<State>("select email, token_enc, sync_from::text, page_token, chunk_no, address_key from gmail_job_state()");
  if (!state) return { connected: false, saved: 0 };
  const terms = (await asSystem<{ term: string }>("select term from gmail_job_terms()")).map((t) => t.term);
  const key = await fingerprint(terms);
  let saved = 0;
  let pageToken = state.page_token;
  let chunk = state.chunk_no;
  let from = state.sync_from;
  // New clients or addresses: their earlier mail is wanted too
  if (key !== state.address_key) {
    await asSystem("select gmail_job_position(0, $1, true)", [key]);
    [pageToken, chunk] = [null, 0];
    from = (await asSystem<{ sync_from: string }>("select sync_from::text from gmail_job_state()"))[0].sync_from;
  }
  const stop = async () => {
    await asSystem("select gmail_job_position($1, $2, false)", [chunk, key]);
    await asSystem("select gmail_job_done($1, null, null)", [pageToken]);
  };
  try {
    if (terms.length === 0) {
      await asSystem("select gmail_job_done(null, null, null)");
      return { connected: true, saved };
    }
    const { access_token } = await token({ refresh_token: await decryptToken(state.token_enc), grant_type: "refresh_token" });
    const started = new Date();
    for (let page = 0; page < PAGES_PER_RUN; page++) {
      const group = terms.slice(chunk * TERMS_PER_SEARCH, (chunk + 1) * TERMS_PER_SEARCH);
      const list = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(
        access_token, `/messages?q=${searchFor(group, from)}&maxResults=${PER_PAGE}${pageToken ? `&pageToken=${pageToken}` : ""}`);
      const mails = [];
      let paused = false;
      for (const { id } of list.messages ?? []) {
        try {
          mails.push(toMail(await gmail<Message>(access_token, `/messages/${id}?format=full`)));
        } catch (e) {
          if (!isQuota(e)) throw e;
          paused = true;
          break;
        }
        await wait(PAUSE_MS);
      }
      if (mails.length) saved += (await asSystem<{ n: number }>("select gmail_job_save($1::jsonb) as n", [JSON.stringify(mails)]))[0].n;
      // At the limit: what came is kept, and the next run goes on from this page
      if (paused) {
        await stop();
        return { connected: true, saved, paused };
      }
      pageToken = list.nextPageToken ?? null;
      if (pageToken) continue;
      chunk += 1;
      if (chunk * TERMS_PER_SEARCH >= terms.length) {
        chunk = 0;
        started.setDate(started.getDate() - 1);
        await asSystem("select gmail_job_position(0, $1, false)", [key]);
        await asSystem("select gmail_job_done(null, $1::date, null)", [started.toISOString().slice(0, 10)]);
        return { connected: true, saved };
      }
    }
    await stop();
  } catch (e) {
    if (isQuota(e)) {
      await stop();
      return { connected: true, saved, paused: true };
    }
    console.error("Gmail sync", e);
    const error = e instanceof Error ? e.message : String(e);
    await asSystem("select gmail_job_position($1, $2, false)", [chunk, key]);
    await asSystem("select gmail_job_done($1, null, $2)", [pageToken, error]);
    return { connected: true, saved, error };
  }
  return { connected: true, saved };
}
