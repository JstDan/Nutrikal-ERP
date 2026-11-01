-- =====================================================================
-- The public ingredient list (owner, Nov 2026): cleaned names of the active
-- raw materials in the inventory, without flavors and excipients. Separate
-- from items, so stock data, suppliers and prices never reach the open page.
--                  admin   sales   accountant  production/design
-- ingredient list  write   read    read        —
-- =====================================================================

create table public.catalog_ingredient_list (
  id          uuid primary key default gen_random_uuid(),
  grp         text not null check (grp in ('vitamins', 'minerals', 'amino', 'protein', 'mushrooms', 'botanicals', 'specialty')),
  name        text not null,
  sort_order  integer not null default 0,
  unique (grp, name)
);
select public.enable_audit('public.catalog_ingredient_list');
alter table public.catalog_ingredient_list enable row level security;
create policy catalog_ingredient_list_read on public.catalog_ingredient_list for select to authenticated using (public.has_role('admin', 'sales'));
create policy catalog_ingredient_list_write on public.catalog_ingredient_list for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
revoke all on public.catalog_ingredient_list from anon;

insert into public.catalog_ingredient_list (grp, name, sort_order) values
  ('vitamins', 'Vitamin B1 (Thiamine HCl)', 10),
  ('vitamins', 'Vitamin B3 (Niacin)', 10),
  ('vitamins', 'Niacinamide', 10),
  ('vitamins', 'Vitamin B6 (P5P)', 10),
  ('vitamins', 'Vitamin B12', 10),
  ('vitamins', 'Biotin', 10),
  ('vitamins', 'Folic Acid', 10),
  ('vitamins', 'Methylfolate (L-5-MTHF)', 10),
  ('vitamins', 'Inositol', 10),
  ('vitamins', 'Vitamin C (Ascorbic Acid)', 10),
  ('vitamins', 'Vitamin D3', 10),
  ('vitamins', 'Vitamin E', 10),
  ('vitamins', 'Vitamin K2', 10),
  ('minerals', 'Boron Glycinate', 20),
  ('minerals', 'Chromium Picolinate', 20),
  ('minerals', 'L-Selenomethionine', 20),
  ('minerals', 'Magnesium Bisglycinate', 20),
  ('minerals', 'Magnesium Citrate', 20),
  ('minerals', 'Magnesium Malate', 20),
  ('minerals', 'Tripotassium Citrate', 20),
  ('minerals', 'Trisodium Citrate', 20),
  ('minerals', 'Zinc Citrate', 20),
  ('minerals', 'Zinc Glycinate', 20),
  ('amino', 'BCAA 2:1:1', 30),
  ('amino', 'Beta-Alanine', 30),
  ('amino', 'Betaine Anhydrous', 30),
  ('amino', 'Creatine HCl', 30),
  ('amino', 'Creatine Monohydrate', 30),
  ('amino', 'GABA', 30),
  ('amino', 'Glycine', 30),
  ('amino', 'L-Carnitine Tartrate', 30),
  ('amino', 'L-Citrulline Malate', 30),
  ('amino', 'L-Theanine', 30),
  ('amino', 'L-Tyrosine', 30),
  ('amino', 'MSM', 30),
  ('amino', 'Taurine', 30),
  ('protein', 'Hydrolyzed Collagen', 40),
  ('protein', 'Fava Bean Protein', 40),
  ('protein', 'Pea Protein', 40),
  ('protein', 'Rice Protein', 40),
  ('protein', 'Whey Protein Concentrate 80%', 40),
  ('protein', 'Acacia Fiber', 40),
  ('protein', 'Glucomannan', 40),
  ('protein', 'Inulin', 40),
  ('protein', 'Partially Hydrolyzed Guar Gum (PHGG)', 40),
  ('mushrooms', 'Chaga Extract', 50),
  ('mushrooms', 'Cordyceps Extract', 50),
  ('mushrooms', 'Lion’s Mane Extract', 50),
  ('mushrooms', 'Reishi Extract', 50),
  ('mushrooms', 'Mushroom Mix', 50),
  ('botanicals', 'Acai Berry Extract', 60),
  ('botanicals', 'Acerola Cherry Extract', 60),
  ('botanicals', 'Apple Cider Vinegar Powder', 60),
  ('botanicals', 'Artichoke Extract', 60),
  ('botanicals', 'Ashwagandha Extract 5%', 60),
  ('botanicals', 'Bacopa Extract 20%', 60),
  ('botanicals', 'Bamboo Extract', 60),
  ('botanicals', 'Beetroot Extract', 60),
  ('botanicals', 'Berberine HCl', 60),
  ('botanicals', 'Birch Leaf Extract', 60),
  ('botanicals', 'Black Carrot Extract', 60),
  ('botanicals', 'Black Maca Extract', 60),
  ('botanicals', 'Black Pepper Extract', 60),
  ('botanicals', 'Blessed Thistle Extract', 60),
  ('botanicals', 'Boswellia 65%', 60),
  ('botanicals', 'Ceylon Cinnamon', 60),
  ('botanicals', 'Chamomile Extract', 60),
  ('botanicals', 'Citrus Bergamot Extract', 60),
  ('botanicals', 'Citrus Flavonoids 50%', 60),
  ('botanicals', 'Corn Silk Extract', 60),
  ('botanicals', 'Dandelion Root Extract', 60),
  ('botanicals', 'Devil’s Claw Extract', 60),
  ('botanicals', 'Fennel Seed Extract', 60),
  ('botanicals', 'Fenugreek Extract 50%', 60),
  ('botanicals', 'Flax Seed Extract', 60),
  ('botanicals', 'Garlic Extract', 60),
  ('botanicals', 'Ginger Extract', 60),
  ('botanicals', 'Ginseng Root Extract', 60),
  ('botanicals', 'Green Tea Extract (50% EGCG)', 60),
  ('botanicals', 'Guarana Extract', 60),
  ('botanicals', 'Horsetail Extract', 60),
  ('botanicals', 'Juniper Berry Extract', 60),
  ('botanicals', 'Lemon Balm Extract', 60),
  ('botanicals', 'Milk Thistle Extract', 60),
  ('botanicals', 'Moringa Leaf Extract', 60),
  ('botanicals', 'Nettle Root Extract', 60),
  ('botanicals', 'Olive Leaf Extract 20%', 60),
  ('botanicals', 'Peppermint Leaf Extract', 60),
  ('botanicals', 'Pumpkin Seed Extract', 60),
  ('botanicals', 'Red Clover Extract', 60),
  ('botanicals', 'Rhodiola Rosea Extract', 60),
  ('botanicals', 'Sage Extract', 60),
  ('botanicals', 'Saw Palmetto Extract', 60),
  ('botanicals', 'Shatavari Extract', 60),
  ('botanicals', 'Shilajit Extract (20% fulvic acid)', 60),
  ('botanicals', 'Tribulus Terrestris Extract', 60),
  ('botanicals', 'Turmeric Extract (95% curcuminoids)', 60),
  ('botanicals', 'Uva Ursi Extract', 60),
  ('botanicals', 'White Willow Bark Extract', 60),
  ('specialty', 'Adenosine Triphosphate (ATP)', 70),
  ('specialty', 'Apigenin', 70),
  ('specialty', 'Astaxanthin', 70),
  ('specialty', 'Caffeine Anhydrous', 70),
  ('specialty', 'Chondroitin Sulfate', 70),
  ('specialty', 'Citicoline', 70),
  ('specialty', 'Coconut Water Powder', 70),
  ('specialty', 'Coenzyme Q10', 70),
  ('specialty', 'D-Chiro-Inositol', 70),
  ('specialty', 'D-Ribose', 70),
  ('specialty', 'DigeZyme', 70),
  ('specialty', 'DL-Malic Acid', 70),
  ('specialty', 'DNF-10', 70),
  ('specialty', 'Enzyme Blend', 70),
  ('specialty', 'Fish Oil', 70),
  ('specialty', 'Fisetin 98%', 70),
  ('specialty', 'Glucosamine Sulfate', 70),
  ('specialty', 'Hyaluronic Acid', 70),
  ('specialty', 'L-Choline Bitartrate', 70),
  ('specialty', 'Lactase', 70),
  ('specialty', 'LactoSpore', 70),
  ('specialty', 'Lutein', 70),
  ('specialty', 'Lutein & Zeaxanthin', 70),
  ('specialty', 'Melatonin', 70),
  ('specialty', 'NMN', 70),
  ('specialty', 'Nicotinamide Riboside', 70),
  ('specialty', 'Phosphatidylcholine', 70),
  ('specialty', 'Phosphatidylserine', 70),
  ('specialty', 'Probiotics', 70),
  ('specialty', 'Quercetin 95%', 70),
  ('specialty', 'Trans-Resveratrol 98%', 70),
  ('specialty', 'Spermidine 1%', 70),
  ('specialty', 'Tributyrin', 70);

