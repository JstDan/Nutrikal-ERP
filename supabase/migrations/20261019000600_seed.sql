-- =====================================================================
-- Nutrikal ERP + CRM — Phase 1 — 0006 reference data
-- Edit freely in the app (Admin) after setup.
-- =====================================================================

insert into public.company_settings (id, trade_name, country_code, base_currency, default_vat_rate,
                                     default_balance_terms)
values (true, 'Nutrikal', 'BG', 'EUR', 20.00, 'before_dispatch')
on conflict (id) do nothing;

-- Number series. Invoices, credit notes and debit notes share ONE series
-- (Bulgarian practice: one continuous 10-digit sequence). Admin sets
-- next_number to continue from the current invoicing tool.
insert into public.number_series (key, label, prefix, next_number, pad_length) values
  ('client',        'Client code',              'NK-C-', 1, 4),
  ('project',       'Project code',             'NK-P-', 1, 4),
  ('lot',           'Internal lot number',      'LOT-',  1, 6),
  ('invoice',       'Invoices, credit and debit notes', '', 1, 10),
  ('proforma',      'Proforma invoices',        'PF-',   1, 6),
  ('offer',         'Offers',                   'OF-',   1, 5),
  ('sales_order',   'Sales orders',             'SO-',   1, 5),
  ('purchase_order','Purchase orders',          'PO-',   1, 5),
  ('production',    'Manufacturing orders',     'MO-',   1, 5),
  ('delivery_note', 'Delivery notes',           'DN-',   1, 5)
on conflict (key) do nothing;

-- Locations. All stock is Nutrikal-owned; the partner works only in the
-- partner-visible locations.
insert into public.locations (code, name, type, is_partner_visible) values
  ('NK-WH',  'Nutrikal warehouse', 'warehouse',        false),
  ('PF',     'Partner facility',   'partner_facility', true)
on conflict (code) do nothing;

insert into public.locations (code, name, type, parent_id, is_partner_visible)
select v.code, v.name, v.type::public.location_type, p.id, true
  from (values
    ('PF-QUAR', 'Partner facility – quarantine area',   'quarantine'),
    ('PF-RM',   'Partner facility – raw materials',     'partner_facility'),
    ('PF-PACK', 'Partner facility – packaging',         'partner_facility'),
    ('PF-FG',   'Partner facility – finished goods',    'partner_facility')
  ) as v(code, name, type)
  cross join (select id from public.locations where code = 'PF') p
on conflict (code) do nothing;
