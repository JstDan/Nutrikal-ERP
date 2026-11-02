// Makes the local demo database fictional for recording, on top of the
// app's own demo seed (web/src/lib/db/demo-seed.ts). Runs as the database
// owner on the PGlite folder while the app is stopped.
// Nothing here may be a real client, person, e-mail, price or supplier term.

/** A made-up but stable €/kg price per price-list name. */
const fakePrice = (name) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 10 + (h % 50) + 0.5;
};

export async function seedDemo(db) {
  // ------------------------------------------------ company and people
  await db.exec(`
    update public.company_settings set legal_name = 'Nutrikal Demo Ltd', trade_name = 'Nutrikal Demo',
           vat_number = 'BG000000000', company_id = '000000000', address_line1 = 'ул. Примерна 1', city = 'Варна',
           postal_code = '9000', email = 'office@example.com', phone = '+359 00 000 000', website = 'https://example.com',
           bank_name = 'Demo Bank', iban = 'BG00 DEMO 0000 0000 0000 00', bic = 'DEMOBGSF';
    update public.calc_settings set company_name = 'Nutrikal Demo Ltd', company_id = '000000000', company_vat = 'BG000000000',
           company_address = 'ул. Примерна 1, 9000 Варна', company_email = 'office@example.com', company_phone = '',
           bank_iban = 'BG00 DEMO 0000 0000 0000 00 (EUR)', bank_name = 'Demo Bank', bank_bic = 'DEMOBGSF',
           bank_address = 'Sofia, Bulgaria', websites = 'example.com', logo_data_url = null,
           google_sheet_url = '', catalog_sheet_url = '';
    update public.profiles set full_name = case role::text
             when 'admin' then 'Елена Демо' when 'sales' then 'Иван Демо'
             when 'production' then 'Цех Демо' else 'Разработчик Демо' end,
           email = role::text || '@example.com';
  `);

  // The calculator must never download the real price list or catalog during
  // recording: a successful sync "in the future" means no sync is due.
  await db.exec(`
    insert into public.calc_sync_runs (created_at, source, status) values (now() + interval '365 days', 'manual', 'success');
    insert into public.calc_catalog_sync_runs (created_at, source, status) values (now() + interval '365 days', 'manual', 'success');
  `);

  // ------------------------------------------------ clients (fictional)
  await db.exec(`
    update public.clients set legal_name = 'Demo Client Ltd', trade_name = null, vat_number = 'GB000000001', company_id = null,
           city = 'London', country_code = 'GB', address_line1 = '1 Example Street', postal_code = 'E1 0AA',
           billing_email = 'accounts@example.com'
     where legal_name = 'Acme Wellness GmbH';
    update public.clients set legal_name = 'Sample Nutrition GmbH', vat_number = 'DE000000002', city = 'Berlin', country_code = 'DE'
     where legal_name = 'Nordic Labs AB';
    update public.clients set legal_name = 'Example Vita SRL', vat_number = 'RO00000003' where legal_name = 'Vita Market SRL';
    update public.clients set legal_name = 'Примерна Фарма ООД', vat_number = 'BG000000004', company_id = '000000004'
     where legal_name = 'Балкан Фарма ООД';
    update public.contacts set email = lower(first_name) || '@example.com' where email is not null;
    update public.contacts set phone = '+00 000 000 000' where phone is not null;
  `);

  // ------------------------------------------------ price list (made-up prices)
  const mats = (await db.query("select id, name from public.calc_raw_materials")).rows;
  for (const m of mats) {
    await db.query("update public.calc_raw_materials set price_eur_per_kg = $2 where id = $1", [m.id, fakePrice(m.name)]);
  }
  // Supplier prices and lot costs from the seed are made up already; round them so nothing looks real
  await db.exec(`
    update public.calc_settings set fixed_cost_capsules_glass = 2.00, fixed_cost_capsules_plastic = 1.80, fixed_cost_powder = 2.20;
  `);

  // ------------------------------------------------ one catalog product
  const name = async (like) => (await db.query("select name from public.calc_raw_materials where name ilike $1 order by name limit 1", [like])).rows[0]?.name ?? like;
  const composition = [
    { name: await name("Magnesium Bisglycinate 20%"), amount: 300, unit: "mg", note: null },
    { name: await name("L-Theanine%"), amount: 100, unit: "mg", note: null },
  ];
  await db.query(
    `insert into public.calc_catalog_products (code, name, category, tiers, sort_order, active,
                                                capsules_per_serving, capsules_per_container, servings_per_container, composition)
     values ('DEMO-101', 'Magnesium Night Demo', 'Sleep', $1::jsonb, 1, true, 2, 60, 30, $2::jsonb)
     on conflict (code) do nothing`,
    [JSON.stringify([{ min_qty: 1000, price: 4.2 }, { min_qty: 3000, price: 3.6 }, { min_qty: 5000, price: 3.2 }]), JSON.stringify(composition)],
  );
}
