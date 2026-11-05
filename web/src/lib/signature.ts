// E-mail signatures (owner, Nov 2026): the HTML pasted from Gmail is cleaned to a short list of tags and
// attributes before it is saved and again before it is shown or sent. No scripts, styles blocks, event
// handlers, forms or frames; links only http(s), mailto and tel; pictures only http(s).

const TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "br", "p", "div", "span", "img", "font", "small", "big", "sub", "sup",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li", "hr", "blockquote", "h1", "h2", "h3", "h4", "center",
]);
const VOID = new Set(["br", "img", "hr"]);
const ATTRS = new Set([
  "href", "src", "alt", "title", "width", "height", "style", "color", "face", "size", "align", "valign",
  "border", "cellpadding", "cellspacing", "bgcolor", "target", "dir", "colspan", "rowspan",
]);
const MAX = 20000;

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeEntities = (v: string) => v.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d))).replace(/&colon;/gi, ":").replace(/&amp;/gi, "&");

function safeUrl(v: string, image: boolean): string | null {
  const plain = decodeEntities(v).replace(/[\u0000- \u007f]+/g, "");
  if (/^https?:\/\//i.test(plain)) return v.trim();
  if (!image && /^(mailto|tel):/i.test(plain)) return v.trim();
  return null;
}

function safeStyle(v: string): string | null {
  const plain = decodeEntities(v).toLowerCase().replace(/\s+/g, "");
  if (/expression\(|javascript:|vbscript:|url\(|@import|behavior:|-moz-binding/.test(plain)) return null;
  return v.trim();
}

/** Cleans pasted signature HTML; empty when nothing usable is left. */
export function cleanSignature(input: string): string {
  let html = (input ?? "").slice(0, MAX * 2)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template|textarea|select|svg|math|head|title|form)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template|textarea|select|svg|math|head|title|form|meta|link|base|input|button)\b[^>]*>/gi, "");
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (whole, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!TAGS.has(tag)) return "";
    if (whole.startsWith("</")) return VOID.has(tag) ? "" : `</${tag}>`;
    const kept: string[] = [];
    for (const m of rawAttrs.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const name = m[1].toLowerCase();
      const value = m[2] ?? m[3] ?? m[4] ?? "";
      if (!ATTRS.has(name)) continue;
      let safe: string | null = value;
      if (name === "href") safe = safeUrl(value, false);
      else if (name === "src") safe = tag === "img" ? safeUrl(value, true) : null;
      else if (name === "style") safe = safeStyle(value);
      else if (name === "target") safe = "_blank";
      if (safe === null) continue;
      kept.push(`${name}="${escapeAttr(decodeEntities(safe))}"`);
    }
    if (tag === "a") kept.push('rel="noopener noreferrer"');
    return `<${tag}${kept.length ? ` ${kept.join(" ")}` : ""}${VOID.has(tag) ? " /" : ""}>`;
  });
  // Stray angle brackets left by broken tags
  html = html.replace(/<(?![a-z/])/gi, "&lt;").trim();
  const text = html.replace(/<[^>]+>/g, "").replace(/&nbsp;|\s/g, "");
  if (!text && !/<img\b/i.test(html)) return "";
  return html.length > MAX ? "" : html;
}

/** The signature as plain text, for the text part of the e-mail. */
export function signatureText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-4])[^>]*>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The message as HTML: the typed text with its line breaks, then the signature. */
export function messageHtml(text: string, signature: string): string {
  const body = escapeHtml(text).replace(/\r?\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222831">${body}</div><br><div>${cleanSignature(signature)}</div>`;
}
