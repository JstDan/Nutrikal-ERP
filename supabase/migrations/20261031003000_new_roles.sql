-- New roles (owner, Oct 2026). On their own: a new enum value cannot be used in the transaction that adds it.
alter type public.app_role add value if not exists 'bookkeeper';
alter type public.app_role add value if not exists 'accountant';
alter type public.app_role add value if not exists 'designer';
