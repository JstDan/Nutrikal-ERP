-- Protein bars, brownies and cookies from the owner's "Private Label Catalog - Protein bars, Brownies & Cookies"
-- (Nov 2026): ingredients, pack and, for the bars, the nutrition per bar. Only the products that match the PDF
-- clearly are filled in. Left out on purpose, as they would be wrong or not allowed on a label or website:
--   - "No sugar added" and "No added salt" (Reg. 1924/2006, Annex: sugars and salt are present; 0.8 g salt/100 g);
--   - "as a meal replacement" (a regulated statement);
--   - the cookies' nutrition table (in the PDF it is the bars' table: 30 g protein/100 g, 60 g, against 25 %);
--   - Vitamin C is 17 mg per 100 g (the PDF says 17 g).
-- Allergens follow the ingredients: cereals with gluten and milk in the bars; milk, egg, hazelnut and soy in the
-- cookies (the PDF lists those three only as possible traces).
-- GP-101 (Cheesecake), GP-102 (Strawberry) and GP-109 (Double Chocolate cookie) wait for the owner: the PDF has a
-- Raspberry Cheesecake and a Cookies & Cream bar, no Strawberry bar, and the Double Chocolate page repeats the
-- raspberry cookie's ingredients.

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

create temporary table _bars (code text, kind text, line text, extra text);
insert into _bars values
  ('GP-103', 'bar', 'High protein bar with stracciatella and cheesecake flavour, 30 % protein, 60 g.',
   'protein matrix 30% (whey protein concentrate, milk protein isolate, milk protein casein), cookie ingredients (whole-grain einkorn flour, oat flakes, brown sugar, corn flour, coconut flakes, cocoa nibs, glucose-fructose syrup, sunflower lecithin), coconut oil, chocolate coating (white chocolate 28%), cocoa 22%, humectant (glycerol), cocoa drops 5% (sugar, refined and hydrogenated palm fats, cocoa 12%, flavouring), coconut sugar, hydrocolloid mix (gums: guar, xanthan), cheesecake flavour, rum flavour, vitamin C.'),
  ('GP-104', 'bar', 'High protein bar with blueberry and cheesecake flavour, 30 % protein, 60 g.',
   'protein matrix 30% (whey protein concentrate, milk protein isolate, milk protein casein), cookie ingredients (whole-grain einkorn flour, oat flakes, brown sugar, corn flour, coconut flakes, cocoa nibs, glucose-fructose syrup, sunflower lecithin), coconut oil, chocolate coating (white chocolate 28%), humectant (glycerol), dried blueberry 5%, coconut sugar, hydrocolloid mix (gums: guar, xanthan), cheesecake flavour, vitamin C.'),
  ('GP-105', 'bar', 'High protein brownie with orange and dark chocolate coating, 30 % protein, 60 g.',
   'protein matrix 30% (whey protein concentrate, milk protein isolate, milk protein casein), cookie ingredients (whole-grain einkorn flour, oat flakes, brown sugar, corn flour, coconut flakes, cocoa nibs, glucose-fructose syrup, sunflower lecithin), coconut oil, cocoa, chocolate coating (dark chocolate 55%), humectant (glycerol), orange 5%, coconut sugar, hydrocolloid mix (gums: guar, xanthan), vitamin C.'),
  ('GP-106', 'bar', 'High protein brownie with banana flavour and white chocolate coating, 30 % protein, 60 g.',
   'protein matrix 30% (whey protein concentrate, milk protein isolate, milk protein casein), cookie ingredients (whole-grain einkorn flour, oat flakes, brown sugar, corn flour, coconut flakes, cocoa nibs, glucose-fructose syrup, sunflower lecithin), coconut oil, cocoa, chocolate coating (white chocolate 28%), humectant (glycerol), coconut sugar, hydrocolloid mix (gums: guar, xanthan), colour (turmeric), banana flavour, vitamin C.'),
  ('GP-107', 'bar', 'High protein brownie with peanut butter flavour and dark chocolate coating, 30 % protein, 60 g.',
   'protein matrix 30% (whey protein concentrate, milk protein isolate, milk protein casein), cookie ingredients (whole-grain einkorn flour, oat flakes, brown sugar, corn flour, coconut flakes, cocoa nibs, glucose-fructose syrup, sunflower lecithin), coconut oil, cocoa, chocolate coating (dark chocolate 55%), humectant (glycerol), coconut sugar, hydrocolloid mix (gums: guar, xanthan), peanut butter flavour, vitamin C.'),
  ('GP-108', 'bar', 'High protein brownie with coffee and hulled hemp seed, dark chocolate coating, 30 % protein, 60 g.',
   'protein matrix 30% (whey protein concentrate, milk protein isolate, milk protein casein), cookie ingredients (whole-grain einkorn flour, oat flakes, brown sugar, corn flour, coconut flakes, cocoa nibs, glucose-fructose syrup, sunflower lecithin), coconut oil, cocoa, chocolate coating (dark chocolate 55%), humectant (glycerol), hulled hemp seed 5%, coffee <2%, coconut sugar, hydrocolloid mix (gums: guar, xanthan), vitamin C. Made with natural hemp seeds, without psychotropic substances. Not recommended for children or for pregnant or breastfeeding women.'),
  ('GP-110', 'cookie', 'Soft and chewy high protein cookie with dried raspberries and white drops, 25 % protein.',
   'protein matrix (milk protein isolate, whey protein concentrate), egg melange, brown rice syrup, humectant (glycerol), maltitol syrup, sorbitol syrup, erythritol, hazelnut tahini, coconut milk powder, dried raspberries 5%, white drops 5% (sugar, vegetable fats, whey powder, whole milk powder, emulsifier: soy lecithin, salt, vanillin), sunflower lecithin, raising agents (sodium bicarbonate, ammonium bicarbonate), vanilla and raspberry flavour, enzymes, stevia, salt, thickener (xanthan gum).'),
  ('GP-111', 'cookie', 'Soft and chewy high protein cookie with dried strawberry pieces and white drops, 25 % protein.',
   'protein matrix (milk protein isolate, whey protein concentrate), egg melange, brown rice syrup, humectant (glycerol), maltitol syrup, sorbitol syrup, erythritol, hazelnut tahini, coconut milk powder, dried strawberry pieces 5%, white drops 5% (sugar, vegetable fats, whey powder, whole milk powder, emulsifier: soy lecithin, salt, vanillin), sunflower lecithin, raising agents (sodium bicarbonate, ammonium bicarbonate), vanilla and strawberry flavour, enzymes, stevia, salt, thickener (xanthan gum).');

update public.catalog_products p
   set description = b.line || E'\n\nIngredients: ' || b.extra || E'\n\n'
         || case b.kind
              when 'bar' then 'Allergens: contains milk and cereals containing gluten (einkorn wheat, oats). May contain traces of nuts, soy and eggs.'
              else 'Allergens: contains milk, egg, hazelnut and soy. Excessive consumption may produce laxative effects (polyols).'
            end
         || E'\nStorage: in a dry place, away from direct sunlight. Packed in a protective atmosphere (nitrogen).',
       pack = case b.kind
                when 'bar' then '60 g bar in a flow-pack with protective atmosphere; display box of 24 bars'
                else 'Single cookie in a flow-pack with protective atmosphere; display box'
              end,
       ingredients = case b.kind when 'bar' then (select j from _bar_nutrition) else p.ingredients end
  from _bars b
 where p.code = b.code;

drop table _bars;
drop table _bar_nutrition;
