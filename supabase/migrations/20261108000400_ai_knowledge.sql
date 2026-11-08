-- Nutri AI's memory (owner, Nov 2026: the assistant as the company's brain). Short facts the team wants it to know
-- in every conversation: how a client likes things, house rules, who handles what. Nutri AI can only PROPOSE one
-- (a person asked it to remember something); Admin approves it under Settings > Nutri AI, or writes and changes them
-- there. Only approved notes reach the model. Admin, Sales and the bookkeeper read them (the assistant runs as the
-- person); Production, designers and clients never do.

create table public.ai_knowledge (
  id           uuid primary key default gen_random_uuid(),
  body         text not null check (length(btrim(body)) between 1 and 1000),
  status       text not null default 'approved' check (status in ('proposed', 'approved')),
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  approved_by  uuid references public.profiles (id),
  approved_at  timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.ai_knowledge enable row level security;

-- Read: approved notes for those who use the assistant; proposals for Admin and whoever proposed them
create policy ai_knowledge_read on public.ai_knowledge for select
  using (public.has_role('admin', 'sales') and (status = 'approved' or public.has_role('admin') or created_by = auth.uid()));

-- A proposal by the person asking (through the assistant), never an approved note
create policy ai_knowledge_propose on public.ai_knowledge for insert
  with check (public.has_role('admin', 'sales') and status = 'proposed' and created_by = auth.uid()
              and approved_by is null and approved_at is null);

-- Admin writes, approves, changes and deletes
create policy ai_knowledge_admin on public.ai_knowledge for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- Approving stamps who and when; any change updates the time
create or replace function public.ai_knowledge_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end $$;

create trigger ai_knowledge_stamp before insert or update on public.ai_knowledge
  for each row execute function public.ai_knowledge_stamp();
