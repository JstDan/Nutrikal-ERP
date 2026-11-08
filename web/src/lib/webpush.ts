// Web Push with Web Crypto only (works in Node and in Cloudflare Workers): VAPID (RFC 8292) and the aes128gcm
// payload encryption of RFC 8291. Keys: VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed P-256 point) and
// VAPID_PRIVATE_KEY (base64url, the 32-byte private number); VAPID_SUBJECT is a mailto: or https: contact.

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", buf(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, buf(data)));
}

/**
 * The encrypted body (aes128gcm, one record) for a subscription. `local` and `salt` can be given for test vectors;
 * normally a fresh key pair and salt are made for every message.
 */
export async function encryptPayload(target: { p256dh: string; auth: string }, payload: Uint8Array,
  test?: { localPrivate: CryptoKey; localPublic: Uint8Array; salt: Uint8Array }): Promise<Uint8Array> {
  const uaPublic = unb64url(target.p256dh);
  const authSecret = unb64url(target.auth);
  let localPrivate: CryptoKey, localPublic: Uint8Array;
  if (test) ({ localPrivate, localPublic } = test);
  else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    localPrivate = pair.privateKey;
    localPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const salt = test?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey("raw", buf(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, localPrivate, 256));
  // IKM = HKDF(auth, ecdh, "WebPush: info" || 0 || ua_public || as_public, 32)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, localPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  // One record: the payload and the delimiter 0x02 (last record)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, key, buf(concat(payload, new Uint8Array([2])))));
  const header = new Uint8Array(16 + 4 + 1 + localPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  header.set(localPublic, 21);
  return concat(header, cipher);
}

/** The VAPID private key as a Web Crypto signing key (x and y come from the public key). */
async function vapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = unb64url(publicKey);
  return crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: privateKey, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The Authorization header for a push service: a signed JWT for its origin, valid 12 hours. */
export async function vapidAuth(endpoint: string, publicKey: string, privateKey: string, subject: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidKey(publicKey, privateKey), buf(enc.encode(`${header}.${claims}`))));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${publicKey}`;
}

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

/** Sends one message; returns the status (201 sent; 404/410 the subscription is gone). */
export async function sendPush(target: PushTarget, message: { title: string; body: string; link: string; tag?: string; urgent?: boolean }): Promise<number> {
  const pub = process.env.VAPID_PUBLIC_KEY!.trim();
  const priv = process.env.VAPID_PRIVATE_KEY!.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:sales@nutrikal.com";
  const body = await encryptPayload(target, enc.encode(JSON.stringify(message)));
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(target.endpoint, pub, priv, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      // Chat messages and huddles reach a sleeping phone at once
      Urgency: message.urgent ? "high" : "normal",
    },
    body: buf(body),
  });
  return res.status;
}
