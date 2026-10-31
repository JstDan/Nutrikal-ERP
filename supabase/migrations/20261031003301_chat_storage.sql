-- Files of the chat. Private bucket, reached only by the server after the database has checked access.
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', false)
on conflict (id) do nothing;
