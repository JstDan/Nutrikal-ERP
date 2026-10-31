// Writes a migration with the EU Register of health claims and the EU Novel Food status Catalogue,
// from the public Food and Feed Information Portal. Run again for fresh lists; rows are updated by code.
// Usage: node scripts/eu-lists.mjs ../supabase/migrations/<timestamp>_eu_lists.sql [header.sql]
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://ec.europa.eu/food/food-feed-portal/backend/api/policy-items";
const get = async (query) => {
  const res = await fetch(`${API}?${query}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${res.status} ${query}`);
  return res.json();
};
const text = (v) => (v == null ? null : String(v)
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\s+/g, " ").trim() || null);
const sql = (v) => (v == null ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const child = (o, key) => (o?.childrenValues ?? []).find((c) => c.valueIdentifier === key);
const value = (o, key) => child(o, key)?.value ?? null;
const all = (o, key, out = []) => {
  for (const c of o?.childrenValues ?? []) {
    if (c.valueIdentifier === key) out.push(c);
    all(c, key, out);
  }
  return out;
};

const STATUS = { HCCS_AUTHORISED: "authorised", HCCS_NON_AUTHORISED: "non_authorised", HCCS_REVOKED: "revoked" };
const TYPE = { HCLBT_13_1: "13(1)", HCLBT_13_5: "13(5)", HCLBT_14_1_A: "14(1)(a)", HCLBT_14_1_B: "14(1)(b)" };

const claims = (await get("foodDomain=nut&authorisationType=nut_auth")).map((x) => {
  const c = child(x, "hcCharacteristicWrapper");
  const w = child(x, "hcClaimWrapper");
  return [
    value(x, "policyItemCode"), text(value(c, "hcNutSubFoodCat")), text(value(w, "hcClaim")), text(value(w, "hcCondOfUse")),
    text(value(w, "hcRestrictionOfUse")), STATUS[value(c, "hcClaimStatus")], TYPE[value(c, "hcClaimType")] ?? null,
  ];
}).filter((r) => r[1] && r[2] && r[5]);

const foods = (await get("foodDomain=nf&authorisationType=nfc_auth")).map((x) => {
  const s = child(x, "policyItemSpecs");
  const parts = all(x, "NFCatalogItemStatus").map((p) => ({ part: text(value(p, "NFCItemPart")), status: value(p, "NFCStatusCode") }));
  const name = text(value(s, "identifyingName"));
  return [
    value(x, "policyItemCode"), name, text(all(s, "synonyms")[0]?.value), text(all(s, "commonNames")[0]?.value),
    JSON.stringify(parts), text(all(s, "description")[0]?.value)?.slice(0, 500) ?? null,
  ];
}).filter((r) => r[1]);

const rows = (list, jsonColumn) => list.map((r) => `(${r.map((v, i) => (i === jsonColumn ? `${sql(v)}::jsonb` : sql(v))).join(", ")})`).join(",\n");
const out = process.argv[2];
const header = process.argv[3] ? readFileSync(process.argv[3], "utf8") : "";
writeFileSync(out, `${header}
insert into public.eu_health_claims (code, substance, claim, conditions, restrictions, status, claim_type) values
${rows(claims)}
on conflict (code) do update set substance = excluded.substance, claim = excluded.claim, conditions = excluded.conditions,
  restrictions = excluded.restrictions, status = excluded.status, claim_type = excluded.claim_type;

insert into public.eu_novel_food_status (code, name, synonyms, common_names, parts, description) values
${rows(foods, 4)}
on conflict (code) do update set name = excluded.name, synonyms = excluded.synonyms, common_names = excluded.common_names,
  parts = excluded.parts, description = excluded.description;

update public.eu_lists_info set downloaded_on = date '${new Date().toISOString().slice(0, 10)}';
`);
console.log(`${claims.length} claims, ${foods.length} catalogue entries`);
