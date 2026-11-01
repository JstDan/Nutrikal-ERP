-- Default payment terms (owner, Nov 2026): 60% deposit, 40% before dispatch.
-- A client or an order can still have its own.
update public.company_settings set default_deposit_pct = 60;
