// READ ONLY. Lists everything created after the opening-stock import, for the owner to approve
// before test data is removed. Nothing is changed: it runs in a read-only transaction.
//
//   cd web && node --env-file=.env.local scripts/test-data-report.mjs [out.md]
//
// "Looks like a test" is only a hint (name or e-mail with test words, made by the developer account,
// or tied to a client/order already marked); the owner decides.
import pg from "pg";
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "test-data-report.md";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin isolation level repeatable read read only");
const q = async (sql, p = []) => (await c.query(sql, p)).rows;

const TESTY = /(test|тест|demo|демо|проба|проб|sample|example|asdf|qwe|xxx|lorem|dummy|fake|фиктив|опит)/i;
const people = Object.fromEntries((await q("select id, full_name, role::text from profiles")).map((p) => [p.id, p]));
const who = (id) => (id && people[id] ? `${people[id].full_name} (${people[id].role})` : id ? id.slice(0, 8) : "—");
const isDev = (id) => id && people[id]?.role === "developer";
const d = (x) => (x ? new Date(x).toLocaleString("en-GB", { timeZone: "Europe/Sofia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// The import: the opening-stock movements (the first ones in the ledger, 27/10/2026)
const imp = (await q(`select min(created_at) as first, max(created_at) as last, max(created_at)::text as last_exact, count(*)::int as n
                        from stock_movements where type = 'opening_balance'`))[0];
// as text, so the microseconds are kept (a JS Date would round them away and the import itself would count as "after")
const cutoff = imp.last_exact;

const sections = [];
const testClients = new Set(), testOrders = new Set(), testMOs = new Set();
function section(title, rows, cols) {
  sections.push({ title, rows, cols });
}
function flag(row, reasons) {
  row.test = reasons.filter(Boolean).join("; ") || "";
  return row;
}

// Clients
const clients = (await q(`select id, code, legal_name, trade_name, billing_email, status::text, created_by, owner_id, created_at
                            from clients where created_at > $1 order by created_at`, [cutoff])).map((r) => {
  const t = flag(r, [TESTY.test(`${r.legal_name} ${r.trade_name ?? ""} ${r.billing_email ?? ""}`) && "name/e-mail", isDev(r.created_by) && "developer account"]);
  if (t.test) testClients.add(r.id);
  return t;
});
section("Clients", clients, [["code", "Code"], ["legal_name", "Name"], ["billing_email", "E-mail"], ["status", "Status"]]);

// Projects
section("Projects", (await q(`select id, code, name, client_id, created_by, created_at from projects where created_at > $1 order by created_at`, [cutoff]))
  .map((r) => flag(r, [TESTY.test(r.name) && "name", testClients.has(r.client_id) && "test client", isDev(r.created_by) && "developer account"])),
  [["code", "Code"], ["name", "Name"]]);

// Calculator offers
section("Offers (calculator)", (await q(`select id, offer_no as code, coalesce(company_name, receiver_name) as name, product_name, client_id, total_excl_vat,
                                               created_by, created_at from calc_offers where created_at > $1 order by created_at`, [cutoff]))
  .map((r) => flag(r, [TESTY.test(`${r.name ?? ""} ${r.product_name ?? ""}`) && "name", testClients.has(r.client_id) && "test client", isDev(r.created_by) && "developer account"])),
  [["code", "No."], ["name", "Client"], ["product_name", "Product"], ["total_excl_vat", "Total excl. VAT"]]);

// Recipes
section("Recipes (formulas)", (await q(`select id, code, name, client_id, created_by, created_at from formulas where created_at > $1 order by created_at`, [cutoff]))
  .map((r) => flag(r, [TESTY.test(r.name) && "name", testClients.has(r.client_id) && "test client", isDev(r.created_by) && "developer account"])),
  [["code", "Code"], ["name", "Name"]]);

// Sales orders
const sos = (await q(`select so.id, so.code, c.legal_name as client, so.client_id, so.status::text, so.customer_ref, so.created_by, so.created_at
                        from sales_orders so join clients c on c.id = so.client_id where so.created_at > $1 order by so.created_at`, [cutoff])).map((r) => {
  const t = flag(r, [testClients.has(r.client_id) && "test client", TESTY.test(`${r.customer_ref ?? ""}`) && "reference", isDev(r.created_by) && "developer account"]);
  if (t.test) testOrders.add(r.id);
  return t;
});
section("Sales orders", sos, [["code", "Code"], ["client", "Client"], ["status", "Status"]]);

// Manufacturing orders
const mos = (await q(`select mo.id, mo.code, mo.status::text, mo.quantity, mo.batch_number, sol.order_id as sales_order_id, mo.created_by, mo.created_at
                        from manufacturing_orders mo left join sales_order_lines sol on sol.id = mo.sales_order_line_id
                       where mo.created_at > $1 order by mo.created_at`, [cutoff])).map((r) => {
  const t = flag(r, [testOrders.has(r.sales_order_id) && "test order", !r.sales_order_id && "no sales order", isDev(r.created_by) && "developer account"]);
  if (t.test) testMOs.add(r.id);
  return t;
});
section("Manufacturing orders", mos, [["code", "Code"], ["status", "Status"], ["quantity", "Qty"], ["batch_number", "Batch"]]);

// Purchase requests, purchase orders, expected deliveries
section("Purchase requests", (await q(`select pr.id, pr.code, i.sku || ' ' || i.name as item, pr.quantity, pr.status::text, pr.manufacturing_order_id, pr.sales_order_id, pr.created_by, pr.created_at
                                         from purchase_requests pr join items i on i.id = pr.item_id where pr.created_at > $1 order by pr.created_at`, [cutoff]))
  .map((r) => flag(r, [testMOs.has(r.manufacturing_order_id) && "test MO", testOrders.has(r.sales_order_id) && "test order", isDev(r.created_by) && "developer account"])),
  [["code", "Code"], ["item", "Item"], ["quantity", "Qty"], ["status", "Status"]]);
section("Purchase orders", (await q(`select po.id, po.code, s.name as supplier, po.status::text, po.created_by, po.created_at
                                       from purchase_orders po left join suppliers s on s.id = po.supplier_id where po.created_at > $1 order by po.created_at`, [cutoff]))
  .map((r) => flag(r, [isDev(r.created_by) && "developer account"])),
  [["code", "Code"], ["supplier", "Supplier"], ["status", "Status"]]);
section("Expected deliveries", (await q(`select ed.id, ed.code, i.sku || ' ' || i.name as item, ed.quantity, ed.status::text, ed.po_reference, ed.created_by, ed.created_at
                                           from expected_deliveries ed join items i on i.id = ed.item_id where ed.created_at > $1 order by ed.created_at`, [cutoff]))
  .map((r) => flag(r, [TESTY.test(`${r.po_reference ?? ""}`) && "reference", isDev(r.created_by) && "developer account"])),
  [["code", "Code"], ["item", "Item"], ["quantity", "Qty"], ["status", "Status"], ["po_reference", "PO ref."]]);

// Lots received after the import
section("Lots (received / reported)", (await q(`select l.id, l.lot_number as code, i.sku || ' ' || i.name as item, l.supplier_lot, l.qc_status::text, l.expected_delivery_id,
                                                      (select mo.id from manufacturing_orders mo where mo.finished_lot_id = l.id) as mo_id, l.created_by, l.created_at
                                                 from lots l join items i on i.id = l.item_id where l.created_at > $1 order by l.created_at`, [cutoff]))
  .map((r) => flag(r, [testMOs.has(r.mo_id) && "finished lot of a test MO", isDev(r.created_by) && "developer account"])),
  [["code", "Lot"], ["item", "Item"], ["supplier_lot", "Batch"], ["qc_status", "QC"]]);

// Reservations
section("Reservations", (await q(`select r.id, i.sku || ' ' || i.name as item, r.quantity, r.status::text, mo.code as mo, r.manufacturing_order_id, r.reserved_by as created_by, r.created_at
                                    from stock_reservations r join items i on i.id = r.item_id left join manufacturing_orders mo on mo.id = r.manufacturing_order_id
                                   where r.created_at > $1 order by r.created_at`, [cutoff]))
  .map((r) => flag(r, [testMOs.has(r.manufacturing_order_id) && "test MO", isDev(r.created_by) && "developer account"])),
  [["item", "Item"], ["quantity", "Qty"], ["status", "Status"], ["mo", "MO"]]);

// Task boards (one per order; tasks counted)
section("Task boards (order tasks)", (await q(`select b.id, so.code, (select count(*) from order_tasks t where t.board_id = b.id)::int as tasks, b.sales_order_id, b.created_by, b.created_at
                                                 from order_task_boards b join sales_orders so on so.id = b.sales_order_id where b.created_at > $1 order by b.created_at`, [cutoff]))
  .map((r) => flag(r, [testOrders.has(r.sales_order_id) && "test order", isDev(r.created_by) && "developer account"])),
  [["code", "Order"], ["tasks", "Tasks"]]);

// Proformas and invoices
section("Proformas, invoices, credit and debit notes", (await q(`select i.id, coalesce(i.number, i.proforma_no, '(draft)') as code, i.kind::text, i.status::text, i.purpose::text, i.total,
                                                                         c.legal_name as client, i.client_id, so.code as order_code, i.order_id, i.issued_at, i.created_by, i.created_at
                                                                    from invoices i left join clients c on c.id = i.client_id left join sales_orders so on so.id = i.order_id
                                                                   where i.created_at > $1 order by i.created_at`, [cutoff]))
  .map((r) => flag(r, [testClients.has(r.client_id) && "test client", testOrders.has(r.order_id) && "test order", isDev(r.created_by) && "developer account"])),
  [["code", "Number"], ["kind", "Kind"], ["status", "Status"], ["client", "Client"], ["order_code", "Order"], ["total", "Total"], ["issued_at", "Issued"]]);

// Stock movements after the import
const moves = (await q(`select m.created_at, m.type::text, m.quantity, i.sku, i.name as item, lo.lot_number, l.code as location, m.reference, m.reason,
                               m.manufacturing_order_id, mo.code as mo, sol.order_id as sales_order_id, m.dispatch_id, lo.expected_delivery_id, m.created_by
                          from stock_movements m join items i on i.id = m.item_id join locations l on l.id = m.location_id join lots lo on lo.id = m.lot_id
                          left join manufacturing_orders mo on mo.id = m.manufacturing_order_id
                          left join sales_order_lines sol on sol.id = mo.sales_order_line_id
                         where m.created_at > $1 order by m.created_at`, [cutoff]))
  .map((r) => flag(r, [testMOs.has(r.manufacturing_order_id) && `test MO ${r.mo}`, testOrders.has(r.sales_order_id) && "test order", isDev(r.created_by) && "developer account"]));
section("Stock movements after the import", moves, [["type", "Type"], ["sku", "SKU"], ["item", "Item"], ["quantity", "Qty"], ["lot_number", "Lot"], ["location", "Location"], ["mo", "MO"], ["reference", "Reference"], ["reason", "Reason"]]);

const series = await q("select key, prefix, next_number from number_series order by key");
const issued = await q(`select coalesce(number, '') as number, kind::text, status::text, issued_at from invoices where status::text <> 'draft' order by number`);
await c.query("rollback");
await c.end();

// ---- write the report
const esc = (v) => String(v ?? "—").replace(/\|/g, "/").replace(/\n/g, " ");
let md = `# Records after the opening-stock import — for approval (nothing deleted)\n\n`;
md += `Import: ${imp.n} stock movements, ${d(imp.first)} – ${d(imp.last)}. Everything below was created after ${d(cutoff)}.\n`;
md += `"Looks like a test" is only a hint; please mark what is real.\n\n`;
for (const s of sections) {
  md += `## ${s.title} (${s.rows.length}; marked as test: ${s.rows.filter((r) => r.test).length})\n\n`;
  if (!s.rows.length) { md += "_none_\n\n"; continue; }
  md += `| ${s.cols.map((x) => x[1]).join(" | ")} | Created | By | Looks like a test |\n|${s.cols.map(() => "---").join("|")}|---|---|---|\n`;
  for (const r of s.rows) md += `| ${s.cols.map(([k]) => esc(k === "issued_at" ? (r[k] ? d(r[k]) : "") : r[k])).join(" | ")} | ${d(r.created_at)} | ${esc(who(r.created_by))} | ${r.test ? "yes: " + r.test : "no"} |\n`;
  md += "\n";
}
md += `## Number series now\n\n| Series | Prefix | Next number |\n|---|---|---|\n${series.map((s) => `| ${s.key} | ${s.prefix} | ${s.next_number} |`).join("\n")}\n\n`;
md += `## Issued (not draft) invoices and notes\n\n${issued.length ? issued.map((i) => `- ${i.number} ${i.kind} ${i.status} ${d(i.issued_at)}`).join("\n") : "_none_"}\n`;
writeFileSync(out, md);
console.log(`Report: ${out}`);
for (const s of sections) console.log(`${s.title}: ${s.rows.length} (test-looking ${s.rows.filter((r) => r.test).length})`);
