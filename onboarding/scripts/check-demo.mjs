// Checks the demo database before recording: no real ingredients, suppliers,
// e-mails or company data. Exits with an error if anything is found.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DB_DIR, ROOT } from "../lib/app-server.mjs";

export async function checkDemo() {
  const lib = (p) => pathToFileURL(path.join(ROOT, "web", "node_modules", "@electric-sql", "pglite", "dist", p)).href;
  const { PGlite } = await import(lib("index.js"));
  const { citext } = await import(lib("contrib/citext.js"));
  const { pgcrypto } = await import(lib("contrib/pgcrypto.js"));
  const db = await PGlite.create({ dataDir: DB_DIR, extensions: { citext, pgcrypto } });
  const problems = [];
  const count = async (label, sql) => {
    const n = Number((await db.query(sql)).rows[0].n);
    if (n > 0) problems.push(`${label}: ${n}`);
  };
  try {
    await count("opening-stock items (RM-1xxx)", "select count(*) n from items where sku ~ '^RM-1[0-9]{3}$'");
    await count("suppliers outside the demo", "select count(*) n from suppliers where name not in ('EuroIngredients GmbH', 'CapsPack SRL')");
    await count("nutrikal.com e-mails", `select (select count(*) from profiles where email ilike '%nutrikal%')
                                              + (select count(*) from contacts where email ilike '%nutrikal%')
                                              + (select count(*) from calc_settings where company_email ilike '%nutrikal%')
                                              + (select count(*) from company_settings where email ilike '%nutrikal%') as n`);
    await count("real bank data", "select count(*) n from calc_settings where bank_iban ilike '%FINV%'");
    await count("sheet links", "select count(*) n from calc_settings where google_sheet_url <> '' or catalog_sheet_url <> ''");
    await count("old client names", "select count(*) n from clients where legal_name in ('Acme Wellness GmbH', 'Nordic Labs AB', 'Vita Market SRL')");
  } finally {
    await db.close();
  }
  if (problems.length) throw new Error(`Demo database is not clean:\n  ${problems.join("\n  ")}`);
  console.log("[onboarding] demo database checked: fictional data only");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkDemo().catch((e) => { console.error(e.message); process.exit(1); });
}
