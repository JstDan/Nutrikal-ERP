-- =====================================================================
-- Nutrikal ERP + CRM — approve a recipe with a not authorised Novel Food
-- ingredient, at Admin's own risk (owner, Nov 2026)
--
-- Until now a recipe with an ingredient whose Novel Food status is
-- "not authorised" could not be approved at all. Catalogue recipes run into
-- this often, so Admin may now approve such a recipe when a reason is given.
-- The reason, who accepted the risk and when are kept on the version and
-- shown on it. Without a reason the approval is still refused.
--
-- Production: formula_versions stays staff only (admin, sales); no change.
-- =====================================================================

alter table public.formula_versions
  add column novel_risk_note text,
  add column novel_risk_by   uuid references public.profiles(id),
  add column novel_risk_at   timestamptz;

comment on column public.formula_versions.novel_risk_note is
  'Approved although an ingredient is a not authorised Novel Food: the reason Admin gave';

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
       and new.change_note is not distinct from old.change_note
       and new.novel_risk_note is not distinct from old.novel_risk_note
       and new.novel_risk_by is not distinct from old.novel_risk_by
       and new.novel_risk_at is not distinct from old.novel_risk_at then
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
      if coalesce(btrim(new.novel_risk_note), '') = '' then
        raise exception 'Not authorised Novel Food ingredients: %. Approve with risk and give a reason.', v_blocked;
      end if;
      new.novel_risk_note := btrim(new.novel_risk_note);
      new.novel_risk_by := auth.uid();
      new.novel_risk_at := now();
    else
      new.novel_risk_note := null;
      new.novel_risk_by := null;
      new.novel_risk_at := null;
    end if;

    update public.formula_versions set status = 'archived'
     where formula_id = new.formula_id and status = 'approved' and id <> new.id;
    new.approved_by := auth.uid();
    new.approved_at := now();
  else
    -- a draft carries no accepted risk: that is set only when Admin approves
    new.novel_risk_note := null;
    new.novel_risk_by := null;
    new.novel_risk_at := null;
    if new.status = 'archived' and not public.has_role('admin', 'sales') then
      raise exception 'Not allowed to discard a draft' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

-- approve_formula_version gets an optional reason for the accepted risk
drop function public.approve_formula_version(uuid);

create function public.approve_formula_version(p_version uuid, p_risk_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  update public.formula_versions
     set status = 'approved', novel_risk_note = nullif(btrim(p_risk_note), '')
   where id = p_version and status = 'draft';
  if not found then
    raise exception 'Only a draft version can be approved';
  end if;
end
$$;

revoke execute on function public.approve_formula_version(uuid, text) from public, anon;
grant execute on function public.approve_formula_version(uuid, text) to authenticated;
