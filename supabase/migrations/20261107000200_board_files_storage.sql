-- =====================================================================
-- Boards: files of cards in Supabase Storage.
-- board-files : private bucket, max 25 MB a file, path
--               {board_id}/{card_id}/{uuid}-{name}, served by signed URL.
--               Members of the board (and Admin) read and add; deleting
--               goes through the app after the row is deleted (own files;
--               Admin any). Production and clients: no access.
-- (Skipped by the local database: storage needs Supabase.)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-files', 'board-files', false, 26214400, null)
on conflict (id) do nothing;

create policy board_files_read on storage.objects for select to authenticated
  using (bucket_id = 'board-files'
         and public.can_see_board(public.board_of_card(nullif(split_part(name, '/', 2), '')::uuid)));

create policy board_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'board-files'
              and public.can_edit_board(public.board_of_card(nullif(split_part(name, '/', 2), '')::uuid)));
