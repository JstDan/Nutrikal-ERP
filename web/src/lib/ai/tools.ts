import { q } from "@/lib/db/engine";
import { searchMailbox } from "@/lib/gmail";
import { CAPSULE_SIZE, CAPSULE_SIZES } from "@/lib/calculator/types";
import type { ToolDefinition } from "./gateway";

// What the assistant can read. Fixed queries only, each run as the signed-in user, so row-level security decides
// what comes back. Nothing here changes company data: text in the data (client notes, for example) cannot make the
// assistant act. propose_recipe only keeps a proposal in the conversation; a person turns it into a draft recipe.

const LIMIT = 25;
type Args = { term?: string; status?: string; code?: string };
const term = (a: Args) => (a.term ?? "").trim();

const tool = (name: string, description: string, properties: Record<string, unknown> = {}): ToolDefinition => ({
  name, description, parameters: { type: "object", properties, additionalProperties: false },
});
const TERM = { term: { type: "string", description: "Part of the name or code; empty for all" } };

export const AI_TOOLS: ToolDefinition[] = [
  tool("find_clients", "Find clients by name, with status, country, VAT number and billing e-mail.", TERM),
  tool("list_orders", "Sales orders, newest first, optionally by client name and status (unpaid, confirmed, in_production, ready, dispatched, closed, cancelled).",
    { ...TERM, status: { type: "string", description: "Order status; empty for all" } }),
  tool("order_details", "One sales order by its code (SO-00001): lines, prices, payments and production batches.",
    { code: { type: "string", description: "Order code" } }),
  tool("find_stock", "Stock of items by name or SKU: available, unit.", TERM),
  tool("expiring_lots", "Lots close to their expiry date."),
  tool("find_recipes", "Recipes by name or code, with format and latest version status.", TERM),
  tool("recipe_details", "Ingredients and amounts per serving of the latest version of one recipe, by its code (NK-F-0001).",
    { code: { type: "string", description: "Recipe code" } }),
  tool("find_invoices", "Invoices and notes by number, client or order code, newest first, with total, due date and what is left to pay.", TERM),
  tool("production_details", "One batch by its code (MO-00001): status, quantity, dates, recipe and client order.", { code: { type: "string", description: "Manufacturing order code" } }),
  tool("find_lots", "Lots by lot number, supplier lot or item: quality status and expiry date.", TERM),
  tool("find_materials", "Raw materials and excipients in the system by name or SKU, with stock, price per base unit when the person may see it, and Novel Food status. Recipes can use only these.", TERM),
  tool("eu_health_claims", "The EU Register of health claims: exact wording, conditions of use and status, by substance or words of the claim. Status: authorised (default), non_authorised, revoked.",
    { ...TERM, status: { type: "string", enum: ["authorised", "non_authorised", "revoked"] } }),
  tool("eu_novel_food_status", "The EU Novel Food status Catalogue, by name, synonym or common name: the status per part of the source. Search by the source (Camellia sinensis, magnesium) as well as by the ingredient.", TERM),
  tool("propose_recipe", "Propose a new recipe from items found with find_materials. The system calculates cost, capsule fill and stock and returns them; use those figures. A person decides whether to save it as a draft.", {
    name: { type: "string", description: "Recipe name in English" },
    name_bg: { type: "string", description: "Recipe name in Bulgarian" },
    product_format: { type: "string", enum: ["capsule", "tablet", "softgel", "powder", "sachet", "stick_pack", "liquid", "gummy", "bar", "other"] },
    serving_size: { type: "number", description: "Capsules or grams per serving" },
    serving_unit: { type: "string", enum: ["pcs", "g", "ml"], description: "pcs for capsules and tablets" },
    servings_per_pack: { type: "integer" },
    shell_sku: { type: "string", description: "SKU of the capsule shell, for capsules" },
    description: { type: "string", description: "One sentence on the purpose of the recipe" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { sku: { type: "string" }, amount: { type: "number", description: "Amount per serving" }, unit: { type: "string", enum: ["mg", "mcg", "g"] } },
        required: ["sku", "amount", "unit"], additionalProperties: false,
      },
    },
  }),
];

/** Mail reaches the AI service only with AI_READ_MAIL=on (after the data processing agreement is signed). */
const MAIL_TOOLS: ToolDefinition[] = [
  tool("search_gmail",
    "Search the whole shared Gmail mailbox right now, with Gmail search syntax: from:, to:, label:Name, is:unread, " +
    "subject:, after:2026/10/01, has:attachment, newer_than:7d, or plain words. Newest first, up to 5 messages with " +
    "sender, date, labels, unread and text, plus about how many match in all. Use it for any question about mail, labels or unread mail.",
    { query: { type: "string", description: "Gmail search, e.g. 'from:info@firma.at' or 'label:Mitko is:unread'; empty for the newest mail" } }),
  tool("mail_waiting_reply", "Client mail threads whose last message came from the client, oldest first."),
  tool("search_client_mail", "Saved mail with clients (the shared Gmail box): by client name or code, an e-mail address, or words in the subject and text; newest first, up to 20. Mail is shown in the app only through you.", TERM),
];
export const aiTools = () => (process.env.AI_READ_MAIL?.trim() === "on" ? [...AI_TOOLS, ...MAIL_TOOLS] : AI_TOOLS);

