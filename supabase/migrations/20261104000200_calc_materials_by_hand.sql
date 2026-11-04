-- =====================================================================
-- Nutrikal ERP + CRM — the calculator price list is kept in the app
-- (owner, Nov 2026): the Google Sheet sync is gone. Under Offers > Raw
-- materials, Admin and Sales add a raw material (calc_add_raw_material),
-- change its name and price per kg, or delete it. Saved offers keep their
-- own copy of the materials, so a change or a delete does not alter them.
-- Production: no access (as before, only admin and sales).
-- =====================================================================

comment on table public.calc_raw_materials is
  'Calculator price list, kept in the app (Offers > Raw materials); no longer synced from the Google Sheet.';

-- Admin, sales: change the name and the price per kg of a raw material
create or replace function public.calc_update_raw_material(p_id uuid, p_name text, p_price numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_other text;
begin
  perform public.require_role('admin', 'sales');
  if v_name = '' then
    raise exception 'Enter the name of the raw material';
  end if;
  if length(v_name) > 200 then
    raise exception 'The name is too long (200 characters at most)';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Enter a price per kg above 0';
  end if;
  select name into v_other from public.calc_raw_materials where lower(name) = lower(v_name) and id <> p_id limit 1;
  if found then
    raise exception 'The raw material "%" is already in the price list', v_other;
  end if;

  update public.calc_raw_materials
     set name = v_name, price_eur_per_kg = round(p_price, 4)
   where id = p_id;
  if not found then
    raise exception 'Raw material not found';
  end if;
end
$$;

-- Admin, sales: delete a raw material from the price list
create or replace function public.calc_delete_raw_material(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  delete from public.calc_raw_materials where id = p_id;
  if not found then
    raise exception 'Raw material not found';
  end if;
end
$$;

revoke execute on function public.calc_update_raw_material(uuid, text, numeric) from public, anon;
revoke execute on function public.calc_delete_raw_material(uuid) from public, anon;
grant execute on function public.calc_update_raw_material(uuid, text, numeric) to authenticated;
grant execute on function public.calc_delete_raw_material(uuid) to authenticated;
