-- =====================================================================
-- Nutrikal ERP + CRM — expiry date and batch number of a lot in stock
-- (owner, Nov 2026): under Stock, Admin picks a raw material (or any item)
-- and adds or changes the expiry date and the supplier's batch number of
-- each of its lots. Both are optional; an empty value clears it. Every
-- change is kept in audit_log (lots are audited). Quantities are not
-- touched (the ledger stays as it is).
--
--              admin   sales / bookkeeper / others   production
-- set_lot_details  yes  no                            no
-- =====================================================================

create or replace function public.set_lot_details(p_lot uuid, p_expires_on date, p_supplier_lot text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_batch text := nullif(btrim(regexp_replace(coalesce(p_supplier_lot, ''), '\s+', ' ', 'g')), '');
  v_made  date;
begin
  perform public.require_role('admin');
  if v_batch is not null and length(v_batch) > 100 then
    raise exception 'The batch number is too long (100 characters at most)';
  end if;
  select manufactured_on into v_made from public.lots where id = p_lot;
  if not found then
    raise exception 'Lot not found';
  end if;
  if p_expires_on is not null and v_made is not null and p_expires_on <= v_made then
    raise exception 'The expiry date must be after the manufacturing date (%)', to_char(v_made, 'DD/MM/YYYY');
  end if;

  update public.lots set expires_on = p_expires_on, supplier_lot = v_batch where id = p_lot;
end
$$;

revoke execute on function public.set_lot_details(uuid, date, text) from public, anon;
grant execute on function public.set_lot_details(uuid, date, text) to authenticated;
