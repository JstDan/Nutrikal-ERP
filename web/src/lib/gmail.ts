import { asSystem } from "@/lib/db/engine";

// The shared mailbox. Connected once by Admin; the job brings new mail, oldest pages first served by Gmail
// newest first, a few pages per run; documents are sent from it (below). GOOGLE_STUB_URL replaces Google's
// addresses in tests.

// drive.file: only the files the app itself puts in Drive (contracts for eSignature; owner, Nov 2026)
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.file";
// One run makes at most 50 requests on the Cloudflare Workers free plan (Gmail, Google and the database
// together): one page of 25 messages, one request each. The job runs every 10 minutes.
const PAGES_PER_RUN = 1;
const PER_PAGE = 25;
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

// ---------------------------------------------------------------- live search for the assistant
// The AI assistant searches the whole shared mailbox at the moment of a question, with Gmail's own search
// (label:, is:unread, from:, after: …; owner, Nov 2026). Nothing is saved. Who may ask is checked by the caller
// (Admin and Sales). Few requests per question: the token and the label names are kept for a while.
const LIVE_MAX = 5;
const LIVE_BODY = 1500;
let cachedToken: { value: string; until: number } | null = null;
/** A token kept from before a reconnect may lack a new permission: the next call asks for a fresh one. */
export function forgetAccess() { cachedToken = null; }
let cachedLabels: { names: Record<string, string>; until: number } | null = null;

export async function liveAccess(): Promise<string | null> {
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.value;
  const [state] = await asSystem<{ token_enc: string }>("select token_enc from gmail_job_state()");
  if (!state) return null;
  const { access_token } = await token({ refresh_token: await decryptToken(state.token_enc), grant_type: "refresh_token" });
  cachedToken = { value: access_token, until: Date.now() + 45 * 60_000 };
  return access_token;
}

async function labelNames(access: string): Promise<Record<string, string>> {
  if (cachedLabels && cachedLabels.until > Date.now()) return cachedLabels.names;
  const r = await gmail<{ labels?: { id: string; name: string }[] }>(access, "/labels");
  const names = Object.fromEntries((r.labels ?? []).map((l) => [l.id, l.name]));
  cachedLabels = { names, until: Date.now() + 30 * 60_000 };
  return names;
}

export async function searchMailbox(query: string) {
  const access = await liveAccess();
  if (!access) return { error: "Gmail is not connected" };
  try {
    const list = await gmail<{ messages?: { id: string }[]; resultSizeEstimate?: number }>(
      access, `/messages?q=${encodeURIComponent(query.trim())}&maxResults=${LIVE_MAX}`);
    const names = await labelNames(access);
    const messages = [];
    for (const { id } of list.messages ?? []) {
      const m = await gmail<Message>(access, `/messages/${id}?format=full`);
      const header = (name: string) => m.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? null;
      messages.push({
        from: header("from"), to: header("to"), cc: header("cc"), subject: header("subject"),
        date: new Date(Number(m.internalDate)).toISOString(),
        unread: !!m.labelIds?.includes("UNREAD"),
        labels: (m.labelIds ?? []).map((l) => names[l] ?? l),
        has_attachments: walk(m.payload).some((p) => !!p.filename),
        text: bodyOf(m.payload).slice(0, LIVE_BODY),
      });
    }
    return { query, matches_about: list.resultSizeEstimate ?? messages.length, shown: messages.length, messages };
  } catch (e) {
    cachedToken = null;
    return { error: isQuota(e) ? "Gmail is busy, ask again in a minute" : e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- sending from the shared mailbox
// Documents and client notices leave from the shared mailbox (owner, Nov 2026): they show under Sent and
// replies come back there. It needs the gmail.send permission: a mailbox connected before that asks for
// reconnecting under Settings > Mail.

/** The shared mailbox, when it is connected (null otherwise). */
let cachedMailbox: { value: string | null; until: number } | null = null;
export async function connectedMailbox(): Promise<string | null> {
  if (!gmailConfigured()) return null;
  // Kept a minute: a run that sends several mails stays under the Workers request limit
  if (cachedMailbox && cachedMailbox.until > Date.now()) return cachedMailbox.value;
  const [state] = await asSystem<{ email: string }>("select email from gmail_job_state()");
  cachedMailbox = { value: state?.email ?? null, until: Date.now() + 60_000 };
  return cachedMailbox.value;
}

export class GmailSendScopeError extends Error {}

/** RFC 2047 for headers that are not plain ASCII (Bulgarian subjects and names). */
const header = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);
const lines76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n");
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

export function mimeMessage(m: {
  from: string; to: string; cc: string | null; replyTo: string | null; subject: string; text: string;
  /** The same message as HTML (with the sender's signature); the plain text stays as the other part. */
  html?: string;
  attachment?: { filename: string; base64: string };
  /** A reply in an earlier conversation: the Message-ID it answers and the chain before it. */
  inReplyTo?: string | null; references?: string | null;
}): string {
  const head = [
    `From: ${header("Nutrikal")} <${m.from}>`,
    `To: ${oneLine(m.to)}`,
    ...(m.cc ? [`Cc: ${oneLine(m.cc)}`] : []),
    ...(m.replyTo ? [`Reply-To: ${oneLine(m.replyTo)}`] : []),
    `Subject: ${header(oneLine(m.subject))}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${oneLine(m.inReplyTo)}`, `References: ${oneLine([m.references, m.inReplyTo].filter(Boolean).join(" "))}`] : []),
    "MIME-Version: 1.0",
  ];
  const part = (type: string, value: string) => [`Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", lines76(Buffer.from(value, "utf8").toString("base64"))];
  let text = part("text/plain", m.text);
  if (m.html) {
    const alt = `nk_${crypto.randomUUID()}`;
    text = [`Content-Type: multipart/alternative; boundary="${alt}"`, "", `--${alt}`, ...text, `--${alt}`, ...part("text/html", m.html), `--${alt}--`, ""];
  }
  if (!m.attachment) return [...head, ...text].join("\r\n");
  const boundary = `nk_${crypto.randomUUID()}`;
  const name = oneLine(m.attachment.filename).replace(/"/g, "");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...text,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${ascii}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "",
    lines76(m.attachment.base64.replace(/\s+/g, "")),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Sends one e-mail from the shared mailbox (Gmail API, media upload up to 35 MB). */
export async function sendViaGmail(m: Omit<Parameters<typeof mimeMessage>[0], "from"> & { threadId?: string | null }): Promise<void> {
  const from = await connectedMailbox();
  if (!from) throw new Error("Gmail is not connected");
  const raw = mimeMessage({ ...m, from });
  // Into an earlier conversation: the thread goes along as JSON next to the message (multipart upload)
  const b = `nk_${crypto.randomUUID()}`;
  const upload = m.threadId
    ? {
        path: "multipart", type: `multipart/related; boundary="${b}"`,
        body: [`--${b}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ threadId: m.threadId }),
          `--${b}`, "Content-Type: message/rfc822", "", raw, `--${b}--`, ""].join("\r\n"),
      }
    : { path: "media", type: "message/rfc822", body: raw };
  for (let attempt = 0; attempt < 2; attempt++) {
    const access = await liveAccess();
    if (!access) throw new Error("Gmail is not connected");
    const res = await fetch(url("https://gmail.googleapis.com", `/upload/gmail/v1/users/me/messages/send?uploadType=${upload.path}`), {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": upload.type },
      body: upload.body,
    });
    if (res.ok) return;
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "";
    // A token kept from before a reconnect may lack the new permission: once more with a fresh one
    cachedToken = null;
    if (res.status === 403 && /insufficient/i.test(detail)) {
      if (attempt === 0) continue;
      throw new GmailSendScopeError(`Gmail 403: ${detail}`);
    }
    throw new Error(`Gmail ${res.status}: ${detail}`);
  }
}

