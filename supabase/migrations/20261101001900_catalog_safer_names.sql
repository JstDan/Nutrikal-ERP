-- Eight names read like a promise or a medicine; neutral names instead (owner, Nov 2026).
-- The product stays the same; its code and composition do not change.
update public.catalog_products p set name = x.name, name_bg = x.name_bg
  from (values
    ('NTL-TH116', 'Herbal Gut Complex', 'Билков комплекс за червата'),
    ('NTL-TH117', 'Men''s Hair Complex', 'Мъжки комплекс за коса'),
    ('NTL-WM106', 'Appetite Balance Formula', 'Формула за баланс на апетита'),
    ('NTL-WM107', 'Thermo Active Complex', 'Термо Актив Комплекс'),
    ('NTL-LF105', 'Morning Reset (Herbal & Electrolyte Blend)', 'Morning Reset (билково-електролитна смес)'),
    ('NTL-TH122', 'Daily Antioxidant Complex', 'Ежедневен антиоксидантен комплекс'),
    ('NTL-MH102', 'Men''s Vigor Complex', 'Мъжки комплекс за жизненост'),
    ('NTL-LC104', 'Healthy Aging Complex', 'Комплекс за здравословно стареене')
  ) as x (code, name, name_bg)
 where p.code = x.code;
