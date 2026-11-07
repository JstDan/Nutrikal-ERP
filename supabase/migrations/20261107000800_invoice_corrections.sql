-- =====================================================================
-- Issued invoices can be corrected by Admin at any time, in full (owner,
-- Nov 2026; replaces "locked after issue"): number, dates, terms, VAT,
-- language, notes, the buyer and every line. A reason is required; the
-- invoice as it was is kept as a version (invoice_versions) with who, when
-- and why, and the document shows that it was corrected. Credit and debit
-- notes stay available. Everyone else still cannot change an issued one.
-- =====================================================================

alter table public.invoices
  add column revision     integer not null default 0,
  add column corrected_at timestamptz,
  add column corrected_by uuid references public.profiles (id);

create table public.invoice_versions (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  revision    integer not null,
  snapshot    jsonb not null,               -- {"invoice": {...}, "lines": [...]} as it was before this correction
  reason      text not null check (btrim(reason) <> ''),
  changed_by  uuid references public.profiles (id) default auth.uid(),
  changed_at  timestamptz not null default now(),
  unique (invoice_id, revision)
);

alter table public.invoice_versions enable row level security;
create policy invoice_versions_select on public.invoice_versions for select to authenticated using (public.has_role('admin', 'sales'));
revoke all on public.invoice_versions from anon, authenticated;
grant select on public.invoice_versions to authenticated;

/**
 * Admin corrects an issued invoice or note.
 * p_head:  {"number", "issue_date", "tax_point_date", "due_date", "payment_method", "vat_pct", "vat_basis", "locale", "notes", "buyer": {...}}
 * p_lines: [{"id" (kept line) or none (new), "description", "quantity", "unit_price"}]; lines not listed are removed.
 */
create or replace function public.correct_invoice(p_invoice uuid, p_head jsonb, p_lines jsonb, p_reason text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  i      public.invoices;
  l      jsonb;
  v_rev  integer;
  v_sub  numeric;
  v_n    integer := 0;
begin
  perform public.require_role('admin');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Enter the reason for the correction';
  end if;
  select * into i from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if i.status <> 'issued' then
    raise exception 'A draft is changed as usual; only an issued invoice is corrected';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice keeps at least one line';
  end if;
  if coalesce(p_head ->> 'number', i.number) !~ '^[0-9]{10}$' then
    raise exception 'The number has 10 digits';
  end if;
  if exists (select 1 from public.invoices where number = p_head ->> 'number' and id <> p_invoice) then
    raise exception 'Number % is already used', p_head ->> 'number';
  end if;

  v_rev := i.revision + 1;
  insert into public.invoice_versions (invoice_id, revision, snapshot, reason)
  values (p_invoice, v_rev, jsonb_build_object('invoice', to_jsonb(i),
            'lines', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order) from public.invoice_lines x where x.invoice_id = p_invoice), '[]')),
          btrim(p_reason));

  -- The locks of an issued invoice are opened for this change only
  alter table public.invoices disable trigger invoices_guard;
  alter table public.invoice_lines disable trigger invoice_lines_guard;

  delete from public.invoice_lines
   where invoice_id = p_invoice
     and id::text not in (select l2 ->> 'id' from jsonb_array_elements(p_lines) l2 where l2 ->> 'id' is not null);
  for l in select value from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    if nullif(btrim(coalesce(l ->> 'description', '')), '') is null or (l ->> 'quantity')::numeric <= 0 or l ->> 'unit_price' is null then
      raise exception 'Every line needs a description, a quantity and a price';
    end if;
    if l ->> 'id' is not null and exists (select 1 from public.invoice_lines where id = (l ->> 'id')::uuid and invoice_id = p_invoice) then
      update public.invoice_lines
         set description = btrim(l ->> 'description'), quantity = (l ->> 'quantity')::numeric, unit_price = (l ->> 'unit_price')::numeric,
             amount = round((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric, 2), sort_order = v_n
       where id = (l ->> 'id')::uuid;
    else
      insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
      values (p_invoice, v_n, case when (l ->> 'unit_price')::numeric < 0 then 'advance' else 'service' end, btrim(l ->> 'description'),
              (l ->> 'quantity')::numeric, (l ->> 'unit_price')::numeric, round((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric, 2));
    end if;
  end loop;

  select coalesce(sum(amount), 0) into v_sub from public.invoice_lines where invoice_id = p_invoice;
  update public.invoices set
    number         = coalesce(p_head ->> 'number', number),
    issue_date     = coalesce((p_head ->> 'issue_date')::date, issue_date),
    tax_point_date = case when p_head ? 'tax_point_date' then (nullif(p_head ->> 'tax_point_date', ''))::date else tax_point_date end,
    due_date       = case when p_head ? 'due_date' then (nullif(p_head ->> 'due_date', ''))::date else due_date end,
    payment_method = coalesce(nullif(p_head ->> 'payment_method', ''), payment_method),
    vat_pct        = coalesce((p_head ->> 'vat_pct')::numeric, vat_pct),
    vat_basis      = case when p_head ? 'vat_basis' then nullif(btrim(p_head ->> 'vat_basis'), '') else vat_basis end,
    locale         = coalesce(nullif(p_head ->> 'locale', ''), locale),
    notes          = case when p_head ? 'notes' then nullif(p_head ->> 'notes', '') else notes end,
    buyer          = case when jsonb_typeof(p_head -> 'buyer') = 'object' then buyer || (p_head -> 'buyer') else buyer end,
    subtotal       = v_sub,
    vat_amount     = round(v_sub * coalesce((p_head ->> 'vat_pct')::numeric, vat_pct) / 100, 2),
    total          = v_sub + round(v_sub * coalesce((p_head ->> 'vat_pct')::numeric, vat_pct) / 100, 2),
    revision       = v_rev,
    corrected_at   = now(),
    corrected_by   = auth.uid()
   where id = p_invoice;

  alter table public.invoices enable trigger invoices_guard;
  alter table public.invoice_lines enable trigger invoice_lines_guard;
  return v_rev;
end
$$;
revoke execute on function public.correct_invoice(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.correct_invoice(uuid, jsonb, jsonb, text) to authenticated;
