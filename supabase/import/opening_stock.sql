-- =====================================================================
-- One-off import: opening stock from the Google Sheet "Supplements Inventory"
-- (sheet FoodSupplements, 163 ingredients, 144 with stock, read on 27 Oct 2026;
-- the earlier export of the Nutrikal Inventory app is replaced).
-- Cleaned while generating: negative quantity -> no opening stock;
-- "#N/A", "#NAME?" or a price in the supplier column -> no supplier;
-- an average price under 1 EUR/kg next to a real best price -> the best price.
--
-- NOT a migration. Run it once, after the migrations, in the Supabase
-- SQL editor (as the database owner). Running it again adds nothing.
-- Read supabase/import/REVIEW.md first: some source rows look wrong
-- (copied quantities, a price in the quantity column, two ingredients in
-- one row). Correct them here or in the app afterwards.
--
-- What it creates
-- * Suppliers (spelling variants merged, as in the old app).
-- * Items: raw materials (RM-1001 …) and three excipients (EX-…), unit kg,
--   Novel Food status "unknown" (to be checked before the item is used
--   in an approved formula), reorder level = old minimum stock.
-- * Supplier item + current purchase price = the old "best price"
--   (or the average price when there is no best price).
-- * For every ingredient with stock: one lot OB-1xxx, released, with an
--   opening_balance movement at the location below and the old average
--   purchase price as the lot cost.
--
-- Where the stock is: change 'NK-WH' below to 'PF-RM' if the stock is at
-- the partner facility.
-- =====================================================================

create temp table nk_import_settings as select 'NK-WH'::text as location_code;

create temp table nk_import_raw (
  name text,
  current_qty numeric,
  min_stock numeric,
  avg_buy_price numeric,
  total_price numeric,
  best_price numeric,
  supplier text
);