create or replace function public.catalog_public()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'ingredient_list', coalesce((select jsonb_agg(jsonb_build_object('grp', i.grp, 'name', i.name) order by i.sort_order, i.name) from catalog_ingredient_list i), '[]'),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_bg', c.name_bg) order by c.sort_order, c.name)
        from catalog_categories c
       where exists (select 1 from catalog_products p
                      where (p.category_id = c.id or exists (select 1 from catalog_product_categories x where x.product_id = p.id and x.category_id = c.id))
                        and p.is_published and catalog_publish_problem(p.id) is null)), '[]'),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', p.code, 'name', p.name, 'name_bg', p.name_bg,
               'description', p.description, 'description_bg', p.description_bg,
               'category_id', p.category_id,
               'extra_category_ids', (select coalesce(jsonb_agg(x.category_id), '[]') from catalog_product_categories x where x.product_id = p.id),
               'format', coalesce(f.product_format, p.product_format), 'min_qty', p.min_qty, 'image', p.image,
               'pack', p.pack, 'pack_bg', p.pack_bg,
               'serving_size', f.serving_size, 'serving_unit', f.serving_unit, 'servings_per_pack', f.servings_per_pack,
               'tiers', (select coalesce(jsonb_agg(jsonb_build_object('min_qty', t.min_qty, 'unit_price', t.unit_price) order by t.min_qty), '[]')
                           from catalog_price_tiers t where t.product_id = p.id),
               'price_on_request', p.price_on_request,
               'ingredients', case when p.formula_id is null then
                                (select coalesce(jsonb_agg(jsonb_build_object('name', x ->> 'name', 'name_bg', null, 'amount', x ->> 'amount', 'unit', null)), '[]')
                                   from jsonb_array_elements(p.ingredients) x)
                              else
                                (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'name_bg', i.name_bg, 'amount', l.amount, 'unit', l.unit)
                                                           order by l.sort_order, l.amount_mg desc), '[]')
                                   from formula_lines l join items i on i.id = l.item_id where l.version_id = v.id)
                              end,
               'claims', (select coalesce(jsonb_agg(jsonb_build_object('en', h.claim_en, 'bg', h.claim_bg)), '[]')
                            from formula_version_claims c join health_claims h on h.id = c.claim_id
                           where c.version_id = v.id and h.is_active)
             ) order by p.sort_order, p.name)
        from catalog_products p
        left join formulas f on f.id = p.formula_id
        left join formula_versions v on v.formula_id = f.id and v.status = 'approved'
       where p.is_published and catalog_publish_problem(p.id) is null), '[]'))
$$;
