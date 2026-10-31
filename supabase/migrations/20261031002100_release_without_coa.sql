-- =====================================================================
-- A finished batch can be released without a COA (owner, Oct 2026).
-- The COA stays optional: it can be attached before or after the release.
-- =====================================================================

create or replace function public.set_lot_qc_status(
  p_lot     uuid,
  p_status  public.qc_status,
  p_notes   text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  if p_status <> 'released' and nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'Enter the reason for blocking this lot';
  end if;
  update public.lots
     set qc_status = p_status,
         qc_notes  = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), qc_notes)
   where id = p_lot;
  if not found then
    raise exception 'Lot % not found', p_lot;
  end if;
end
$$;
