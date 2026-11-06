-- The company's name, address and offer terms in Bulgarian, for documents downloaded in Bulgarian
-- (owner, Nov 2026: "Nutrikal Ltd" is НУТРИКАЛ ЕООД on a Bulgarian document). Admin edits them under Settings.
alter table public.calc_settings
  add column company_name_bg    text not null default 'НУТРИКАЛ ЕООД',
  add column company_address_bg text not null default 'бул. Княз Борис I 133, 9000 Варна, България',
  add column terms_text_bg      text not null default 'Цените са за готови за продажба продукти. Минималното количество се потвърждава при поръчка.';

-- Only the company's own Bulgarian name and address, for every signed-in account that downloads a document
-- (the customer panel too, which has no rights on calc_settings). Nothing else of the settings.
create or replace function public.company_bg()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('name', company_name_bg, 'address', company_address_bg) from public.calc_settings limit 1
$$;
revoke execute on function public.company_bg() from public, anon;
grant execute on function public.company_bg() to authenticated;
