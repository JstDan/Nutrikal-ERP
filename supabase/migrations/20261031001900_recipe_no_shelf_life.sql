-- =====================================================================
-- Nutrikal ERP + CRM — no shelf life on recipes
-- Owner, 30 Oct 2026: the shelf life is not entered on a recipe version
-- any more, so it is no longer needed to approve one. The column stays
-- (old versions keep their value; a new version still copies it). The
-- shelf life of items and the expiry date of lots are unchanged.
--
-- Production: no access to recipes (unchanged).
-- =====================================================================

create or replace function public.formula_versions_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_lines   integer;
  v_blocked text;
begin
  if new.formula_id <> old.formula_id or new.version <> old.version then
    raise exception 'Formula and version number cannot be changed';
  end if;

  if old.status = 'archived' then
    raise exception 'Archived formula versions cannot be changed';
  end if;

  if old.status = 'approved' then
    if new.status = 'archived'
       and public.has_role('admin')
       and new.shelf_life_months is not distinct from old.shelf_life_months
       and new.notes is not distinct from old.notes
       and new.change_note is not distinct from old.change_note then
      return new;
    end if;
    raise exception 'Approved formula versions are locked. Create a new version instead.';
  end if;

  -- old.status = 'draft'
  if new.status = 'approved' then
    if not public.has_role('admin') then
      raise exception 'Only Admin can approve a formula version' using errcode = '42501';
    end if;
    select count(*) into v_lines from public.formula_lines where version_id = new.id;
    if v_lines = 0 then
      raise exception 'A formula version without ingredients cannot be approved';
    end if;
    select string_agg(i.name, ', ' order by i.name) into v_blocked
      from public.formula_lines l join public.items i on i.id = l.item_id
     where l.version_id = new.id and i.novel_food_status = 'not_authorised';
    if v_blocked is not null then
      raise exception 'Not authorised Novel Food ingredients: %', v_blocked;
    end if;

    update public.formula_versions set status = 'archived'
     where formula_id = new.formula_id and status = 'approved' and id <> new.id;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status = 'archived' then
    if not public.has_role('admin', 'sales') then
      raise exception 'Not allowed to discard a draft' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
