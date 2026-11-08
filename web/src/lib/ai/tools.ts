import { q } from "@/lib/db/engine";
import { searchMailbox } from "@/lib/gmail";
import { CAPSULE_SIZE, CAPSULE_SIZES } from "@/lib/calculator/types";
import type { ToolDefinition } from "./gateway";
import { MY_DAY, OVERVIEW, QUERIES, type Args } from "./queries";

// What the assistant can read. Fixed queries only (queries.ts), each run as the signed-in user, so row-level security
// decides what comes back. Nothing here changes company data: text in the data (client notes, e-mails) cannot make the
// assistant act. propose_recipe and remember only keep a proposal; a person turns it into a draft recipe or an
// approved note (owner, Oct-Nov 2026: AI proposes, a person approves).

const tool = (name: string, description: string, properties: Record<string, unknown> = {}): ToolDefinition => ({
  name, description, parameters: { type: "object", properties, additionalProperties: false },
});
const TERM = { term: { type: "string", description: "A name, code or words; Cyrillic or Latin, typos are fine. Empty for all." } };
const ONE = (what: string) => ({ term: { type: "string", description: `The ${what}: its name or code, Cyrillic or Latin; the best match is taken` } });
const CODE = (what: string) => ({ code: { type: "string", description: what } });
const RANGE = {
  from: { type: "string", description: "First day, YYYY-MM-DD" },
  to: { type: "string", description: "Last day, YYYY-MM-DD" },
};

