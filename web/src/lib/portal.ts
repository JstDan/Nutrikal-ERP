// What the customer panel reads. Every row comes from a portal_ function, limited to the client of the signed-in account.
import { q } from "@/lib/db/engine";

export type PortalOrderRow = {
  id: string; code: string; status: string; customer_ref: string | null; requested_date: string | null; created_at: string;
  dispatched_at: string | null; currency: string; value: string; due: string; products: number; unread: number;
};
export type PortalOrder = {
  id: string; code: string; status: string; customer_ref: string | null; requested_date: string | null; currency: string; value: number; due: number;
  deposit_pct: number | null; confirmed_at: string | null; deposit_received_on: string | null; balance_received_on: string | null;
  dispatched_at: string | null; production_started_at: string | null;
  lines: { description: string; kind: string; quantity: number; unit_price: number }[];
  batches: { lot_id: string; lot_number: string; quantity: number; produced_on: string | null; expires_on: string | null; released: boolean; coa: boolean }[];
  dispatches: { id: string; code: string; dispatched_on: string; carrier: string | null; tracking: string | null }[];
};
export type PortalInvoiceRow = {
  id: string; kind: "invoice" | "credit_note" | "debit_note"; number: string; issue_date: string; due_date: string | null;
  currency: string; total: string; open_amount: string | null; order_id: string | null; order_code: string | null;
};
export type PortalDocument = { kind: "file" | "coa"; id: string; name: string; category: string; note: string | null; shared_at: string | null; order_id: string | null; order_code: string | null };
export type PortalMessage = { id: string; from_client: boolean; author: string; body: string; created_at: string };

export const portalOrders = (user: string) =>
  q<PortalOrderRow>(user, "select id, code, status, customer_ref, requested_date::text, created_at::text, dispatched_at::text, currency, value::text, due::text, products, unread from portal_orders()");
export const portalInvoices = (user: string) =>
  q<PortalInvoiceRow>(user, "select id, kind, number, issue_date::text, due_date::text, currency, total::text, open_amount::text, order_id, order_code from portal_invoices()");
export const portalDocuments = (user: string, order: string | null = null) =>
  q<PortalDocument>(user, "select kind, id, name, category, note, shared_at::text, order_id, order_code from portal_documents($1)", [order]);
export const portalFeed = (user: string, order: string | null = null) =>
  q<PortalMessage>(user, "select id, from_client, author, body, created_at::text from portal_feed($1)", [order]);

/** Reading a conversation clears its unread mark. */
export const portalMarkRead = (user: string, order: string | null = null) => q(user, "select portal_mark_read($1)", [order]);

export type PortalThreadRow = { order_id: string | null; order_code: string | null; status: "open" | "waiting" | "solved"; last_at: string; last_body: string | null; unread: number };
export const portalThreads = (user: string) =>
  q<PortalThreadRow>(user, "select order_id, order_code, status, last_at::text, last_body, unread from portal_threads()");

export const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