// ---------------------------------------------------------------- conversations to reply in
// A document can go as a reply in an earlier conversation with the client (owner, Nov 2026): the sender
// picks one of the latest threads with the address. Only subject, date, sender and snippet are shown.
const THREADS_MAX = 8;
export type MailThread = { id: string; subject: string; date: string; from: string; snippet: string; count: number };
export const isThreadId = (v: string) => /^[0-9a-f]{6,32}$/i.test(v);

type ThreadMeta = { id: string; messages?: { internalDate: string; snippet?: string; payload: Part }[] };
const headerOf = (p: Part, name: string) => p.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";

/** The latest conversations of the shared mailbox with one address, newest first. */
export async function clientThreads(address: string): Promise<MailThread[]> {
  const a = address.trim().toLowerCase();
  if (!/^[^\s@"'{}()]+@[^\s@"'{}()]+\.[^\s@"'{}()]+$/.test(a)) return [];
  const access = await liveAccess();
  if (!access) throw new Error("Gmail is not connected");
  try {
    const query = `{from:${a} to:${a} cc:${a}} -in:chats -in:trash -in:spam`;
    const list = await gmail<{ threads?: { id: string }[] }>(access, `/threads?q=${encodeURIComponent(query)}&maxResults=${THREADS_MAX}`);
    const out: MailThread[] = [];
    for (const { id } of list.threads ?? []) {
      const t = await gmail<ThreadMeta>(access, `/threads/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
      const msgs = t.messages ?? [];
      if (!msgs.length) continue;
      const last = msgs[msgs.length - 1];
      out.push({
        id, subject: headerOf(msgs[0].payload, "subject"), from: headerOf(last.payload, "from"),
        date: new Date(Number(last.internalDate)).toISOString(), snippet: (last.snippet ?? "").slice(0, 160), count: msgs.length,
      });
    }
    return out;
  } catch (e) {
    cachedToken = null;
    throw e;
  }
}

/** What a reply in a conversation needs: its subject with Re:, and the headers that tie it to the last message. */
export async function replyHeaders(threadId: string): Promise<{ subject: string; inReplyTo: string | null; references: string | null }> {
  const access = await liveAccess();
  if (!access) throw new Error("Gmail is not connected");
  const t = await gmail<ThreadMeta>(access,
    `/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`);
  const msgs = t.messages ?? [];
  if (!msgs.length) throw new Error("Gmail conversation not found");
  const last = msgs[msgs.length - 1].payload;
  return {
    subject: replySubject(headerOf(msgs[0].payload, "subject")),
    inReplyTo: headerOf(last, "message-id") || null,
    references: headerOf(last, "references") || null,
  };
}

export const replySubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

// ---------------------------------------------------------------- the job
type State ={ email: string; token_enc: string; sync_from: string; page_token: string | null; chunk_no: number; address_key: string | null };

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
