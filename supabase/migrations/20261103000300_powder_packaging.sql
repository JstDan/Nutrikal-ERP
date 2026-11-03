-- =====================================================================
-- Nutrikal ERP + CRM — packaging that fits a product format
-- Owner, 3 Nov 2026: for a powder, "Packaging per pack" offers only
-- scoops and desiccants, not the packaging of capsules.
-- Items have no packaging kind, so the rule goes by the name (English,
-- Bulgarian or SKU). One rule, used by the recipe, offer and
-- manufacturing order pages.
-- =====================================================================

create or replace function public.packaging_fits_format(p_name text, p_name_bg text, p_sku text, p_format text)
returns boolean
language sql immutable
as $$
  select case
    when p_format = 'powder' then
      concat_ws(' ', p_name, p_name_bg, p_sku)
        ~* '(scoop|spoon|desiccant|silica|лъжич|мерител|дисикант|десикант|сушител|силикагел)'
    else true
  end
$$;
comment on function public.packaging_fits_format(text, text, text, text) is
  'Whether a packaging item is offered for a product format: a powder gets only scoops and desiccants (by name)';
grant execute on function public.packaging_fits_format(text, text, text, text) to authenticated;
