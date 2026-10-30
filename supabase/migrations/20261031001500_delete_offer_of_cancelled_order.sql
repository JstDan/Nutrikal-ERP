-- =====================================================================
-- Nutrikal ERP + CRM — delete a calculator offer whose order is cancelled
-- Owner, 30 Oct 2026: an offer of a cancelled order can be deleted under
-- Offers. An offer in an order that is not cancelled stays fixed (as before).
-- The lines of the cancelled order keep their description, quantity and
-- price; only their link to the offer is cleared.
--
-- Who may delete is unchanged: admin any offer, sales their own.
-- =====================================================================

alter table public.sales_order_lines drop constraint sales_order_lines_kind_chk;
alter table public.sales_order_lines add constraint sales_order_lines_kind_chk check (
  (kind = 'offer' and offer_id is not null and project_id is not null and formula_version_id is not null)
  -- calc_offer_id is cleared when the offer of a cancelled order is deleted
  or (kind = 'calc_offer' and offer_id is null and description is not null
      and (formula_version_id is null) = (project_id is null))
  or (kind = 'service' and offer_id is null and calc_offer_id is null and project_id is null
      and formula_version_id is null and description is not null)
);

create or replace function public.calc_offers_in_order_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_link text;
begin
  if exists (select 1 from public.sales_order_lines l join public.sales_orders so on so.id = l.order_id
              where l.calc_offer_id = old.id and so.status <> 'cancelled') then
    raise exception 'Offer % is in an order and can no longer be changed', old.offer_no;
  end if;
  if tg_op = 'DELETE' then
    -- Only cancelled orders are left: their lines lose the link to the offer
    v_link := current_setting('nk.line_link', true);
    perform set_config('nk.line_link', 'on', true);
    update public.sales_order_lines set calc_offer_id = null where calc_offer_id = old.id;
    perform set_config('nk.line_link', coalesce(v_link, 'off'), true);
    return old;
  end if;
  return new;
end
$$;
revoke execute on function public.calc_offers_in_order_guard() from public, anon, authenticated;