insert into nk_import_raw (name, current_qty, min_stock, avg_buy_price, total_price, best_price, supplier) values
  ('Acacia Fiber/Gum Arabica', 31.85, NULL, 13.7, NULL, 13.7, 'Тримарт Индъстрис ООД'),
  ('Acai Berry Extract', 12.16, NULL, 16, NULL, 16, 'Summit'),
  ('Acerola Cherry Extract', 14.88, NULL, 6, NULL, 30, 'Forward Farma BV'),
  ('Agave / Inolin', 45, NULL, 4.36, NULL, 4.36, 'Astron chemical'),
  ('Apigenin', 12.5, NULL, 23.5, NULL, 23.5, 'SRS Nutrition Express'),
  ('Apple Cider Vinegar powder', 2.917, NULL, 17.79, NULL, 9.52, 'Grherb Biotech Co Ltd'),
  ('Artichoke Extract', 30.53, NULL, 112.68, NULL, 112.68, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Ashwagandha Extract 5%', 8.185, NULL, 34.45, NULL, 30, 'VIGO NUTRITION'),
  ('Astaxanthin Powder 10% / Haematococcus pluvialis EX', 3, NULL, 189, NULL, 189, NULL),
  ('ATR - Adenosine Triphosphate', 0, NULL, 103.25, NULL, 103.25, 'Grherb Biotech'),
  ('Bacopa Extract 20%', 3.8305, NULL, 36.36, NULL, 9.53, 'Grherb Biotech Co Ltd'),
  ('Bamboo Brown Extract', 12.5, NULL, 23.5, NULL, 23.5, 'SRS Nutrition Express'),
  ('Bamboo Extract White', 10.61, NULL, 23.5, NULL, 23.5, 'SRS Nutrition Express'),
  ('BCAA - instant - Leucine:isoleucine:Valine 2:1:1', 0, NULL, NULL, NULL, NULL, NULL),
  ('Beetroot Extract', 4.5, NULL, 7.79, NULL, 7.79, 'Grherb Biotech Co Ltd'),
  ('Berberine HCI / Three Needle Ex', 30.53, NULL, 112.68, NULL, 112.68, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Beta - Alanine', 1.535, NULL, 4.6, NULL, 4.6, 'Sanmart'),
  ('Betaine Anhydrous', 25, NULL, 19.09, NULL, 19.09, 'Grherb Biotech'),
  ('Biotin', 0.378, NULL, 18.66, NULL, 17.31, 'Grherb Biotech Co Ltd'),
  ('Birch Leaf Extract', 9.713, NULL, 14.74, NULL, 9.52, 'Grherb Biotech Co Ltd'),
  ('Black Maca Extract', 9.9, NULL, 10.4, NULL, 10.4, 'Shenzhen zhilicheng'),
  ('Black Pepper Extract', 4.82845, NULL, 243, NULL, 243, 'Summit ingredients B.V.'),
  ('Blackcurrant Flavour', 5.417, NULL, 39, NULL, 39, 'Flavours Factory'),
  ('Blessed tistle extract powder', 0, NULL, 9.52, NULL, 9.52, 'Grherb Biotech Co Ltd'),
  ('Boron Glycinate', 3.617, NULL, 30.35, NULL, 30.35, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Boswellia 65%', 15.692, NULL, 22.25, NULL, 18.5, 'Forward Farma BV'),
  ('Caffeine Anhydrous', 13.237, NULL, 20, NULL, 20, 'Forwardfarma'),
  ('Caramel Salty Flavour', 5.345, NULL, 35, NULL, 35, 'Flavours Factory'),
  ('CeylonCinnamon', 2.38, NULL, 16.91, NULL, 13.85, 'Grherb Biotech Co Ltd'),
  ('Chaga Mushroom Extract 10:1', 8.08, NULL, 22, NULL, 22, 'Summit ingredients B.V.'),
  ('Chamomile Extract', 40.35, NULL, 18.75, NULL, 15.8, 'Hunan New Mstar'),
  ('Chondroitin Sulfate', 25, NULL, 36.5, NULL, 36.5, 'PHARMANZEN B.V.'),
  ('Chromium Picolinate', 0.910178, NULL, 27.7, NULL, 27.7, 'Grherb Biotech Co Ltd'),
  ('Citicoline', 18.415, NULL, 122, NULL, 122, 'Summit ingredients B.V.'),
  ('Citrus Bergamot Extract', 20.225, NULL, 22, NULL, 22, 'Summit ingredients B.V.'),
  ('Citrus Flavonoids 50%', 4.74, NULL, 19.96, NULL, 19.96, 'Grherb Biotech'),
  ('Coconut Type Nat Flavouring', 8.8, NULL, NULL, NULL, NULL, NULL),
  ('Coconut Water powder', 4.49, NULL, 8.66, NULL, 8.66, 'Grherb Biotech Co Ltd'),
  ('Coenzyme Q 10 / sample', 4, NULL, 201, NULL, 201, 'Hunan New Mstar Biotechnology'),
  ('Colagen', 3.03, NULL, 12.02, NULL, 12.02, 'Astron chemicals'),
  ('Collagen Хидролизиран', 428.02, 25, 9.8, NULL, 9.5, 'Пик - Ко АД'),
  ('Collinstant Active Powder Bag', 550.18, NULL, 10, NULL, 10, 'Viscofan'),
  ('Cordyceps Extract 30%', 7.6, NULL, 19.96, NULL, 19.96, 'Grherb Biotech'),
  ('Corn Silk Extract', 8.41, NULL, 19.96, NULL, 19.96, 'Grherb Biotech'),
  ('Creatine HCL', 23.9, NULL, 11.25, NULL, 11.25, 'Vitajoy'),
  ('Creatine Monohydrate', 505.7, NULL, 4.35, NULL, 4.3, 'SRS Nutrition Express'),
  ('D-Biotin 2%', 23.425, NULL, 17, NULL, 17, 'Summit'),
  ('D-Chiro-Inositol', 3.5235, NULL, 189.86, NULL, 160, 'Forwardfarma'),
  ('D-Ribose', 0, NULL, 19.09, NULL, 19.09, 'Grherb Biotech'),
  ('Dandelion Extract', 25, NULL, NULL, NULL, NULL, NULL),
  ('Dandelion Root Extract', 0.91, NULL, 8.66, NULL, 8.66, 'Grherb Biotech Co Ltd'),
  ('DigeZyme', 0.275, NULL, NULL, NULL, NULL, NULL),
  ('DL-Malic-Acid', 23, NULL, 2.38, NULL, 2.38, 'Astron chemicals'),
  ('DNF-10', 16.28, NULL, NULL, NULL, NULL, NULL),
  ('Enzyme Blend', 20, NULL, 45.98, NULL, 45.98, 'Grherd Biotech'),
  ('Fennel seed exract powder', 1.275, NULL, 8.58, NULL, 8.5, 'Grherb Biotech Co Ltd'),
  ('Fenugreek Extract 50%', 9.25, NULL, 20.48, NULL, 17.35, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Fisetin 98%', 0.425, NULL, 303.67, NULL, 303.67, 'Grherb Biotech'),
  ('Fish Oill Softgel', 0, NULL, NULL, NULL, NULL, NULL),
  ('Folic Acid', 1, NULL, 82.39, NULL, 82.39, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Forest Fruit Flavour', 5.593, NULL, 59, NULL, 59, 'Flavours Factory'),
  ('Fumed Silica', 5.9645, NULL, NULL, NULL, NULL, NULL),
  ('GABA', 0, NULL, 19.09, NULL, 19.09, 'Grherb Biotech'),
  ('Garlic Extract', 6.85, NULL, 33, NULL, 33, 'Summit ingredients B.V.'),
  ('Ginger', 12.365, NULL, 33, NULL, 33, 'VIGO NUTRITION'),
  ('Ginseng Root Extract', 0, NULL, 43.38, NULL, 43.38, 'Hunan New Mstar'),
  ('Glucomannan', 16.06, NULL, 17.77, NULL, 16.45, 'Grherb Biotech Co Ltd'),
  ('Glucosamine Sulfate 2KCI', 9.45, NULL, 8.7, NULL, 8.7, 'PHARMANZEN B.V.'),
  ('Glucosyl Steviol E5', 9.331, NULL, NULL, NULL, NULL, NULL),
  ('Glycine / Glicyna H', 33.65, NULL, 5.6, NULL, 5.6, NULL),
  ('Grape Flavour', 5.367, NULL, 53, NULL, 53, 'Flavours Factory'),
  ('Green Tea Extract (50% EGCG)', 58.052, NULL, 24.45, NULL, 16, 'PHARMANZEN B.V.'),
  ('Guarana Extract', 14.5875, NULL, 27, NULL, 27, 'VIGO NUTRITION'),
  ('Harpagophytum Extract (Devil''s claw)', NULL, NULL, 9.52, NULL, 9.52, 'Grherb Biotech Co Ltd'),
  ('Horsetail Extract', 0.274, NULL, 11.25, NULL, 11.25, 'Grherb Biotech Co Ltd'),
  ('Hyaluronate Sodium', 1.39, NULL, 169.06, NULL, 84.5, 'SRS Nutrition Express'),
  ('Inositol', 18.5, NULL, 10.4, NULL, 10.4, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Juniper Berry Extract', 8.41, NULL, 19.96, NULL, 19.96, 'Grherb Biotech'),
  ('Какао Алкализирано', 50, NULL, NULL, NULL, NULL, NULL),
  ('Lacto Spore 100 Billion Units/Gm', 1, NULL, NULL, NULL, NULL, NULL),
  ('L-Carnitine Tartrate', 21.062, NULL, 23, NULL, 23, 'Majorchem'),
  ('L-Choline Bitartrate', 18.7, NULL, NULL, NULL, NULL, NULL),
  ('L-Citrulline DL-Malate bag', 72.835, NULL, 6.4, NULL, 5.17, 'Shuguang'),
  ('L-Selenomethionine / Boswellia Serrata Ex', 1.425, NULL, 0.43, NULL, 0.43, 'Grherd Biotech'),
  ('L-Theanine', 5.832, NULL, 20.63, NULL, 18.9, 'Hunan New Mstar Biotechnology'),
  ('L-Tyrosine', 20.6785, NULL, 10.09, NULL, 8.68, 'Vitajoy'),
  ('Lactase 100000 ALU/gm', 0.7, NULL, 82.43, NULL, 82.43, 'Grherd Biotech'),
  ('Lemon Balm Extract', 8.3, NULL, 13.01, NULL, 9.52, 'Grherb Biotech Co Ltd'),
  ('Lions Mane Extract 10:1', 11.783, NULL, 17, NULL, 17, 'Summit ingredients B.V.'),
  ('Lutein', 0.35, NULL, 12.98, NULL, 12.98, 'Grherb Biotech Co Ltd'),
  ('Magnesium Bisglycinate', 179.8655, NULL, 9.79, NULL, 8.33, 'Vitajoy'),
  ('Magnesium Bisglycinate 12%', 0, NULL, NULL, NULL, NULL, NULL),
  ('Magnesium Citrate / bezwodny', 22.88, NULL, NULL, NULL, NULL, NULL),
  ('Magnesium malate - 14 17,5% Mg', 0, NULL, NULL, NULL, NULL, NULL),
  ('Magnesium Stearate', 25.473739, NULL, 5.22, NULL, 5.22, 'Astron chemicals'),
  ('Marigold that contains both 20% Lutein and 4% Zeaxanthin', 0.7125, NULL, 62.47, NULL, 62.47, 'Grherb Biotech'),
  ('Melatonin', 2, NULL, 91.87, NULL, 86.73, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Methylfolate L-5-MTHF', 0.079, NULL, 2100, NULL, 2100, 'Summit ingredients B.V.'),
  ('Microstaline Cellulose', 386.002068, NULL, 3.91, NULL, 3.91, 'Astron chemicals'),
  ('Milk thistie Extract', NULL, NULL, 26.25, NULL, 23.5, 'Hunan New Mstar Biotechnology Co'),
  ('Milk Chocolate Flavour', 9.95, NULL, 29, NULL, 29, 'Flavours Factory'),
  ('Monk Fruit', 5, NULL, NULL, NULL, NULL, NULL),
  ('Moringa leaf Extract Powder', 0, NULL, 8.66, NULL, 8.66, 'Grherb Biotech Co Ltd'),
  ('MSM Methylsulfonylmethane', 6.55, NULL, 9.5, NULL, 9.5, 'PHARMANZEN B.V.'),
  ('Mushroom MIX (Chaga,Reishi,Shiitake,Lions Mane, Cordyceps, Turkey Tail', 1.55, NULL, 7.8, NULL, 6.92, 'Shenzhen zhilicheng'),
  ('Nettle Root Extract', 13.7, NULL, 7.81, NULL, 7.81, 'Grherb Biotech'),
  ('Niacinamide', 0, NULL, 19.09, NULL, 19.09, 'Grherb Biotech'),
  ('B-NicotinamideMonNMN', 0, NULL, 63.94, NULL, 63.94, 'Natural / От офиса на Калоян'),
  ('Nicotinamide Riboside (NR)', 5, NULL, 103.25, NULL, 103.25, 'Grherb Biotech'),
  ('Olive Leaf Extract 20%', 8.425, NULL, 19.96, NULL, 19.96, 'Grherb Biotech'),
  ('Partially Hydrolyzed Guar Gum /PHGG', 0, NULL, 12.9, NULL, 12.9, 'Reactal Group'),
  ('Passionfruit Flavour', 7.91, NULL, 53, NULL, 53, 'Flavours Factory'),
  ('Pea Protein', 615, NULL, 2.6, NULL, 2.6, 'GAB FOODS CO'),
  ('Peach Flavour', 10, NULL, 48, NULL, 48, 'Flavours Factory'),
  ('Peppermint Leaf Extract', 1.85, NULL, 7.81, NULL, 7.81, 'Grherd Biotech'),
  ('Phosphatidylserine', 1.72, NULL, 107.71, NULL, 60.71, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Phosphatidylcholine', 4, NULL, 32.9, NULL, 32.9, 'Hunan New Mstar Biotechnology Co'),
  ('Pineapple Flavour', 13.88, NULL, 35, NULL, 35, 'Flavours Factory'),
  ('Polygonum cuspidatum Ex 98% Tran-Resveratril', 4, NULL, NULL, NULL, NULL, NULL),
  ('Probiotics Powder', 0.51, NULL, 472.86, NULL, 472.86, 'CNAS'),
  ('Pumpkin Seed Extract', 7.7, NULL, 16.49, NULL, 16.49, 'Grherd Biotech'),
  ('Quercetin Dihydrate 95%', 0, NULL, 52.04, NULL, 52.04, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Reishi Mushroom Extract 10:1', 5.38, NULL, 22, NULL, 22, 'Summit ingredients B.V.'),
  ('Rhodiola Rosa Extract 3% rosavine', 3.4125, NULL, 127.54, NULL, 127.54, 'Grherb Biotech'),
  ('Rice Protein', 215, NULL, 3.04, NULL, 3.04, 'GAB FOODS CO'),
  ('S-Masker Flavour', 4.5, NULL, 54, NULL, 54, 'Flavours Factory'),
  ('Saw Palmetto Extract', 17.39, NULL, 25.6, NULL, 7.81, 'Grherd Biotech'),
  ('Shatavari extract powder', 0, NULL, 8.66, NULL, 8.66, 'Grherb Biotech Co Ltd'),
  ('Shilajit Extract (20% fulvic acid)', 18.055, NULL, 30.36, NULL, 30.36, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Spermidine 1%', 4.842, NULL, 19.96, NULL, 19.96, 'Grherb Biotech'),
  ('Stevia Extractn Andromeda', 10.096, NULL, NULL, NULL, NULL, NULL),
  ('Strawberry Flavour', 9.95, NULL, 44, NULL, 44, 'Flavours Factory'),
  ('Taurine', 28.286, NULL, 5.85, NULL, 5.38, 'Vitajoy'),
  ('Tribulus 40%', 16.325, NULL, 12.93, NULL, 12.93, 'Shaanxi Jiahe Phytochem'),
  ('Tribulus Terrestis 90%', 22.7, NULL, 31.79, NULL, 31.79, 'Tilia Cemical VEMO'),
  ('Tributyrin (Glyceryl Tributyrate) Powder 60%', 0, NULL, NULL, NULL, NULL, NULL),
  ('Tripotassium Citrate', 75.213, NULL, 2.15, NULL, 2.15, 'Tilia chemical'),
  ('Trisodium Citrate Didhydrate', 90, NULL, 1.84, NULL, 1.84, 'Tilia chemical'),
  ('Turmeric Extract (95% curcuminoids) Curcumin C3 Reduct', 13.33, NULL, 94, NULL, 94, 'Summit ingredients B.V.'),
  ('Uva Ursi Extract', 2.625, NULL, 9.52, NULL, 9.52, 'Grherb Biotech Co Ltd'),
  ('VANILLA FLAVOUR', 5.31, NULL, 27, NULL, 27, 'Flavours Factory'),
  ('Vitamin 12 (1%)', 0.8425, NULL, 47.72, NULL, 47.72, 'Grherb Biotech'),
  ('Vitamin B1 (Thiamine HCI)', 22.55, NULL, 42, NULL, 42, 'VIGO NUTRITION'),
  ('Vitamin B3 (Niacin)', 3.425, NULL, 30, NULL, 30, 'Summit ingredients B.V.'),
  ('Vitamin B6 ( P5P )', 2.299475, NULL, 194, NULL, 194, 'Sumit ingredients B.V.'),
  ('Vitamin B8/ inositol/Myo', 10.55425, NULL, 12, NULL, 12, 'ADVANTIC'),
  ('Vitamin C (Ascorbic acid)', 20.19, NULL, 3.48, NULL, 3.48, 'Astron Chemical'),
  ('Vitamin D3', 10, NULL, 13.88, NULL, 13.88, 'Shenzhen zhilicheng'),
  ('Vitamin E Acetate 50% powder', 0.165, NULL, 50, NULL, 50, 'Nutri Foods'),
  ('Vitamin K2', 1, NULL, 82.39, NULL, 82.39, 'Shenzhen zhilicheng'),
  ('Whey Protein Concentrate 80%', 82.6, NULL, 14.45, NULL, 12.83, 'Foodcom'),
  ('White Willow Bark Extract', 1.83, NULL, 9.52, NULL, 9.52, 'Grherb Biotech Co Ltd'),
  ('Zinc Citrate Trihydrate', 6, NULL, 23, NULL, 23, 'Nutri Foods'),
  ('Zinc Glycinate', 3.67, NULL, 17.35, NULL, 17.35, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Oryza GEL 350', 19.5, NULL, NULL, NULL, NULL, NULL),
  ('Oryza NAT H200R8', 24.5, NULL, NULL, NULL, NULL, NULL),
  ('Black Carrot Extract', 0, NULL, NULL, NULL, NULL, NULL),
  ('Sea Salt', 88.73, NULL, 0.25, NULL, NULL, 'Черноморски Солница АД'),
  ('Сукралоза', 0.311, NULL, 20, NULL, NULL, 'ПИК-КО АД'),
  ('Red Clover Extract', 0.7, NULL, 40.99, NULL, NULL, NULL),
  ('Fava Bean Protein', 80, NULL, NULL, NULL, NULL, NULL),
  ('Flax Seed Extract', 0.6375, NULL, 9.3, NULL, NULL, NULL),
  ('Sage Extract', 0.4875, NULL, 9.3, NULL, NULL, 'Hunan New Mstar Biotechnology');

-- Supplier spelling variants (same merges as the old app)
update nk_import_raw set supplier = 'Astron Chemicals' where supplier in ('Astron chemical', 'Astron Chemical', 'Astron chemicals');
update nk_import_raw set supplier = 'Tilia Chemical' where supplier in ('Tilia chemical', 'Tilia Chemical VEMO', 'Tilia Cemical VEMO');
update nk_import_raw set supplier = 'Shaanxi Jiahe Phytochem Co Ltd' where supplier in ('Shaanxi Jiahe Phytochem');

create temp table nk_import as
select row_number() over (order by btrim(r.name)) + 1000 as n,
       btrim(r.name) as name,
       case when btrim(r.name) in ('Magnesium Stearate', 'Microcrystalline Cellulose', 'Microstaline Cellulose', 'Fumed Silica')
            then 'excipient' else 'raw_material' end::public.item_type as type,
       nullif(btrim(r.supplier), '') as supplier,
       r.current_qty, r.min_stock, r.avg_buy_price, r.best_price
  from nk_import_raw r;
alter table nk_import add column sku text;
update nk_import set sku = case when type = 'excipient' then 'EX-' else 'RM-' end || n;

-- Suppliers
insert into public.suppliers (name, notes)
select distinct x.supplier, 'Imported from Nutrikal Inventory'
  from nk_import x
 where x.supplier is not null
   and not exists (select 1 from public.suppliers s where lower(s.name) = lower(x.supplier));

-- Items
insert into public.items (sku, type, name, base_unit, novel_food_status, reorder_level, notes)
select x.sku, x.type, x.name, 'kg', 'unknown', nullif(x.min_stock, 0),
       'Imported from Nutrikal Inventory. Check the Novel Food status, shelf life and Bulgarian name.'
  from nk_import x
on conflict (sku) do nothing;

-- Supplier items and current purchase price
insert into public.supplier_items (supplier_id, item_id, is_preferred)
select s.id, i.id, true
  from nk_import x
  join public.items i on i.sku = x.sku
  join public.suppliers s on lower(s.name) = lower(x.supplier)
on conflict (supplier_id, item_id) do nothing;

insert into public.supplier_prices (supplier_item_id, price, source)
select si.id, coalesce(nullif(x.best_price, 0), x.avg_buy_price), 'import'
  from nk_import x
  join public.items i on i.sku = x.sku
  join public.suppliers s on lower(s.name) = lower(x.supplier)
  join public.supplier_items si on si.item_id = i.id and si.supplier_id = s.id
 where coalesce(nullif(x.best_price, 0), x.avg_buy_price) is not null
   and not exists (select 1 from public.supplier_prices p where p.supplier_item_id = si.id);

-- Opening lots (released: the stock is already in use)
insert into public.lots (lot_number, item_id, supplier_id, received_on, qc_status, qc_notes, notes)
select 'OB-' || x.n, i.id, s.id, current_date, 'released',
       'Opening balance from Nutrikal Inventory', 'Opening balance from Nutrikal Inventory'
  from nk_import x
  join public.items i on i.sku = x.sku
  left join public.suppliers s on lower(s.name) = lower(x.supplier)
 where x.current_qty > 0
on conflict (lot_number) do nothing;

insert into public.stock_movements (type, lot_id, location_id, quantity, reference, reason)
select 'opening_balance', l.id, loc.id, x.current_qty, 'Nutrikal Inventory import', 'Opening balance'
  from nk_import x
  join public.lots l on l.lot_number = 'OB-' || x.n
  cross join (select id from public.locations
               where code = (select location_code from nk_import_settings)) loc
 where x.current_qty > 0
   and not exists (select 1 from public.stock_movements m where m.lot_id = l.id);

-- Lot cost = the old average purchase price
insert into public.lot_costs (lot_id, unit_cost, source)
select l.id, x.avg_buy_price, 'manual'
  from nk_import x
  join public.lots l on l.lot_number = 'OB-' || x.n
 where x.avg_buy_price is not null
on conflict (lot_id) do update
  set unit_cost = excluded.unit_cost, source = 'manual', updated_at = now()
  where public.lot_costs.source = 'supplier_price';

drop table nk_import;
drop table nk_import_raw;
drop table nk_import_settings;
