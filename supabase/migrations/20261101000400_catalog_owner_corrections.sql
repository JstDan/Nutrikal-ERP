-- =====================================================================
-- Owner's corrections (Nov 2026): Knee Support and Back Comfort are out;
-- bone, cellular energy, sexual performance and all liposomal formulas are
-- capsules; bars and cookies are the last category.
-- =====================================================================

delete from public.catalog_products where code in ('NEW-042', 'NEW-043');

update public.catalog_products
   set product_format = 'capsule',
       pack = case code
                when 'NEW-025' then 'Target: 4 capsules'
                when 'NEW-016' then 'Capsules; daily count to be set in fill trials'
                when 'NEW-034' then 'Capsules; daily count to be set in fill trials'
                else 'Supplier-dependent serving'
              end
 where code in ('NEW-016', 'NEW-025', 'NEW-034', 'NEW-035', 'NEW-036', 'NEW-037', 'NEW-038', 'NEW-039');

update public.catalog_categories set sort_order = 1000 where name = 'Protein Bars, Brownies and Cookies';