export const AI_TOOLS: ToolDefinition[] = [
  // The whole company at a glance
  tool("company_overview", "What needs attention across the company right now: orders waiting for payment or dispatch, batches in the next 14 days, dates the partner proposed, finished batches waiting for release, overdue invoices, missing materials, late deliveries, expiring or blocked lots, unread client messages, pending label approvals and reorders, new catalogue enquiries, offers without answer, clients due to reorder, contracts waiting. Use it for 'what is going on', 'what should we do', priorities, daily or weekly briefings."),
  tool("my_day", "The day of the person asking: their board cards (overdue first), order tasks assigned to them, CRM to-dos, unread notifications and their clients' unread messages. Use it for 'what do I have today', 'my tasks'."),
  tool("find_anything", "One search over clients, items, recipes, catalogue products, orders, offers, batches and projects at once, with the kind and link of each. Use it when you do not know what kind of record a name or code is.", TERM),
  // Clients and sales
  tool("find_clients", "Find clients by name, code or VAT number, with status, country and billing e-mail.", TERM),
  tool("client_overview", "Everything about one client: details, responsible person, contacts, projects, last orders with totals, unpaid invoices, offers, recipes, recent CRM activities, open conversations and when a reorder is expected.", ONE("client")),
  tool("list_orders", "Sales orders, newest first, with total incl. VAT, optionally by client or code and status (unpaid, confirmed, in_production, ready, dispatched, closed, cancelled).",
    { ...TERM, status: { type: "string", description: "Order status; empty for all" } }),
  tool("order_details", "One sales order by its code (SO-00001): lines, prices, totals, payments, invoices, batches, open tasks with who has them, dispatches, contract, and the links to act on it.", CODE("Order code")),
  tool("list_offers", "Calculator offers, newest first, by number, client or product.", TERM),
  tool("offer_details", "One offer by its number (NK-2026-9005): client, product, totals and the full offer data (format, quantities, tiers, composition).", CODE("Offer number")),
  tool("receivables", "Money owed: issued invoices not fully paid (with days overdue), orders waiting for the advance, orders waiting for the balance."),
  tool("sales_figures", "Admin only: the figures of the admin dashboard for a period (money received and invoiced, sales by client and product, stock value, purchasing, production costs). Default: this month.", RANGE),
  tool("client_messages_waiting", "Open conversations with clients in the customer panel: last message, unread count, who is responsible."),
  tool("catalog_enquiries", "New enquiries from the open catalogue (catalog.nutrikal.com): company, products, quantities, message."),
  // Production, stock, purchasing
  tool("production_schedule", "Batches planned in a period (default the next 30 days): date, whether the partner confirmed it or proposed another, product, order and client.", RANGE),
  tool("production_details", "One batch by its code (MO-00001) or batch number: status, quantities, dates, recipe, order, client and its finished lot.", CODE("Manufacturing order code or batch number")),
  tool("find_stock", "Stock of items by name or SKU: on hand, reserved, available, in quarantine, incoming and the next delivery.", TERM),
  tool("item_overview", "Everything about one item (raw material, packaging, finished good): stock, lots with warehouse, expiry and quality status, reservations by batch, expected deliveries, purchase requests and the recipes that use it.", ONE("item")),
  tool("expiring_lots", "Lots close to their expiry date."),
  tool("find_lots", "Lots by lot number, supplier lot or item: quality status and expiry date.", TERM),
  tool("purchasing_status", "Purchasing: missing materials for orders, open purchase requests, expected deliveries (late and partial ones marked) and recent purchase orders."),
  tool("find_suppliers", "Suppliers by name or by a material they supply: approval, contact and what they supply.", TERM),
  // Recipes and regulation
  tool("find_recipes", "Recipes by name or code, with format, client and latest version status.", TERM),
  tool("recipe_details", "Ingredients and amounts per serving of the latest version of one recipe, by its code (NK-F-0001).", CODE("Recipe code")),
  tool("find_materials", "Raw materials and excipients in the system by name or SKU, with stock, price per base unit when the person may see it, and Novel Food status. Recipes can use only these.", TERM),
  tool("eu_health_claims", "The EU Register of health claims: exact wording, conditions of use and status, by substance or words of the claim. Status: authorised (default), non_authorised, revoked.",
    { ...TERM, status: { type: "string", enum: ["authorised", "non_authorised", "revoked"] } }),
  tool("eu_novel_food_status", "The EU Novel Food status Catalogue, by name, synonym or common name: the status per part of the source. Search by the source (Camellia sinensis, magnesium) as well as by the ingredient.", TERM),
  // The team
  tool("search_team_chat", "Messages of the internal chat the person may read, by words: channel, author, date and link.", TERM),
  tool("recent_changes", "What was created, changed or deleted in the last days (the audit log; Admin), optionally for one table (sales_orders, invoices, lots, items, formulas, clients…).", {
    days: { type: "integer", description: "How many days back, 1 to 30" },
    status: { type: "string", description: "A table name, or empty for all" },
  }),
  // Proposals: a person decides
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
  tool("remember", "Propose a lasting note for your memory when the person asks you to remember something about the company, a client, a supplier or how the team works. Admin approves it under Settings; then you know it in every conversation. One fact per note, in a full sentence that makes sense on its own, in the language of the conversation; never figures that the system already holds (stock, prices, balances).", {
    note: { type: "string", description: "The fact, at most 1000 characters" },
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

/** Several parts read one by one: a part the person may not read is left out instead of failing the whole answer. */
async function readParts(userId: string, parts: Record<string, string>): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const [key, sql] of Object.entries(parts)) {
    try {
      const rows = await q(userId, sql);
      if (rows.length) out[key] = rows;
    } catch {
      // No rights on this part for the role
    }
  }
  return JSON.stringify(Object.keys(out).length ? out : { note: "Nothing needs attention, or nothing this account may read" });
}

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
  if (name === "remember") {
    const { note = "" } = JSON.parse(rawArgs || "{}") as { note?: string };
    const text = String(note).trim().slice(0, 1000);
    if (!text) return JSON.stringify({ error: "Empty note" });
    try {
      await q(userId, "insert into ai_knowledge (body, status) values ($1, 'proposed')", [text]);
      return JSON.stringify({ ok: true, note: "Proposed. Admin approves it under Settings > Nutri AI; until then it is not used." });
    } catch {
      return JSON.stringify({ error: "This account cannot propose notes" });
    }
  }
  if (name === "company_overview") return readParts(userId, OVERVIEW);
  if (name === "my_day") return readParts(userId, MY_DAY);
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
    const rows = await q(userId, sql, params);
    return JSON.stringify(rows.length ? rows : { note: "Nothing found" });
  } catch (e) {
    console.error(`AI tool ${name}`, e);
    const msg = e instanceof Error ? e.message.split("\n")[0] : "";
    return JSON.stringify({ error: /permission|not allowed|row-level/i.test(msg) ? "This account may not read this" : "The data could not be read" });
  }
}
