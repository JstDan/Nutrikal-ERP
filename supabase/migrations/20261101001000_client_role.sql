-- Clients sign in to the customer panel (owner, Nov 2026). On its own: a new enum value cannot be used in the transaction that adds it.
alter type public.app_role add value if not exists 'client';
