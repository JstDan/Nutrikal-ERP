-- Owner, Nov 2026: everything in the Nutrikal warehouse (NK-WH) moves to
-- Производство (G-PRO), lot by lot, as paired transfers in the ledger.
-- Active reservations follow the stock. NK-WH stays open for later use;
-- open purchase orders and deliveries keep the store they were made for.

do $$
declare
  v_from uuid := (select id from public.locations where code = 'NK-WH');
  v_to   uuid := (select id from public.locations where code = 'G-PRO');
  v_grp  uuid;
  b      record;
begin
  if v_from is null or v_to is null then
    return;
  end if;
  for b in
    select m.lot_id, sum(m.quantity) as q
      from public.stock_movements m
     where m.location_id = v_from
     group by m.lot_id
    having sum(m.quantity) > 0
  loop
    v_grp := gen_random_uuid();
    insert into public.stock_movements (movement_group, type, lot_id, location_id, quantity, reason, reference)
    values (v_grp, 'transfer_out', b.lot_id, v_from, -b.q, 'Nutrikal stock moved to production', 'NK-WH>G-PRO'),
           (v_grp, 'transfer_in',  b.lot_id, v_to,    b.q, 'Nutrikal stock moved to production', 'NK-WH>G-PRO');
  end loop;

  update public.stock_reservations set location_id = v_to
   where location_id = v_from and status = 'active';
end $$;
