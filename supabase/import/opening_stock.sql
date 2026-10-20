-- =====================================================================
-- One-off import: opening stock from the Nutrikal Inventory app
-- (142 ingredients, 125 with stock, as exported on 19 Oct 2026).
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
  ('Acacia Fiber/Gum Arabica', 6.85, NULL, 13.70, 93.85, 0.00, NULL),
  ('Acai Berry Extract', 12.26, NULL, 16.00, 196.16, NULL, NULL),
  ('Acerola Cherry Extract', 14.88, NULL, 6.00, 89.28, 30, NULL),
  ('Agave / Inolin', 20, NULL, 4.36, 87.20, 4.36, 'Astron chemical'),
  ('Apigenin', 12.5, NULL, 23.50, 293.75, 23.50, 'SRS Nutrition Express'),
  ('Apple Cider Vinegar powder', 7.922, NULL, 9.52, 75.42, 9.52, 'Grherb Biotech Co Ltd'),
  ('Artichoke Extract', 0.55, NULL, 112.68, 61.97, 112.68, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Ashwagandha Extract 5%', 3.185, NULL, 32.67, 104.04, 30, 'VIGO NUTRITION'),
  ('ATR - Adenosine Triphosphate', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Bacopa Extract 20%', 0.848, NULL, 24.27, 20.58, 9.53, 'Grherb Biotech Co Ltd'),
  ('Bamboo Brown Extract', 12.5, NULL, 23.50, 293.75, 23.5, 'SRS Nutrition Express'),
  ('Bamboo Extract White', 10.61, NULL, 23.50, 249.34, 23.5, 'SRS Nutrition Express'),
  ('BCAA - instant - Leucine:isoleucine:Valine 2:1:1', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Beetroot Extract', 4.5, NULL, 7.79, 35.06, 7.79, 'Grherb Biotech Co Ltd'),
  ('Berberine HCI / Three Needle Ex', 0.55, NULL, 112.68, 61.97, 112.68, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Beta - Alanine', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Betaine Anhydrous', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Biotin', 1.953, NULL, 18.66, 36.43, 17.31, 'Grherb Biotech Co Ltd'),
  ('Birch Leaf Extract', 9.713, NULL, 9.52, 92.47, 9.52, 'Grherb Biotech Co Ltd'),
  ('Black Maca Extract', 10, NULL, 10.40, 104.00, 10.4, 'Shenzhen zhilicheng'),
  ('Black Pepper Extract', 0.4482, NULL, 243.00, 108.91, 243.00, 'Summit ingredients B.V.'),
  ('Blackcurrant Flavour', 10, NULL, 39.00, 390.00, 39.00, 'Flavours Factory'),
  ('Blessed Thistle Extract powder', NULL, NULL, 9.52, 0.00, 9.52, 'Grherb Biotech Co Ltd'),
  ('Boron Glycinate', 3.617, NULL, 30.35, 109.78, 30.35, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Boswellia 65%', 27.167, NULL, 22.25, 604.47, 26.00, 'Summit ingredients B.V.'),
  ('Caffeine Anhydrous', 20, NULL, 20.00, 400.00, 20, 'Forwardfarma'),
  ('Caramel Salty Flavour', 17.95, NULL, 35.00, 628.25, 35, 'Flavours Factory'),
  ('Ceylon Cinnamon Extract', 10.16, NULL, 13.85, 140.72, 13.85, 'Grherb Biotech Co Ltd'),
  ('Chaga Mushroom Extract 10:1', 8.18, NULL, 22.00, 179.96, 22, 'Summit ingredients B.V.'),
  ('Chamomile Extract', 18.7, NULL, NULL, NULL, NULL, NULL),
  ('Chondroitin Sulfate', 25, NULL, 36.50, 912.50, 36.5, 'PHARMANZEN B.V.'),
  ('Chromium Picolinate', 0.948, NULL, 27.70, 26.26, 27.70, 'Grherb Biotech Co Ltd'),
  ('Citicoline', 12.495, NULL, 122.00, 1524.39, 122, 'Summit ingredients B.V.'),
  ('Citrus Bergamot Extract', 20.225, NULL, 22.00, 444.95, 22, 'Summit ingredients B.V.'),
  ('Citrus Flavonoids 50%', 4.76, NULL, NULL, NULL, NULL, NULL),
  ('Coconut Water powder', 4.49, NULL, 8.66, 38.88, 8.66, 'Grherb Biotech Co Ltd'),
  ('Coenzyme Q10', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Collagen', 3.03, NULL, 12.02, 36.42, 12.02, 'Astron chemicals'),
  ('Collagen Hydrolyzed', 600, 25, 9.50, 5700.00, NULL, NULL),
  ('Collinstant Active Powder Bag', 550.18, NULL, 10.00, 5501.80, NULL, NULL),
  ('Cordyceps Extract 30%', 7.7, NULL, NULL, NULL, NULL, NULL),
  ('Corn Silk Extract', 8.41, NULL, NULL, NULL, NULL, NULL),
  ('Creatine HCL', 24.9, NULL, 11.25, 280.13, 11.25, 'Vitajoy'),
  ('Creatine Monohydrate', 137.6, NULL, 4.30, 591.68, 4.3, 'SRS Nutrition Express'),
  ('D-Biotin 2%', 23.425, NULL, 17.00, 398.23, NULL, NULL),
  ('D-Chiro-Inositol', 4.311, NULL, 189.86, 818.47, 160, 'Forwardfarma'),
  ('D-Ribose', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Dandelion Extract', 25, NULL, NULL, NULL, NULL, NULL),
  ('Dandelion Root Extract', 0.91, NULL, 8.66, 7.88, 8.66, 'Grherb Biotech Co Ltd'),
  ('DigeZyme', 5, NULL, NULL, NULL, NULL, NULL),
  ('DL-Malic-Acid', 23, NULL, 2.38, 54.74, 2.38, 'Astron chemicals'),
  ('DNF-10', 16.3, NULL, NULL, NULL, NULL, NULL),
  ('Enzyme Blend', 7.125, NULL, NULL, NULL, NULL, NULL),
  ('Fennel Seed Extract powder', 1.275, NULL, 8.58, 10.94, 8.66, 'Grherb Biotech Co Ltd'),
  ('Fenugreek Extract 50%', 4.25, NULL, 17.35, 73.74, 17.35, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Fisetin 98%', 0.425, NULL, NULL, NULL, NULL, NULL),
  ('Fish Oil Softgel', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Folic Acid', 1, NULL, 82.39, 82.39, 82.39, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Forest Fruit Flavour', 9.95, NULL, 59.00, 587.05, NULL, NULL),
  ('Fumed Silica', 9.9, NULL, NULL, NULL, NULL, NULL),
  ('GABA', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Garlic Extract', 6.85, NULL, 33.00, 226.05, 33, 'Summit ingredients B.V.'),
  ('Ginger', 12.365, NULL, 33.00, 408.05, 33, 'VIGO NUTRITION'),
  ('Ginseng Root Extract', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Glucomannan', 8.28, NULL, 16.45, 136.21, 16.45, 'Grherb Biotech Co Ltd'),
  ('Glucosamine Sulfate 2KCI', 55.35, NULL, 8.70, 481.55, 8.7, 'PHARMANZEN B.V.'),
  ('Glucosyl Steviol E5', 4, NULL, NULL, NULL, NULL, NULL),
  ('Glycine', 2.3, NULL, 5.55, 12.77, 5.55, NULL),
  ('Grape Flavour', 9.95, NULL, 53.00, 527.35, 53, 'Flavours Factory'),
  ('Green Tea Extract (50% EGCG)', 19.487, NULL, 24.67, 480.68, 16.00, 'PHARMANZEN B.V.'),
  ('Guarana Extract', 20.33, NULL, 27.00, 548.91, 27.00, 'VIGO NUTRITION'),
  ('Harpagophytum Extract', 6.425, NULL, 9.52, 61.17, 9.52, 'Grherb Biotech Co Ltd'),
  ('Horsetail Extract', 2.054, NULL, 11.25, 23.11, 11.25, 'Grherb Biotech Co Ltd'),
  ('Hyaluronate Sodium', 1.39, NULL, 169.06, 234.99, 84.50, 'SRS Nutrition Express'),
  ('Inositol', 25, NULL, 10.40, 260.00, 10.40, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Juniper Berry Extract', 8.41, NULL, NULL, NULL, NULL, NULL),
  ('L-Carnitine Tartrate', 21.062, NULL, 23.00, 484.43, 23.00, 'Majorchem'),
  ('L-Citrulline DL-Malate', 69, NULL, 7.62, 525.78, 7.62, 'Vitajoy'),
  ('L-Selenomethionine / Boswellia Serrata Ex', 3, NULL, NULL, NULL, NULL, NULL),
  ('L-Theanine', 21.77, NULL, 21.50, 468.06, 23.00, 'Summit ingredients B.V.'),
  ('L-Tyrosine', 13.926, NULL, 11.20, 155.97, 11.20, 'PHARMANZEN B.V.'),
  ('Lactase 100000 ALU/gm', 0.7, NULL, NULL, NULL, NULL, NULL),
  ('Lemon Balm Extract', 10.45, NULL, 9.52, 99.48, 9.52, 'Grherb Biotech Co Ltd'),
  ('Lions Mane Extract 10:1', 40.403, NULL, 17.00, 686.85, 17.00, 'Summit ingredients B.V.'),
  ('Lutein', 0.35, NULL, 0.35, 0.12, 12.98, 'Grherb Biotech Co Ltd'),
  ('Magnesium Bisglycinate', 72.0055, NULL, 10.20, 734.10, 8.33, 'Vitajoy'),
  ('Magnesium Citrate', 22.88, NULL, NULL, NULL, NULL, NULL),
  ('Magnesium Malate', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Magnesium Stearate', NULL, NULL, 5.22, NULL, 5.22, 'Astron chemicals'),
  ('Marigold Extract (20% Lutein 4% Zeaxanthin)', 1.5, NULL, NULL, NULL, NULL, NULL),
  ('Melatonin', 2, NULL, 91.87, 183.73, 86.73, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Methylfolate L-5-MTHF', 0.079, NULL, 2100.00, 165.90, 2100.00, 'Summit ingredients B.V.'),
  ('Microcrystalline Cellulose', 46.297, NULL, 3.91, 181.02, 3.91, 'Astron chemicals'),
  ('Milk Chocolate Flavour', 9.95, NULL, 29.00, 288.55, 29.00, 'Flavours Factory'),
  ('Moringa Leaf Extract powder', NULL, NULL, 8.66, NULL, 8.66, 'Grherb Biotech Co Ltd'),
  ('MSM Methylsulfonylmethane', 21.85, NULL, 9.50, 207.58, 9.50, 'PHARMANZEN B.V.'),
  ('Mushroom Mix (Chaga/Reishi/Shiitake/Lions Mane/Cordyceps/Turkey Tail)', 1.55, NULL, 6.92, 10.73, 6.92, 'Shenzhen zhilicheng'),
  ('Nettle Root Extract', 20, NULL, NULL, NULL, NULL, NULL),
  ('Niacinamide', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Nicotinamide Riboside (NR)', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Olive Leaf Extract 20%', 8.425, NULL, NULL, NULL, NULL, NULL),
  ('Passionfruit Flavour', 9.95, NULL, 53.00, 527.35, 53.00, 'Flavours Factory'),
  ('Pea Protein', 15, NULL, NULL, NULL, NULL, NULL),
  ('Peach Flavour', 10, NULL, 48.00, 480.00, 48.00, 'Flavours Factory'),
  ('Peppermint Leaf Extract', 1.85, NULL, NULL, NULL, NULL, NULL),
  ('Phosphatidylserine', 4.685, NULL, 97.57, 457.12, 60.71, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Pineapple Flavour', 10, NULL, 35.00, 350.00, 35.00, 'Flavours Factory'),
  ('Probiotics Powder', 0.51, NULL, NULL, NULL, NULL, NULL),
  ('Pumpkin Seed Extract', 14, NULL, NULL, NULL, NULL, NULL),
  ('Quercetin Dihydrate 95%', NULL, NULL, 52.04, NULL, 52.04, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Reishi Mushroom Extract 10:1', 5.38, NULL, 22.00, 118.36, 22.00, 'Summit ingredients B.V.'),
  ('Rhodiola Rosea Extract 3%', 3.775, NULL, NULL, NULL, NULL, NULL),
  ('Rice Protein', 15, NULL, NULL, NULL, NULL, NULL),
  ('S-Masker Flavour', 4.5, NULL, 54.00, 243.00, 54.00, 'Flavours Factory'),
  ('Saw Palmetto Extract', 15, NULL, NULL, NULL, NULL, NULL),
  ('Shatavari Extract powder', NULL, NULL, 8.66, NULL, 8.66, 'Grherb Biotech Co Ltd'),
  ('Shilajit Extract (20% fulvic acid)', 18.055, NULL, 30.36, 548.15, 30.36, 'Shaanxi Jiahe Phytochem Co Ltd'),
  ('Spermidine 1%', 4.842, NULL, NULL, NULL, NULL, NULL),
  ('Stevia Extract', 4, NULL, NULL, NULL, NULL, NULL),
  ('Strawberry Flavour', 9.95, NULL, 44.00, 437.80, 44.00, 'Flavours Factory'),
  ('Taurine', 14.145, NULL, 5.38, 76.10, 5.38, 'Vitajoy'),
  ('Tribulus 40%', 16.325, NULL, 12.93, 211.08, 12.93, 'Shaanxi Jiahe Phytochem'),
  ('Tribulus Terrestris 90%', 2.9, NULL, 31.79, 92.19, 31.79, 'Tilia Chemical VEMO'),
  ('Tributyrin Powder 60%', 0.55, NULL, NULL, NULL, NULL, NULL),
  ('Tripotassium Citrate', 75.213, NULL, 2.15, 161.71, 2.15, 'Tilia chemical'),
  ('Trisodium Citrate Dihydrate', 90, NULL, 1.84, 165.60, 1.84, 'Tilia chemical'),
  ('Turmeric Extract (95% curcuminoids)', 19.445, NULL, 94.00, 1827.83, 94.00, 'Summit ingredients B.V.'),
  ('Uva Ursi Extract', 2.625, NULL, 9.52, 24.99, 9.52, 'Grherb Biotech Co Ltd'),
  ('Vanilla Flavour', 9.9, NULL, 27.00, 267.30, 27.00, 'Flavours Factory'),
  ('Vitamin B12 (1%)', 0.8425, NULL, NULL, NULL, NULL, NULL),
  ('Vitamin B1 (Thiamine HCI)', 22.55, NULL, 42.00, 947.10, 42.00, 'VIGO NUTRITION'),
  ('Vitamin B3 (Niacin)', 3.425, NULL, 30.00, 102.75, 30.00, 'Summit ingredients B.V.'),
  ('Vitamin B6 (P5P)', 2.83025, NULL, 194.00, 549.07, 194.00, 'Summit ingredients B.V.'),
  ('Vitamin B8 / Myo-Inositol', 26.095, NULL, 12.00, 313.14, NULL, NULL),
  ('Vitamin C (Ascorbic acid)', 15.63, NULL, 3.48, 54.39, 3.48, 'Astron Chemical'),
  ('Vitamin D3', 10, NULL, 13.88, 138.80, 13.88, 'Shenzhen zhilicheng'),
  ('Vitamin E Acetate 50% powder', 1.74, NULL, 50.00, 87.00, NULL, NULL),
  ('Vitamin K2', 1, NULL, 82.39, 82.39, 82.39, 'Shenzhen zhilicheng'),
  ('Whey Protein Concentrate 80%', 82.6, NULL, 14.45, 1193.57, 12.83, 'Foodcom'),
  ('White Willow Bark Extract', 3.425, NULL, 9.52, 32.61, 9.52, 'Grherb Biotech Co Ltd'),
  ('Zinc Citrate Trihydrate', 6, NULL, 23.00, 138.00, NULL, NULL),
  ('Zinc Glycinate', 3.67, NULL, 17.35, 63.67, 17.35, 'Shaanxi Jiahe Phytochem Co Ltd');

-- Supplier spelling variants (same merges as the old app)
update nk_import_raw set supplier = 'Astron Chemicals' where supplier in ('Astron chemical', 'Astron Chemical', 'Astron chemicals');
update nk_import_raw set supplier = 'Tilia Chemical' where supplier in ('Tilia chemical', 'Tilia Chemical VEMO');
update nk_import_raw set supplier = 'Shaanxi Jiahe Phytochem Co Ltd' where supplier in ('Shaanxi Jiahe Phytochem');

create temp table nk_import as
select row_number() over (order by btrim(r.name)) + 1000 as n,
       btrim(r.name) as name,
       case when btrim(r.name) in ('Magnesium Stearate', 'Microcrystalline Cellulose', 'Fumed Silica')
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
