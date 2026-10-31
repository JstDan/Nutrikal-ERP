-- =====================================================================
-- AI assistant (owner, Oct 2026): conversations of Admin and Sales.
-- Each person sees only their own. Production has no access.
-- =====================================================================

create table public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title       text not null check (btrim(title) <> ''),
  created_at  timestamptz not null default now()
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, created_at desc);

create table public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  model            text,
  tokens_in        integer,
  tokens_out       integer,
  created_at       timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy ai_conversations_own on public.ai_conversations for all to authenticated
  using (user_id = auth.uid() and public.has_role('admin', 'sales'))
  with check (user_id = auth.uid() and public.has_role('admin', 'sales'));

create policy ai_messages_select on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
         and public.has_role('admin', 'sales'));
create policy ai_messages_insert on public.ai_messages for insert to authenticated
  with check (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
              and public.has_role('admin', 'sales'));
