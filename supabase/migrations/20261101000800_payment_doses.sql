-- =====================================================================
-- Owner, Nov 2026: 60/40 also in the calculator, and two capsule products
-- lowered to fit about 4 size 00 capsules a day. The original doses stay in
-- the internal notes.
-- =====================================================================

alter table public.calc_settings alter column default_payment_terms set default '60% Down Payment and 40% Balance Payment when goods are ready to be shipped';
update public.calc_settings set default_payment_terms = '60% Down Payment and 40% Balance Payment when goods are ready to be shipped';

update public.catalog_products
   set internal_notes = concat_ws(E'\n', 'Doses lowered by the owner on 2026-11-01. Was: L-Citrulline 3000 mg, L-Arginine 1500 mg.', internal_notes),
       pack = 'Target: 4 capsules',
       ingredients = '[{"name":"L-Citrulline","amount":"1500 mg","spec":"Free L-citrulline, not citrulline malate","basis":"ingredient mass"},{"name":"L-Arginine","amount":"800 mg","spec":"Free base","basis":"ingredient mass"},{"name":"Panax ginseng root extract","amount":"200 mg","spec":"5% total ginsenosides","basis":"extract mass"},{"name":"Pine bark extract","amount":"100 mg","spec":"Pinus pinaster; target 65% procyanidins; analytical method required","basis":"extract mass"},{"name":"Vitamin C","amount":"100 mg","spec":"Ascorbic acid","basis":"active vitamin"}]'::jsonb
 where code = 'NTL-MH102';

update public.catalog_products
   set internal_notes = concat_ws(E'\n', 'Doses lowered by the owner on 2026-11-01. Was: creatine monohydrate 3410 mg, taurine 1000 mg, magnesium 100 mg.', internal_notes),
       pack = 'Target: 4 capsules',
       ingredients = '[{"name":"Creatine monohydrate","amount":"1500 mg","spec":"Assay conversion required","basis":"ingredient mass"},{"name":"Taurine","amount":"600 mg","spec":"Food-grade","basis":"ingredient mass"},{"name":"Magnesium","amount":"50 mg","spec":"Magnesium citrate; assay dependent","basis":"elemental mineral"},{"name":"Vitamin B1","amount":"1.1 mg","spec":"Thiamine hydrochloride","basis":"active vitamin"},{"name":"Vitamin B2","amount":"1.4 mg","spec":"Riboflavin","basis":"active vitamin"},{"name":"Vitamin B3","amount":"16 mg","spec":"Nicotinamide","basis":"active vitamin"}]'::jsonb
 where code = 'NTL-SP112';
