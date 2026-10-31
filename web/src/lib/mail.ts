// E-mail through an HTTP API (Resend): the app runs on Cloudflare Workers, where SMTP is not available.

const key = () => process.env.RESEND_API_KEY?.trim() ?? "";
const from = () => process.env.MAIL_FROM?.trim() ?? "";

export const mailConfigured = () => key() !== "" && from() !== "";

export async function sendMail(m: {
  to: string; cc: string | null; replyTo: string | null; subject: string; text: string;
  attachment: { filename: string; base64: string };
}): Promise<void> {
  const res = await fetch(process.env.MAIL_API_URL?.trim() || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: from(), to: [m.to], ...(m.cc && { cc: [m.cc] }), ...(m.replyTo && { reply_to: m.replyTo }),
      subject: m.subject, text: m.text,
      attachments: [{ filename: m.attachment.filename, content: m.attachment.base64 }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
}
