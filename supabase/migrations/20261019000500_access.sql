-- =====================================================================
-- Nutrikal ERP + CRM — Phase 1 — 0005 access control (row-level security)
--
--                     admin   sales   inventory   partner
-- profiles            all     read    read        own row
-- company settings    write   read    read        —
-- clients             all     write   read        —
-- contacts/activities all     write   —           —
-- projects            all     write   read        code only (partner_projects)
-- items               write   read    write       read
-- suppliers           write   —*      write       —
-- purchase prices     write   —*      write       —
-- locations           write   read    read        partner locations
-- lots / movements    read    read    read        partner locations only
-- (* sales users with can_see_purchase_prices = true can read)
--
-- Stock tables have no insert/update/delete policies: they are written
-- only by the security-definer functions in 0004, which check roles.
-- =====================================================================

alter table public.profiles                  enable row level security;
alter table public.company_settings          enable row level security;
alter table public.audit_log                 enable row level security;
alter table public.number_series             enable row level security;
alter table public.clients                   enable row level security;
alter table public.contacts                  enable row level security;
alter table public.projects                  enable row level security;
alter table public.activities                enable row level security;
alter table public.client_files              enable row level security;
alter table public.items                     enable row level security;
alter table public.suppliers                 enable row level security;
alter table public.supplier_items            enable row level security;
alter table public.supplier_prices           enable row level security;
alter table public.locations                 enable row level security;
alter table public.lots                      enable row level security;
alter table public.stock_movements           enable row level security;
alter table public.stock_reservations        enable row level security;
alter table public.stock_adjustment_requests enable row level security;

-- ---------------------------------------------------------------- core
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy company_settings_select on public.company_settings for select to authenticated
  using (public.is_staff());
create policy company_settings_update on public.company_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy audit_log_select on public.audit_log for select to authenticated
  using (public.has_role('admin'));

create policy number_series_select on public.number_series for select to authenticated
  using (public.is_staff());
create policy number_series_update on public.number_series for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- ----------------------------------------------------------------- CRM
create policy clients_select on public.clients for select to authenticated
  using (public.has_role('admin', 'sales', 'inventory'));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.has_role('admin', 'sales'));
create policy clients_update on public.clients for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy clients_delete on public.clients for delete to authenticated
  using (public.has_role('admin'));

create policy contacts_all on public.contacts for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

create policy projects_select on public.projects for select to authenticated
  using (public.has_role('admin', 'sales', 'inventory'));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.has_role('admin', 'sales'));
create policy projects_update on public.projects for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy projects_delete on public.projects for delete to authenticated
  using (public.has_role('admin'));

create policy activities_all on public.activities for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

create policy client_files_select on public.client_files for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy client_files_insert on public.client_files for insert to authenticated
  with check (public.has_role('admin', 'sales'));
create policy client_files_delete on public.client_files for delete to authenticated
  using (public.has_role('admin'));

-- --------------------------------------------------- items & suppliers
create policy items_select on public.items for select to authenticated
  using (public.current_app_role() is not null);
create policy items_insert on public.items for insert to authenticated
  with check (public.has_role('admin', 'inventory'));
create policy items_update on public.items for update to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));
create policy items_delete on public.items for delete to authenticated
  using (public.has_role('admin'));

create policy suppliers_select on public.suppliers for select to authenticated
  using (public.has_role('admin', 'inventory') or public.can_see_purchase_prices());
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (public.has_role('admin', 'inventory'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));
create policy suppliers_delete on public.suppliers for delete to authenticated
  using (public.has_role('admin'));

create policy supplier_items_select on public.supplier_items for select to authenticated
  using (public.has_role('admin', 'inventory') or public.can_see_purchase_prices());
create policy supplier_items_write on public.supplier_items for all to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));

create policy supplier_prices_select on public.supplier_prices for select to authenticated
  using (public.can_see_purchase_prices());
create policy supplier_prices_insert on public.supplier_prices for insert to authenticated
  with check (public.has_role('admin', 'inventory'));
create policy supplier_prices_update on public.supplier_prices for update to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));
create policy supplier_prices_delete on public.supplier_prices for delete to authenticated
  using (public.has_role('admin'));

-- ----------------------------------------------------------- inventory
create policy locations_select on public.locations for select to authenticated
  using (public.is_staff() or (public.has_role('partner') and is_partner_visible and is_active));
create policy locations_admin_write on public.locations for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy lots_select on public.lots for select to authenticated
  using (
    public.is_staff()
    or (public.has_role('partner') and exists (
          select 1 from public.stock_movements m
           where m.lot_id = lots.id and public.is_partner_location(m.location_id)))
  );
-- Notes, COA path and expiry corrections; QC status is guarded by trigger (Admin only)
create policy lots_update on public.lots for update to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));

create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.is_staff() or (public.has_role('partner') and public.is_partner_location(location_id)));

create policy stock_reservations_select on public.stock_reservations for select to authenticated
  using (public.is_staff()
         or (public.has_role('partner') and location_id is not null and public.is_partner_location(location_id)));

create policy stock_adjustment_requests_select on public.stock_adjustment_requests for select to authenticated
  using (public.has_role('admin', 'inventory') or requested_by = auth.uid());

-- ----------------------------------------------------------- functions
-- Callable by signed-in users only; each function checks the role itself.
revoke execute on function
  public.next_number(text),
  public.receive_lot(uuid, uuid, numeric, uuid, text, date, date, text, text, uuid),
  public.post_stock_movement(public.movement_type, uuid, uuid, numeric, text, uuid, text),
  public.transfer_stock(uuid, uuid, uuid, numeric, text, text),
  public.set_lot_qc_status(uuid, public.qc_status, text),
  public.reserve_stock(uuid, uuid, numeric, uuid, uuid, text),
  public.close_reservation(uuid, public.reservation_status),
  public.request_stock_adjustment(uuid, uuid, numeric, text),
  public.decide_stock_adjustment(uuid, boolean, text),
  public.enable_audit(regclass),
  public.audit_trigger()
from public, anon;

grant execute on function
  public.next_number(text),
  public.receive_lot(uuid, uuid, numeric, uuid, text, date, date, text, text, uuid),
  public.post_stock_movement(public.movement_type, uuid, uuid, numeric, text, uuid, text),
  public.transfer_stock(uuid, uuid, uuid, numeric, text, text),
  public.set_lot_qc_status(uuid, public.qc_status, text),
  public.reserve_stock(uuid, uuid, numeric, uuid, uuid, text),
  public.close_reservation(uuid, public.reservation_status),
  public.request_stock_adjustment(uuid, uuid, numeric, text),
  public.decide_stock_adjustment(uuid, boolean, text)
to authenticated;

revoke all on public.partner_projects from anon;
grant select on public.partner_projects to authenticated;
