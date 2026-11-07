// Makes the keys for phone and desktop notifications (Web Push, VAPID) and writes them into .env.local,
// only if they are not there yet. The private key is never printed. Then: npm run cf:secrets.
// Usage: node scripts/vapid-keys.mjs
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const file = new URL("../.env.local", import.meta.url);
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
if (/^VAPID_PRIVATE_KEY=.+/m.test(text)) {
  console.log("VAPID keys are already in .env.local; nothing changed.");
  process.exit(0);
}
const b64url = (b) => Buffer.from(b).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}# Phone and desktop notifications (Web Push)\nVAPID_PUBLIC_KEY=${b64url(pub)}\nVAPID_PRIVATE_KEY=${jwk.d}\nVAPID_SUBJECT=mailto:sales@nutrikal.com\n`);
console.log("VAPID keys written to .env.local (public key starts with " + b64url(pub).slice(0, 8) + "…). Now run: npm run cf:secrets");
