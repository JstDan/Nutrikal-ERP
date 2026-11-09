-- The Cookies & Cream Cheesecake bar (GP-112) gets its picture (owner, Nov 2026): a display box of 24 bars in the
-- style of the other bars, without the "No sugar added" badge (not allowed for these bars). A picture Admin or the
-- designer has uploaded meanwhile stays.
update public.catalog_products set image = '/catalog/GP-112.webp' where code = 'GP-112' and image is null;
