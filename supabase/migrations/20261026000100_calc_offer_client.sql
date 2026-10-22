-- =====================================================================
-- Nutrikal ERP + CRM — calculator offers are for a CRM client
-- Flow (owner, Oct 2026): Sales first creates the client in Clients (all
-- the client details the calculator used to ask for live there now), then
-- picks the client in the calculator. The offer keeps a snapshot of the
-- client's details for its PDF and links to the client (client_id).
-- Older offers have no client (null).
--
-- Rights are those of the tables (no new table):
--   calc_offers.client_id        admin, sales (as calc_offers)
--   clients.registration_address admin, sales (as clients); production —
-- =====================================================================

alter table public.calc_offers add column if not exists client_id uuid references public.clients (id);
create index if not exists calc_offers_client_idx on public.calc_offers (client_id);

-- Registered (invoice) address when it differs from the address
alter table public.clients add column if not exists registration_address text;
