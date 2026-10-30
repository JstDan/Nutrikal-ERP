-- =====================================================================
-- Nutrikal ERP + CRM — recipes from offers start at 5 % overage again
-- Owner, 30 Oct 2026: the offer price has no waste (20261031001300), but
-- production still needs 5 % more raw material (it is filled into extra
-- units, paid on the final proforma). So a recipe made from an offer
-- always starts with recipe_default_overage() (5 %) on every ingredient,
-- whatever the offer's hidden waste field; it can be changed per line.
-- calc_offer_waste is used only by calc_offer_recipe_sync and
-- link_recipe_pending_line, so both follow.
-- =====================================================================

/** The overage of the recipe made from an offer, %: always the default (5 %). The offer's data is not used. */
create or replace function public.calc_offer_waste(p_data jsonb)
returns numeric
language sql immutable
as $$ select public.recipe_default_overage() $$;

-- Recipes from offers made since 29 Oct with 0 %: drafts not edited by hand (not counted as a hand edit)
select set_config('nk.recipe_sync', 'on', true);
update public.formula_lines l set overage_pct = public.recipe_default_overage()
  from public.formula_versions v join public.formulas f on f.id = v.formula_id
 where v.id = l.version_id and v.status = 'draft' and f.calc_offer_id is not null and not f.offer_edited and l.overage_pct = 0;
select set_config('nk.recipe_sync', '', true);
