import { q } from "@/lib/db/engine";
import type { ToolDefinition } from "./gateway";

// What the assistant can read. Fixed queries only, each run as the signed-in user, so row-level security decides
// what comes back. Nothing here writes: text in the data (client notes, for example) cannot make the assistant act.

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
  tool("find_stock", "Stock of items by name or SKU: available, reorder level, unit.", TERM),
  tool("low_stock", "Items below their reorder level."),
  tool("expiring_lots", "Lots close to their expiry date."),
  tool("find_recipes", "Recipes by name or code, with format and latest version status.", TERM),
  tool("recipe_details", "Ingredients and amounts per serving of the latest version of one recipe, by its code (NK-F-0001).",
    { code: { type: "string", description: "Recipe code" } }),
];

const QUERIES: Record<string, (a: Args) => [string, unknown[]]> = {
  find_clients: (a) => [
    `select code, legal_name, trade_name, status, country_code, vat_number, billing_email from clients
      where $1 = '' or legal_name ilike '%' || $1 || '%' or trade_name ilike '%' || $1 || '%' order by legal_name limit ${LIMIT}`, [term(a)]],
  list_orders: (a) => [
    `select code, status, client, total_packs, requested_date::text from sales_order_overview
      where ($1 = '' or client ilike '%' || $1 || '%') and ($2 = '' or status::text = $2) order by code desc limit ${LIMIT}`, [term(a), a.status ?? ""]],
  order_details: (a) => [
    `select so.code, so.status, c.legal_name as client, so.currency, so.vat_pct, so.deposit_pct, so.deposit_amount, so.deposit_received_on::text,
            so.balance_terms, so.balance_received_on::text, so.requested_date::text, so.customer_ref, so.notes,
            (select json_agg(json_build_object('product', coalesce(l.description, f.name), 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.sort_order)
               from sales_order_lines l left join formula_versions v on v.id = l.formula_version_id left join formulas f on f.id = v.formula_id
              where l.order_id = so.id) as lines,
            (select json_agg(json_build_object('code', m.code, 'status', m.status, 'quantity', m.quantity, 'produced', m.produced_quantity, 'planned', m.planned_date) order by m.code)
               from manufacturing_orders m join sales_order_lines l on l.id = m.sales_order_line_id where l.order_id = so.id) as batches
       from sales_orders so join clients c on c.id = so.client_id where so.code = $1`, [(a.code ?? "").trim().toUpperCase()]],
  find_stock: (a) => [
    `select i.sku, i.name, i.name_bg, s.available, s.reorder_level, s.base_unit
       from item_stock_summary s join items i on i.id = s.item_id
      where $1 = '' or i.name ilike '%' || $1 || '%' or i.name_bg ilike '%' || $1 || '%' or i.sku ilike '%' || $1 || '%' order by i.name limit ${LIMIT}`, [term(a)]],
  low_stock: () => [
    `select i.sku, i.name, s.available, s.reorder_level, s.base_unit from item_stock_summary s join items i on i.id = s.item_id
      where s.below_reorder_level order by i.name limit ${LIMIT}`, []],
  expiring_lots: () => [
    `select lot_number, item_name, days_left, quantity from expiring_lots order by days_left limit ${LIMIT}`, []],
  find_recipes: (a) => [
    `select f.code, f.name, f.name_bg, f.product_format, f.is_active, c.legal_name as client,
            (select v.status from formula_versions v where v.formula_id = f.id order by v.version desc limit 1) as latest_status
       from formulas f left join clients c on c.id = f.client_id
      where $1 = '' or f.name ilike '%' || $1 || '%' or f.name_bg ilike '%' || $1 || '%' or f.code ilike '%' || $1 || '%' order by f.code desc limit ${LIMIT}`, [term(a)]],
  recipe_details: (a) => [
    `select f.code, f.name, v.version, v.status, f.product_format, f.serving_size, f.serving_unit, f.servings_per_pack,
            (select json_agg(json_build_object('ingredient', d.name, 'amount', d.amount, 'unit', d.unit) order by d.sort_order, d.name)
               from formula_line_details d where d.version_id = v.id) as lines
       from formulas f join formula_versions v on v.formula_id = f.id
      where f.code = $1 order by v.version desc limit 1`, [(a.code ?? "").trim().toUpperCase()]],
};

/** The result of a tool as text for the model; a failure is reported to the model, not thrown. */
export async function runTool(userId: string, name: string, rawArgs: string): Promise<string> {
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
