-- =====================================================================
-- Nutrikal ERP + CRM — product pictures of the catalogue in Storage
-- catalog-images : private bucket, path {product_id}/{uuid}.{ext}.
-- Admin uploads through the app (the catalog_products write rule decides
-- who may change a picture); the open catalogue gets them through
-- /api/catalog-image, so no Storage policy is needed (owner, Nov 2026).
-- (Skipped by the local database: storage needs Supabase itself.)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-images', 'catalog-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
