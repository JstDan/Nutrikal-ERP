// E-mail through an HTTP API: the app runs on Cloudflare Workers, where SMTP is not available.
// From the shared Gmail mailbox when it is connected (owner, Nov 2026), else through Resend when that is set up.
import { connectedMailbox, sendViaGmail } from "@/lib/gmail";

const key = () => process.env.RESEND_API_KEY?.trim() ?? "";
const from = () => process.env.MAIL_FROM?.trim() ?? "";
const resendConfigured = () => key() !== "" && from() !== "";

type Mail = {
  to: string; cc: string | null; replyTo: string | null; subject: string; text: string;
  attachment?: { filename: string; base64: string };
};

/** How mail leaves now: the address of the shared mailbox, "resend", or null when nothing is set up. */
export async function mailRoute(): Promise<{ gmail: string } | "resend" | null> {
  const mailbox = await connectedMailbox().catch(() => null);
  if (mailbox) return { gmail: mailbox };
  return resendConfigured() ? "resend" : null;
}

export const mailConfigured = async () => (await mailRoute()) !== null;

export async function sendMail(m: Mail): Promise<void> {
  const route = await mailRoute();
  // From the shared mailbox the replies come back to it, so no Reply-To
  if (route && route !== "resend") return sendViaGmail({ ...m, replyTo: null });
  const res = await fetch(process.env.MAIL_API_URL?.trim() || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: from(), to: [m.to], ...(m.cc && { cc: [m.cc] }), ...(m.replyTo && { reply_to: m.replyTo }),
      subject: m.subject, text: m.text,
      ...(m.attachment && { attachments: [{ filename: m.attachment.filename, content: m.attachment.base64 }] }),
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
}
