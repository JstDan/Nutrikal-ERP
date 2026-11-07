-- Contracts signed with Google Workspace eSignature (owner, Nov 2026). Google has no way for another system to
-- ask for or follow those signatures, so: the app puts the contract's PDF into the Drive folder "Nutrikal –
-- Contracts" (the shared Google connection), the request for signatures is made in Drive by hand, and Admin then
-- marks the contract signed with the link to the signed file.

alter table public.order_contracts
  add column drive_file_id  text,
  add column drive_url      text check (drive_url is null or drive_url ~ '^https://'),
  add column drive_version  integer,                       -- the version that went to Drive
  add column signed_url     text check (signed_url is null or signed_url ~ '^https://');

/** The PDF of the current version is in Drive (Admin and Sales). */
create or replace function public.contract_drive_saved(p_id uuid, p_file text, p_url text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.order_contracts
     set drive_file_id = p_file, drive_url = p_url, drive_version = version,
         status = case when status = 'draft' then 'sent' else status end, sent_at = coalesce(sent_at, now())
   where id = p_id and status not in ('cancelled', 'signed');
  if not found then
    raise exception 'Contract not found';
  end if;
end
$$;

drop function public.mark_order_contract_signed(uuid);
/** Admin: signed (in Google eSignature, on paper or otherwise); the link to the signed file is kept when given. */
create or replace function public.mark_order_contract_signed(p_id uuid, p_url text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  if nullif(btrim(coalesce(p_url, '')), '') is not null and btrim(p_url) !~ '^https://' then
    raise exception 'The link to the signed file starts with https://';
  end if;
  update public.order_contracts set status = 'signed', signed_at = now(), signed_by = auth.uid(), sent_at = coalesce(sent_at, now()),
         signed_url = nullif(btrim(coalesce(p_url, '')), '')
   where id = p_id and status in ('draft', 'sent', 'accepted');
  if not found then
    raise exception 'Only an open contract is marked as signed';
  end if;
end
$$;

revoke execute on function public.contract_drive_saved(uuid, text, text), public.mark_order_contract_signed(uuid, text) from public, anon;
grant execute on function public.contract_drive_saved(uuid, text, text), public.mark_order_contract_signed(uuid, text) to authenticated;
