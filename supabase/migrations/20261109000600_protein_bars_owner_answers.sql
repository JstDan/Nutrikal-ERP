-- Protein bars and cookies, the owner's answers (Nov 2026):
--   1. GP-101 "Cheesecake" is the Raspberry Cheesecake bar of the catalogue PDF: renamed and filled in like the others;
--   2. GP-102 Strawberry stays as it is;
--   3. GP-109 Double Chocolate cookie leaves the open catalogue (unpublished, kept for earlier enquiries);
--   4. the Cookies & Cream Cheesecake bar is added as GP-112, at the same prices as the other bars (copied from GP-104).
-- The same rules as 20261109000500: no sugar, salt or meal-replacement claims; Vitamin C in mg.

create temporary table _bar_nutrition (j jsonb);
insert into _bar_nutrition values ('[
  {"name":"Energy","amount":"220 kcal / 912 kJ","spec":"363 kcal / 1520 kJ per 100 g","basis":"per 60 g bar"},
  {"name":"Fat","amount":"5.8 g","spec":"9.7 g per 100 g","basis":"per 60 g bar"},
  {"name":"of which saturates","amount":"3.0 g","spec":"5.0 g per 100 g","basis":"per 60 g bar"},
  {"name":"Carbohydrate","amount":"22.4 g","spec":"37.3 g per 100 g","basis":"per 60 g bar"},
  {"name":"of which sugars","amount":"6.0 g","spec":"10 g per 100 g","basis":"per 60 g bar"},
  {"name":"Fibre","amount":"6.0 g","spec":"10 g per 100 g","basis":"per 60 g bar"},
  {"name":"Protein","amount":"18 g","spec":"30 g per 100 g","basis":"per 60 g bar"},
  {"name":"Salt","amount":"0.48 g","spec":"0.8 g per 100 g","basis":"per 60 g bar"},
  {"name":"Vitamin C","amount":"10 mg","spec":"17 mg per 100 g","basis":"per 60 g bar"}
]');

-- 1. Raspberry Cheesecake
update public.catalog_products
   set name = 'Protein Bar Raspberry Cheesecake - 60g',
       description = 'High protein bar with raspberry and cheesecake flavour, 30 % protein, 60 g.'
         || E'\n\nIngredients: protein matrix 30% (whey protein concentrate, milk protein isolate, milk protein casein), cookie ingredients (whole-grain einkorn flour, oat flakes, brown sugar, corn flour, coconut flakes, cocoa nibs, glucose-fructose syrup, sunflower lecithin), coconut oil, chocolate coating (white chocolate 28%), humectant (glycerol), raspberry 5%, coconut sugar, hydrocolloid mix (gums: guar, xanthan), cheesecake flavour, vitamin C.'
         || E'\n\nAllergens: contains milk and cereals containing gluten (einkorn wheat, oats). May contain traces of nuts, soy and eggs.'
         || E'\nStorage: in a dry place, away from direct sunlight. Packed in a protective atmosphere (nitrogen).',
       pack = '60 g bar in a flow-pack with protective atmosphere; display box of 24 bars',
       ingredients = (select j from _bar_nutrition)
 where code = 'GP-101';

-- 3. Double Chocolate cookie: off the open catalogue
-- (held in review too, so Publish all ready does not bring it back; Admin clears it to publish it again)
update public.catalog_products
   set is_published = false, review_status = 'concept_review',
       internal_notes = concat_ws(E'\n', nullif(internal_notes, ''), 'Off the open catalogue by the owner''s decision (Nov 2026): the catalogue PDF has no correct ingredients for Double Chocolate (they repeat the raspberry cookie''s).')
 where code = 'GP-109';

-- 4. Cookies & Cream Cheesecake bar
insert into public.catalog_products (code, category_id, name, description, min_qty, product_format, pack, ingredients, sort_order)
select 'GP-112', b.category_id, 'Protein Bar Cookies & Cream Cheesecake - 60g',
       'High protein bar with cookies & cream pieces and cheesecake flavour, 30 % protein, 60 g.'
         || E'\n\nIngredients: protein matrix 30% (whey protein concentrate, milk protein isolate, milk protein casein), cookie ingredients (whole-grain einkorn flour, oat flakes, brown sugar, corn flour, coconut flakes, cocoa nibs, glucose-fructose syrup, sunflower lecithin), coconut oil, chocolate coating (white chocolate 28%), humectant (glycerol), cookies and cream 5% (wheat flour, vanilla flavoured cream 28% (sugar, vegetable oil (palm), corn starch, skimmed milk powder, emulsifier (soy lecithin), natural-identical vanilla flavouring), glucose and fructose, raising agents (ammonium bicarbonate, sodium bicarbonate, sodium acid pyrophosphate), salt), coconut sugar, hydrocolloid mix (gums: guar, xanthan), cheesecake flavour, vitamin C.'
         || E'\n\nAllergens: contains milk, cereals containing gluten (wheat, einkorn wheat, oats) and soy. May contain traces of nuts and eggs.'
         || E'\nStorage: in a dry place, away from direct sunlight. Packed in a protective atmosphere (nitrogen).',
       b.min_qty, 'bar', '60 g bar in a flow-pack with protective atmosphere; display box of 24 bars',
       (select j from _bar_nutrition), b.sort_order + 5
  from public.catalog_products b
 where b.code = 'GP-104'
   and not exists (select 1 from public.catalog_products where code = 'GP-112');

insert into public.catalog_price_tiers (product_id, min_qty, unit_price)
select n.id, t.min_qty, t.unit_price
  from public.catalog_products n
  join public.catalog_products b on b.code = 'GP-104'
  join public.catalog_price_tiers t on t.product_id = b.id
 where n.code = 'GP-112'
   and not exists (select 1 from public.catalog_price_tiers x where x.product_id = n.id);

-- Published like the other bars once its prices are there
update public.catalog_products n set is_published = true
 where n.code = 'GP-112'
   and (select is_published from public.catalog_products where code = 'GP-104')
   and exists (select 1 from public.catalog_price_tiers t where t.product_id = n.id and t.min_qty = n.min_qty);

drop table _bar_nutrition;