const QUERIES: Record<string, (a: Args) => [string, unknown[]]> = {
  find_clients: (a) => [
    `select code, legal_name, trade_name, status, country_code, vat_number, billing_email, '/clients/' || id as link from clients
      where $1 = '' or legal_name ilike '%' || $1 || '%' or trade_name ilike '%' || $1 || '%' order by legal_name limit ${LIMIT}`, [term(a)]],
  list_orders: (a) => [
    `select code, status, client, total_packs, requested_date::text, '/orders/' || id as link from sales_order_overview
      where ($1 = '' or client ilike '%' || $1 || '%') and ($2 = '' or status::text = $2) order by code desc limit ${LIMIT}`, [term(a), a.status ?? ""]],
  order_details: (a) => [
    `select so.code, so.status, c.legal_name as client, so.currency, so.vat_pct, so.deposit_pct, so.deposit_amount, so.deposit_received_on::text,
            so.balance_terms, so.balance_received_on::text, so.requested_date::text, so.customer_ref, so.notes,
            '/orders/' || so.id as link, '/clients/' || so.client_id as client_link,
            (select json_agg(json_build_object('purpose', i.purpose, 'number', i.number, 'status', i.status, 'total', i.total, 'link', '/invoices/' || i.id))
               from invoices i where i.order_id = so.id) as invoices,
            -- Pages to act on the order; an invoice link opens the invoice, or one click there makes its draft
            json_strip_nulls(json_build_object(
              'proforma', '/orders/' || so.id || '/proforma',
              'final_proforma', case when two.v and order_production_done(so.id) then '/orders/' || so.id || '/proforma?final=1' end,
              'advance_invoice', case when two.v and so.deposit_received_on is not null and paid.v then '/orders/' || so.id || '/invoice?purpose=advance' end,
              'final_invoice', case when two.v and so.balance_received_on is not null and paid.v then '/orders/' || so.id || '/invoice?purpose=final' end,
              'invoice', case when not two.v and paid.v then '/orders/' || so.id || '/invoice?purpose=full' end,
              'payments_and_tasks', '/orders/' || so.id,
              'dispatch', case when so.status = 'ready' then '/orders/' || so.id || '#dispatch-h' end)) as links,
            (select json_agg(json_build_object('product', coalesce(l.description, f.name), 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.sort_order)
               from sales_order_lines l left join formula_versions v on v.id = l.formula_version_id left join formulas f on f.id = v.formula_id
              where l.order_id = so.id) as lines,
            (select json_agg(json_build_object('code', m.code, 'status', m.status, 'quantity', m.quantity, 'produced', m.produced_quantity, 'planned', m.planned_date, 'link', '/production/' || m.id) order by m.code)
               from manufacturing_orders m join sales_order_lines l on l.id = m.sales_order_line_id where l.order_id = so.id) as batches
       from sales_orders so join clients c on c.id = so.client_id
       cross join lateral (select order_paid_in_two(so.id) as v) two
       cross join lateral (select so.status not in ('draft', 'unpaid', 'cancelled') as v) paid
      where so.code = $1`, [(a.code ?? "").trim().toUpperCase()]],
  find_stock: (a) => [
    `select i.sku, i.name, i.name_bg, s.available, s.base_unit
       from item_stock_summary s join items i on i.id = s.item_id
      where $1 = '' or i.name ilike '%' || $1 || '%' or i.name_bg ilike '%' || $1 || '%' or i.sku ilike '%' || $1 || '%' order by i.name limit ${LIMIT}`, [term(a)]],
  expiring_lots: () => [
    `select lot_number, item_name, days_left, quantity from expiring_lots order by days_left limit ${LIMIT}`, []],
  find_recipes: (a) => [
    `select f.code, f.name, f.name_bg, f.product_format, f.is_active, c.legal_name as client, '/formulas/' || f.id as link,
            (select v.status from formula_versions v where v.formula_id = f.id order by v.version desc limit 1) as latest_status
       from formulas f left join clients c on c.id = f.client_id
      where $1 = '' or f.name ilike '%' || $1 || '%' or f.name_bg ilike '%' || $1 || '%' or f.code ilike '%' || $1 || '%' order by f.code desc limit ${LIMIT}`, [term(a)]],
  find_invoices: (a) => [
    `select i.number, i.kind, i.status, i.buyer ->> 'name' as client, so.code as order_code, i.issue_date::text, i.due_date::text, i.total, i.currency, '/invoices/' || i.id as link,
            case when i.status = 'issued' and i.kind = 'invoice' then invoice_open_amount(i.id) end as left_to_pay
       from invoices i left join sales_orders so on so.id = i.order_id
      where $1 = '' or i.number ilike '%' || $1 || '%' or i.buyer ->> 'name' ilike '%' || $1 || '%' or so.code ilike '%' || $1 || '%'
      order by i.created_at desc limit ${LIMIT}`, [term(a)]],
  production_details: (a) => [
    `select m.code, m.status, m.quantity, m.produced_quantity, m.planned_date::text, m.produced_on::text, f.code as recipe, f.name as product, so.code as sales_order, '/production/' || m.id as link
       from manufacturing_orders m
       left join formula_versions v on v.id = m.formula_version_id left join formulas f on f.id = v.formula_id
       left join sales_order_lines l on l.id = m.sales_order_line_id left join sales_orders so on so.id = l.order_id
      where m.code = $1`, [(a.code ?? "").trim().toUpperCase()]],
  find_lots: (a) => ["select lot_number, supplier_lot, sku, name, qc_status, expires_on::text from trace_find_lots($1) limit 25", [term(a)]],
  mail_waiting_reply: () => [
    `select client, from_address, subject, snippet, sent_at::text from emails_waiting_reply order by sent_at limit ${LIMIT}`, []],
  search_client_mail: (a) => [
    `select c.legal_name as client, c.code as client_code, e.direction, e.from_address, e.to_addresses, e.subject,
            left(e.body, 1500) as body, e.has_attachments, e.sent_at::text
       from client_emails e join clients c on c.id = e.client_id
      where c.legal_name ilike '%' || $1 || '%' or c.trade_name ilike '%' || $1 || '%' or c.code ilike $1
         or e.from_address ilike '%' || $1 || '%' or e.subject ilike '%' || $1 || '%' or e.body ilike '%' || $1 || '%'
      order by e.sent_at desc limit 20`, [term(a)]],
  eu_health_claims: (a) => [
    `select code, substance, claim, conditions, restrictions, status, claim_type, (select downloaded_on::text from eu_lists_info limit 1) as list_date
       from eu_health_claims where status = $2 and (substance ilike '%' || $1 || '%' or claim ilike '%' || $1 || '%')
      order by substance limit 30`, [term(a), a.status || "authorised"]],
  eu_novel_food_status: (a) => [
    `select code, name, synonyms, common_names, parts, description, (select downloaded_on::text from eu_lists_info limit 1) as list_date
       from eu_novel_food_status where name ilike '%' || $1 || '%' or synonyms ilike '%' || $1 || '%' or common_names ilike '%' || $1 || '%'
      order by name limit 15`, [term(a)]],
  find_materials: (a) => ["select * from recipe_materials($1)", [term(a)]],
  recipe_details: (a) => [
    `select f.code, f.name, v.version, v.status, f.product_format, f.serving_size, f.serving_unit, f.servings_per_pack, '/formulas/' || f.id as link,
            (select json_agg(json_build_object('ingredient', d.name, 'amount', d.amount, 'unit', d.unit) order by d.sort_order, d.name)
               from formula_line_details d where d.version_id = v.id) as lines
       from formulas f join formula_versions v on v.formula_id = f.id
      where f.code = $1 order by v.version desc limit 1`, [(a.code ?? "").trim().toUpperCase()]],
};

