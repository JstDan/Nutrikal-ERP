-- Payment dates (deposit / balance received on) are entered by admin only (owner, 27 Oct 2026).
-- Admin's functions (confirm_order_payment, confirm_final_payment) and the admin status change
-- unpaid -> confirmed set them; sales can no longer type or clear them.
create or replace function public.sales_orders_payment_dates_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.deposit_received_on, new.balance_received_on) is distinct from
     (old.deposit_received_on, old.balance_received_on)
     and not public.has_role('admin') then
    raise exception 'Only admin enters the payment dates' using errcode = '42501';
  end if;
  return new;
end
$$;

-- Runs after sales_orders_guard (alphabetical), so dates that guard fills in are checked too
create trigger sales_orders_payment_dates_guard before update on public.sales_orders
  for each row execute function public.sales_orders_payment_dates_guard();
