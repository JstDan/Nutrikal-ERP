// Replaces PGlite in the Cloudflare build (see next.config.ts): there the
// app always uses Supabase, and the embedded database would not fit in a Worker.
export class PGlite {
  static create(): never {
    throw new Error("The local database is not available on Cloudflare: set DATABASE_URL");
  }
}
export const citext = {};
export const pgcrypto = {};