/** The result of a tool as text for the model; a failure is reported to the model, not thrown. */
export async function runTool(userId: string, conversationId: string, name: string, rawArgs: string): Promise<string> {
  if (name === "propose_recipe") {
    try {
      const [{ r }] = await q<{ r: unknown }>(userId, "select add_recipe_proposal($1, $2::jsonb, $3) as r", [conversationId, rawArgs, CAPSULE_SIZES[CAPSULE_SIZE]]);
      return JSON.stringify(r);
    } catch (e) {
      console.error("AI tool propose_recipe", e);
      return JSON.stringify({ error: e instanceof Error ? e.message.split("\n")[0] : "The proposal could not be saved" });
    }
  }
  if (MAIL_TOOLS.some((t) => t.name === name) && process.env.AI_READ_MAIL?.trim() !== "on") return JSON.stringify({ error: "Mail is not available" });
  if (name === "search_gmail") {
    // The same people who may read saved client mail (Admin and Sales), checked by the database
    const [{ ok }] = await q<{ ok: boolean }>(userId, "select has_role('admin', 'sales') as ok");
    if (!ok) return JSON.stringify({ error: "Mail is not available to this account" });
    const { query = "" } = JSON.parse(rawArgs || "{}") as { query?: string };
    return JSON.stringify(await searchMailbox(String(query)));
  }
  const query = QUERIES[name];
  if (!query) return JSON.stringify({ error: "Unknown tool" });
  try {
    const [sql, params] = query(JSON.parse(rawArgs || "{}") as Args);
    return JSON.stringify(await q(userId, sql, params));
  } catch (e) {
    console.error(`AI tool ${name}`, e);
    return JSON.stringify({ error: "The data could not be read" });
  }
}
