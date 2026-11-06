-- Profile photos in Supabase Storage: private bucket "avatars", 2 MB a file.
-- The app reads and writes them after avatar_of / set_avatar have decided.
-- (Skipped by the local database: storage needs Supabase.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
