// The fixed queries of Nutri AI (owner, Nov 2026: the assistant as the company's brain). Read only, each run as the
// signed-in user, so row-level security decides what comes back. Names are found with the smart search
// (nk_search_hit: Cyrillic or Latin, a letter wrong or missing). No imports here: test/ai-queries.mjs runs every
// query against a fresh database to catch a wrong column before it reaches anyone.

export type Args = { term?: string; status?: string; code?: string; from?: string; to?: string; days?: number; query?: string };
export type Query = [sql: string, params: unknown[]];

const LIMIT = 25;
export const term = (a: Args) => (a.term ?? "").trim().slice(0, 100);
const code = (a: Args) => (a.code ?? "").trim().toUpperCase();
const isoDate = (s: string | undefined, fallback: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/** A name found the smart way; the best fit first. */
const smart = (text: string, p = "$1") => `nk_search_hit(${text}, ${p})`;
const fit = (text: string, p = "$1") => `nk_search_score(${text}, ${p}) desc`;

export const QUERIES: Record<string, (a: Args) => Query> = {
  find_clients: (a) => [
    `select code, legal_name, trade_name, status, country_code, city, vat_number, billing_email, '/clients/' || id as link from clients
      where $1 = '' or code ilike '%' || $1 || '%' or vat_number ilike '%' || $1 || '%' or ${smart("concat_ws(' ', legal_name, trade_name)")}
      order by ${fit("concat_ws(' ', legal_name, trade_name)")}, legal_name limit ${LIMIT}`, [term(a)]],

  client_overview: (a) => [
    `with c as (
       select * from clients
        where code ilike $1 or ${smart("concat_ws(' ', legal_name, trade_name)")}
        order by (code ilike $1) desc, ${fit("concat_ws(' ', legal_name, trade_name)")} limit 1)
     select json_build_object(
       'client', json_build_object('code', c.code, 'name', c.legal_name, 'trade_name', c.trade_name, 'status', c.status, 'country', c.country_code,
                   'city', c.city, 'vat_number', c.vat_number, 'billing_email', c.billing_email, 'phone', c.phone, 'website', c.website,
                   'currency', c.currency, 'notes', left(c.notes, 600), 'source', c.source, 'since', c.created_at::date,
                   'responsible', (select full_name from profiles where id = c.owner_id), 'link', '/clients/' || c.id),
       'contacts', (select json_agg(json_build_object('name', concat_ws(' ', k.first_name, k.last_name), 'position', k.position, 'email', k.email,
                   'phone', k.phone, 'primary', k.is_primary) order by k.is_primary desc, k.last_name) from contacts k where k.client_id = c.id),
       'projects', (select json_agg(json_build_object('code', p.code, 'name', p.name, 'status', p.status, 'format', p.product_format,
                   'target_date', p.target_date, 'expected_units', p.expected_units) order by p.created_at desc) from projects p where p.client_id = c.id),
       'orders', (select json_agg(x order by x.code desc) from (
                   select o.code, o.status, o.created_at::date as created, o.requested_date, o.total_packs, t.gross as total_with_vat, '/orders/' || o.id as link
                     from sales_order_overview o cross join lateral order_totals(o.id) t
                    where o.client_id = c.id order by o.code desc limit 15) x),
       'open_invoices', (select json_agg(x) from (
                   select i.number, i.issue_date, i.due_date, i.total, i.currency, invoice_open_amount(i.id) as left_to_pay,
                          (i.due_date < current_date) as overdue, '/invoices/' || i.id as link
                     from invoices i where i.client_id = c.id and i.status = 'issued' and i.kind = 'invoice' and invoice_open_amount(i.id) > 0) x),
       'offers', (select json_agg(x) from (
                   select o.offer_no, o.product_name, o.total_excl_vat, o.created_at::date as created, '/offers/calc/' || o.id as link
                     from calc_offers o where o.client_id = c.id order by o.created_at desc limit 10) x),
       'recipes', (select json_agg(json_build_object('code', f.code, 'name', f.name, 'format', f.product_format, 'link', '/formulas/' || f.id))
                     from formulas f where f.client_id = c.id),
       'recent_activities', (select json_agg(x) from (
                   select v.type, v.subject, left(v.body, 300) as text, v.created_at::date as created, v.due_at::date as due, v.done_at is not null as done
                     from activities v where v.client_id = c.id order by v.created_at desc limit 10) x),
       'open_conversations', (select json_agg(x) from (
                   select t.status, (select o.code from sales_orders o where o.id = t.order_id) as order_code, t.last_at,
                          (select left(m.body, 300) from client_messages m where m.client_id = t.client_id and m.order_id is not distinct from t.order_id
                            order by m.created_at desc limit 1) as last_message
                     from client_threads t where t.client_id = c.id and t.status <> 'solved') x),
       'reorder_expected', (select json_build_object('usual_gap_days', r.usual_gap, 'last_order', r.last_order, 'expected_on', r.expected_on)
                     from clients_reorder_due r where r.client_id = c.id)
     ) as overview from c`, [term(a)]],

  list_orders: (a) => [
    `select o.code, o.status, o.client, o.total_packs, o.requested_date::text, o.created_at::date::text as created, t.gross as total_with_vat, '/orders/' || o.id as link
       from sales_order_overview o cross join lateral order_totals(o.id) t
      where ($1 = '' or o.code ilike '%' || $1 || '%' or ${smart("o.client")}) and ($2 = '' or o.status::text = $2)
      order by o.code desc limit ${LIMIT}`, [term(a), a.status ?? ""]],

  order_details: (a) => [
    `select so.code, so.status, c.legal_name as client, so.currency, so.vat_pct, so.deposit_pct, so.deposit_amount, so.deposit_received_on::text,
            so.balance_terms, so.balance_received_on::text, so.requested_date::text, so.customer_ref, so.notes, t.net as total_net, t.gross as total_with_vat,
            '/orders/' || so.id as link, '/clients/' || so.client_id as client_link,
            (select json_agg(json_build_object('purpose', i.purpose, 'number', i.number, 'status', i.status, 'total', i.total, 'link', '/invoices/' || i.id))
               from invoices i where i.order_id = so.id) as invoices,
            -- Pages to act on the order; an invoice link opens the invoice, or one click there makes its draft
            json_strip_nulls(json_build_object(
              'proforma', '/orders/' || so.id || '/proforma',
              'final_proforma', case when two.v and order_production_done(so.id) then '/orders/' || so.id || '/proforma?final=1' end,
              'advance_invoice', case when two.v and so.deposit_received_on is not null and paid.v then '/orders/' || so.id || '/invoice?purpose=advance' end,
              'final_invoice', case when two.v and so.balance_received_on is not null and paid.v then '/orders/' || so.id || '/invoice?purpose=final' end,
              'invoice', case when not two.v and paid.v then '/orders/' || so.id || '/invoice?purpose=full' end,
              'payments_and_tasks', '/orders/' || so.id,
              'dispatch', case when so.status = 'ready' then '/orders/' || so.id || '#dispatch-h' end)) as links,
            (select json_agg(json_build_object('product', coalesce(l.description, f.name), 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.sort_order)
               from sales_order_lines l left join formula_versions v on v.id = l.formula_version_id left join formulas f on f.id = v.formula_id
              where l.order_id = so.id) as lines,
            (select json_agg(json_build_object('code', m.code, 'status', m.status, 'quantity', m.quantity, 'produced', m.produced_quantity, 'planned', m.planned_date,
                    'date_state', m.date_state, 'link', '/production/' || m.id) order by m.code)
               from manufacturing_orders m join sales_order_lines l on l.id = m.sales_order_line_id where l.order_id = so.id) as batches,
            (select json_agg(json_build_object('title', coalesce(k.title_en, k.title), 'status', k.status,
                    'assignee', (select full_name from profiles where id = k.assignee_id)) order by k.position)
               from order_tasks k join order_task_boards b on b.id = k.board_id where b.sales_order_id = so.id and k.status <> 'done') as open_tasks,
            (select json_agg(json_build_object('code', d.code, 'on', d.dispatched_on, 'carrier', d.carrier, 'tracking', d.tracking))
               from dispatches d where d.order_id = so.id) as dispatches,
            (select json_build_object('status', oc.status, 'number', oc.number) from order_contracts oc
              where oc.order_id = so.id and oc.status <> 'cancelled' order by oc.created_at desc limit 1) as contract
       from sales_orders so join clients c on c.id = so.client_id
       cross join lateral order_totals(so.id) t
       cross join lateral (select order_paid_in_two(so.id) as v) two
       cross join lateral (select so.status not in ('draft', 'unpaid', 'cancelled') as v) paid
      where so.code = $1`, [code(a)]],

  list_offers: (a) => [
    `select o.offer_no, coalesce(nullif(o.company_name, ''), o.receiver_name) as client, o.product_name, o.product_type, o.total_excl_vat,
            o.created_at::date::text as created, (select full_name from profiles where id = o.created_by) as made_by,
            '/offers/calc/' || o.id as link
       from calc_offers o
      where $1 = '' or o.offer_no ilike '%' || $1 || '%' or ${smart("concat_ws(' ', o.company_name, o.receiver_name, o.product_name)")}
      order by o.created_at desc limit ${LIMIT}`, [term(a)]],

  offer_details: (a) => [
    `select o.offer_no, o.company_name, o.receiver_name, o.receiver_email, o.product_name, o.product_type, o.total_excl_vat, o.total_incl_vat,
            o.created_at::date::text as created, '/offers/calc/' || o.id as link, left(o.data::text, 6000) as offer_data, left(o.results::text, 4000) as calculated
       from calc_offers o where o.offer_no ilike $1 limit 1`, [(a.code ?? "").trim()]],

  find_stock: (a) => [
    `select i.sku, i.name, i.name_bg, s.on_hand, s.reserved, s.available, s.quarantine, s.incoming, s.next_expected_on::text, s.base_unit, '/inventory/items/' || i.id as link
       from item_stock_summary s join items i on i.id = s.item_id
      where $1 = '' or i.sku ilike '%' || $1 || '%' or ${smart("concat_ws(' ', i.name, i.name_bg)")}
      order by ${fit("concat_ws(' ', i.name, i.name_bg)")}, i.name limit ${LIMIT}`, [term(a)]],

  item_overview: (a) => [
    `with i as (
       select * from items where sku ilike $1 or ${smart("concat_ws(' ', name, name_bg)")}
        order by (sku ilike $1) desc, ${fit("concat_ws(' ', name, name_bg)")} limit 1)
     select json_build_object(
       'item', json_build_object('sku', i.sku, 'name', i.name, 'name_bg', i.name_bg, 'type', i.type, 'unit', i.base_unit,
                 'novel_food_status', i.novel_food_status, 'shelf_life_months', i.shelf_life_months, 'link', '/inventory/items/' || i.id),
       'stock', (select json_build_object('on_hand', s.on_hand, 'reserved', s.reserved, 'available', s.available, 'quarantine', s.quarantine,
                 'incoming', s.incoming, 'next_expected_on', s.next_expected_on) from item_stock_summary s where s.item_id = i.id),
       'lots_in_stock', (select json_agg(x order by x.expires_on nulls last) from (
                 select lo.lot_number, lo.supplier_lot, lo.qc_status, lo.expires_on, loc.code as warehouse, b.quantity
                   from stock_balances b join lots lo on lo.id = b.lot_id join locations loc on loc.id = b.location_id
                  where b.item_id = i.id and b.quantity > 0) x),
       'reserved_for', (select json_agg(json_build_object('batch', m.code, 'quantity', r.quantity))
                   from stock_reservations r left join manufacturing_orders m on m.id = r.manufacturing_order_id
                  where r.item_id = i.id and r.status = 'active'),
       'expected_deliveries', (select json_agg(json_build_object('code', d.code, 'remaining', d.remaining, 'expected_on', d.expected_on, 'overdue', d.is_overdue,
                   'supplier', (select name from suppliers where id = d.supplier_id)))
                   from expected_delivery_overview d where d.item_id = i.id and d.status = 'open'),
       'open_purchase_requests', (select json_agg(json_build_object('code', p.code, 'quantity', p.quantity, 'needed_by', p.needed_by, 'status', p.status))
                   from purchase_requests p where p.item_id = i.id and p.status in ('open', 'ordered')),
       'used_in_recipes', (select json_agg(distinct jsonb_build_object('code', f.code, 'name', f.name))
                   from formula_lines l join formula_versions v on v.id = l.version_id join formulas f on f.id = v.formula_id
                  where l.item_id = i.id and f.is_active)
     ) as overview from i`, [term(a)]],

  expiring_lots: () => [
    `select lot_number, sku, item_name, days_left, expires_on::text, quantity, qc_status from expiring_lots order by days_left limit ${LIMIT}`, []],

  find_recipes: (a) => [
    `select f.code, f.name, f.name_bg, f.product_format, f.is_active, c.legal_name as client, '/formulas/' || f.id as link,
            (select v.status from formula_versions v where v.formula_id = f.id order by v.version desc limit 1) as latest_status
       from formulas f left join clients c on c.id = f.client_id
      where $1 = '' or f.code ilike '%' || $1 || '%' or ${smart("concat_ws(' ', f.name, f.name_bg)")}
      order by ${fit("concat_ws(' ', f.name, f.name_bg)")}, f.code desc limit ${LIMIT}`, [term(a)]],

  recipe_details: (a) => [
    `select f.code, f.name, v.version, v.status, f.product_format, f.serving_size, f.serving_unit, f.servings_per_pack, '/formulas/' || f.id as link,
            (select json_agg(json_build_object('ingredient', d.name, 'amount', d.amount, 'unit', d.unit) order by d.sort_order, d.name)
               from formula_line_details d where d.version_id = v.id) as lines
       from formulas f join formula_versions v on v.formula_id = f.id
      where f.code = $1 order by v.version desc limit 1`, [code(a)]],

  find_invoices: (a) => [
    `select i.number, i.kind, i.status, i.buyer ->> 'name' as client, so.code as order_code, i.issue_date::text, i.due_date::text, i.total, i.currency, '/invoices/' || i.id as link,
            case when i.status = 'issued' and i.kind = 'invoice' then invoice_open_amount(i.id) end as left_to_pay
       from invoices i left join sales_orders so on so.id = i.order_id
      where $1 = '' or i.number ilike '%' || $1 || '%' or so.code ilike '%' || $1 || '%' or ${smart("i.buyer ->> 'name'")}
      order by i.created_at desc limit ${LIMIT}`, [term(a)]],

  receivables: () => [
    `select json_build_object(
       'open_invoices', (select json_agg(x order by x.due_date) from (
           select i.number, i.buyer ->> 'name' as client, i.issue_date, i.due_date, i.currency, i.total, invoice_open_amount(i.id) as left_to_pay,
                  greatest(current_date - i.due_date, 0) as days_overdue, '/invoices/' || i.id as link
             from invoices i where i.status = 'issued' and i.kind = 'invoice' and invoice_open_amount(i.id) > 0) x),
       'orders_waiting_advance', (select json_agg(x order by x.created) from (
           select o.code, c.legal_name as client, o.created_at::date as created, t.gross as total_with_vat, o.deposit_amount, '/orders/' || o.id as link
             from sales_orders o join clients c on c.id = o.client_id cross join lateral order_totals(o.id) t
            where o.status = 'unpaid') x),
       'orders_waiting_balance', (select json_agg(x order by x.code) from (
           select o.code, c.legal_name as client, o.status, t.gross as total_with_vat, o.deposit_received_on, '/orders/' || o.id as link
             from sales_orders o join clients c on c.id = o.client_id cross join lateral order_totals(o.id) t
            where o.status in ('confirmed', 'in_production', 'ready') and o.balance_received_on is null and order_paid_in_two(o.id)) x)
     ) as receivables`, []],

  production_details: (a) => [
    `select m.code, m.status, m.quantity, m.produced_quantity, m.planned_date::text, m.date_state, m.proposed_date::text, m.produced_on::text, m.batch_number,
            f.code as recipe, f.name as product, so.code as sales_order, c.legal_name as client, '/production/' || m.id as link,
            (select json_build_object('lot', lo.lot_number, 'qc_status', lo.qc_status, 'expires_on', lo.expires_on) from lots lo where lo.id = m.finished_lot_id) as finished_lot
       from manufacturing_orders m
       left join formula_versions v on v.id = m.formula_version_id left join formulas f on f.id = v.formula_id
       left join sales_order_lines l on l.id = m.sales_order_line_id left join sales_orders so on so.id = l.order_id
       left join clients c on c.id = so.client_id
      where m.code = $1 or m.batch_number = $1`, [code(a)]],

  production_schedule: (a) => {
    const from = isoDate(a.from, today());
    const to = isoDate(a.to, addDays(from, 30));
    return [
      `select m.code, m.status, m.planned_date::text, m.date_state, m.proposed_date::text, m.quantity, f.name as product, so.code as sales_order,
              c.legal_name as client, '/production/' || m.id as link
         from manufacturing_orders m
         left join formula_versions v on v.id = m.formula_version_id left join formulas f on f.id = v.formula_id
         left join sales_order_lines l on l.id = m.sales_order_line_id left join sales_orders so on so.id = l.order_id
         left join clients c on c.id = so.client_id
        where m.status in ('scheduled', 'released', 'in_production') and (m.planned_date is null or m.planned_date between $1::date and $2::date)
        order by m.planned_date nulls last, m.code limit 60`, [from, to]];
  },

  purchasing_status: () => [
    `select json_build_object(
       'missing_materials', (select json_agg(x order by x.needed_by nulls last) from (
           select s.request_code, s.sku, s.name, s.quantity, s.base_unit, s.needed_by, s.available, s.incoming, s.supplier from purchase_shortages s limit 40) x),
       'open_requests', (select json_agg(x order by x.needed_by nulls last) from (
           select p.code, i.sku, i.name, p.quantity, p.needed_by, p.status from purchase_requests p join items i on i.id = p.item_id
            where p.status in ('open', 'ordered') limit 40) x),
       'expected_deliveries', (select json_agg(x order by x.expected_on) from (
           select d.code, i.sku, i.name, d.remaining, d.expected_on, d.is_overdue as overdue, d.is_partial as partial, s.name as supplier
             from expected_delivery_overview d join items i on i.id = d.item_id left join suppliers s on s.id = d.supplier_id
            where d.status = 'open' limit 40) x),
       'purchase_orders', (select json_agg(x order by x.order_date desc) from (
           select po.code, s.name as supplier, po.status, po.order_date, po.expected_on from purchase_orders po join suppliers s on s.id = po.supplier_id
            where po.status <> 'cancelled' order by po.order_date desc limit 15) x)
     ) as purchasing`, []],

  find_suppliers: (a) => [
    `select s.name, s.country_code, s.is_approved, s.contact_name, s.email, s.phone, s.website, left(s.notes, 300) as notes,
            (select json_agg(distinct i.name) from supplier_items si join items i on i.id = si.item_id where si.supplier_id = s.id) as supplies
       from suppliers s
      where s.is_active and ($1 = '' or ${smart("s.name")}
             or exists (select 1 from supplier_items si join items i on i.id = si.item_id
                         where si.supplier_id = s.id and ${smart("concat_ws(' ', i.name, i.name_bg)")}))
      order by s.name limit ${LIMIT}`, [term(a)]],

  find_lots: (a) => ["select lot_number, supplier_lot, sku, name, qc_status, expires_on::text from trace_find_lots($1) limit 25", [term(a)]],

  find_materials: (a) => ["select * from recipe_materials($1)", [term(a)]],

  eu_health_claims: (a) => [
    `select code, substance, claim, conditions, restrictions, status, claim_type, (select downloaded_on::text from eu_lists_info limit 1) as list_date
       from eu_health_claims where status = $2 and (substance ilike '%' || $1 || '%' or claim ilike '%' || $1 || '%' or ${smart("substance")})
      order by substance limit 30`, [term(a), a.status || "authorised"]],

  eu_novel_food_status: (a) => [
    `select code, name, synonyms, common_names, parts, description, (select downloaded_on::text from eu_lists_info limit 1) as list_date
       from eu_novel_food_status
      where name ilike '%' || $1 || '%' or synonyms ilike '%' || $1 || '%' or common_names ilike '%' || $1 || '%' or ${smart("name")}
      order by name limit 15`, [term(a)]],

  client_messages_waiting: () => [
    `select c.legal_name as client, (select o.code from sales_orders o where o.id = t.order_id) as order_code, t.status,
            (select full_name from profiles where id = t.assigned_to) as responsible, t.last_at::text,
            (select left(m.body, 400) from client_messages m where m.client_id = t.client_id and m.order_id is not distinct from t.order_id
              order by m.created_at desc limit 1) as last_message,
            (select count(*) from client_messages m where m.client_id = t.client_id and m.order_id is not distinct from t.order_id
              and m.from_client and m.read_at is null) as unread,
            '/client-messages' as link
       from client_threads t join clients c on c.id = t.client_id
      where t.status <> 'solved' order by t.last_at desc limit ${LIMIT}`, []],

  search_team_chat: (a) => [
    `select ch.name as channel, ch.kind, p.full_name as author, left(m.body, 500) as text, m.created_at::text as at,
            '/chat?c=' || m.channel_id || coalesce('&t=' || m.parent_id, '') as link
       from chat_messages m join chat_channels ch on ch.id = m.channel_id left join profiles p on p.id = m.author_id
      where m.body ilike '%' || $1 || '%' or ${smart("m.body")}
      order by m.created_at desc limit 20`, [term(a)]],

  find_anything: (a) => [
    `select * from (
       select 'client' as kind, code, legal_name as name, '/clients/' || id as link, ${fit("concat_ws(' ', legal_name, trade_name)").replace(" desc", "")} as score
         from clients where code ilike '%' || $1 || '%' or ${smart("concat_ws(' ', legal_name, trade_name)")}
       union all
       select 'item', sku, name, '/inventory/items/' || id, ${fit("concat_ws(' ', name, name_bg)").replace(" desc", "")}
         from items where sku ilike '%' || $1 || '%' or ${smart("concat_ws(' ', name, name_bg)")}
       union all
       select 'recipe', code, name, '/formulas/' || id, ${fit("concat_ws(' ', name, name_bg)").replace(" desc", "")}
         from formulas where code ilike '%' || $1 || '%' or ${smart("concat_ws(' ', name, name_bg)")}
       union all
       select 'catalog product', code, name, '/catalog/' || id, ${fit("concat_ws(' ', name, name_bg)").replace(" desc", "")}
         from catalog_products where code ilike '%' || $1 || '%' or ${smart("concat_ws(' ', name, name_bg)")}
       union all
       select 'order', code, client, '/orders/' || id, case when code ilike '%' || $1 || '%' then 1 else ${fit("client").replace(" desc", "")} end
         from sales_order_overview where code ilike '%' || $1 || '%' or ${smart("client")}
       union all
       select 'offer', offer_no, concat_ws(' · ', company_name, product_name), '/offers/calc/' || id,
              case when offer_no ilike '%' || $1 || '%' then 1 else ${fit("concat_ws(' ', company_name, receiver_name, product_name)").replace(" desc", "")} end
         from calc_offers where offer_no ilike '%' || $1 || '%' or ${smart("concat_ws(' ', company_name, receiver_name, product_name)")}
       union all
       select 'batch', code, coalesce(batch_number, ''), '/production/' || id, 1
         from manufacturing_orders where code ilike '%' || $1 || '%' or batch_number ilike '%' || $1 || '%'
       union all
       select 'project', code, name, '/clients/' || client_id, ${fit("name").replace(" desc", "")}
         from projects where code ilike '%' || $1 || '%' or ${smart("name")}
     ) x order by score desc, code limit 30`, [term(a)]],

  recent_changes: (a) => [
    `select l.table_name, l.action, l.changed_at::text as at, p.full_name as by,
            coalesce(l.new_data ->> 'code', l.new_data ->> 'number', l.new_data ->> 'name', l.new_data ->> 'lot_number',
                     l.old_data ->> 'code', l.old_data ->> 'number', l.old_data ->> 'name', l.row_id) as record
       from audit_log l left join profiles p on p.id = l.changed_by
      where l.changed_at >= now() - make_interval(days => $1) and ($2 = '' or l.table_name = $2)
      order by l.changed_at desc limit 40`, [Math.min(Math.max(Number(a.days) || 1, 1), 30), (a.status ?? "").trim()]],

  sales_figures: (a) => {
    const to = isoDate(a.to, today());
    const from = isoDate(a.from, to.slice(0, 8) + "01");
    return ["select admin_dashboard($1::date, $2::date) as figures", [from, to]];
  },

  catalog_enquiries: () => [
    `select e.number, e.company, e.contact_name, e.email, e.country_code, e.status, e.created_at::date::text as created, left(e.message, 300) as message,
            (select json_agg(json_build_object('product', l.product_code, 'quantity', l.quantity)) from catalog_enquiry_lines l where l.enquiry_id = e.id) as products,
            '/catalog/enquiries' as link
       from catalog_enquiries e where e.status = 'new' order by e.created_at desc limit ${LIMIT}`, []],

  mail_waiting_reply: () => [
    `select client, from_address, subject, snippet, sent_at::text from emails_waiting_reply order by sent_at limit ${LIMIT}`, []],

  search_client_mail: (a) => [
    `select c.legal_name as client, c.code as client_code, e.direction, e.from_address, e.to_addresses, e.subject,
            left(e.body, 1500) as body, e.has_attachments, e.sent_at::text
       from client_emails e join clients c on c.id = e.client_id
      where c.code ilike $1 or e.from_address ilike '%' || $1 || '%' or e.subject ilike '%' || $1 || '%' or e.body ilike '%' || $1 || '%'
         or ${smart("concat_ws(' ', c.legal_name, c.trade_name)")}
      order by e.sent_at desc limit 20`, [term(a)]],
};

/** What needs attention across the company now: each part read on its own, so one the role may not read is just left out. */
export const OVERVIEW: Record<string, string> = {
  open_orders_by_status: `select status, count(*) as orders from sales_orders where status not in ('closed', 'cancelled', 'draft') group by status`,
  waiting_for_advance_payment: `select o.code, c.legal_name as client, o.created_at::date as created, '/orders/' || o.id as link
      from sales_orders o join clients c on c.id = o.client_id where o.status = 'unpaid' order by o.created_at limit 10`,
  ready_to_dispatch: `select o.code, c.legal_name as client, '/orders/' || o.id as link
      from sales_orders o join clients c on c.id = o.client_id where o.status = 'ready' order by o.code limit 10`,
  batches_next_14_days: `select m.code, m.status, m.planned_date, m.date_state, m.quantity, f.name as product, '/production/' || m.id as link
      from manufacturing_orders m left join formula_versions v on v.id = m.formula_version_id left join formulas f on f.id = v.formula_id
     where m.status in ('scheduled', 'released', 'in_production') and m.planned_date <= current_date + 14 order by m.planned_date limit 15`,
  dates_proposed_by_partner: `select m.code, m.planned_date, m.proposed_date, m.date_note, '/production/calendar' as link
      from manufacturing_orders m where m.date_state = 'proposed' and m.status not in ('completed', 'cancelled') limit 10`,
  finished_batches_waiting_release: `select m.code, lo.lot_number, m.produced_on, '/production/' || m.id as link
      from manufacturing_orders m join lots lo on lo.id = m.finished_lot_id where lo.qc_status = 'quarantine' limit 10`,
  overdue_invoices: `select i.number, i.buyer ->> 'name' as client, i.due_date, invoice_open_amount(i.id) as left_to_pay, i.currency, '/invoices/' || i.id as link
      from invoices i where i.status = 'issued' and i.kind = 'invoice' and i.due_date < current_date and invoice_open_amount(i.id) > 0 order by i.due_date limit 10`,
  missing_materials: `select s.sku, s.name, s.quantity, s.base_unit, s.needed_by, s.supplier from purchase_shortages s order by s.needed_by nulls last limit 10`,
  late_deliveries: `select d.code, i.name, d.remaining, d.expected_on, s.name as supplier from expected_delivery_overview d join items i on i.id = d.item_id
      left join suppliers s on s.id = d.supplier_id where d.status = 'open' and d.is_overdue order by d.expected_on limit 10`,
  lots_expiring_in_60_days: `select lot_number, item_name, expires_on, days_left, quantity from expiring_lots where days_left <= 60 order by days_left limit 10`,
  blocked_or_quarantined_material: `select lo.lot_number, i.name, lo.qc_status from lots lo join items i on i.id = lo.item_id
      where lo.qc_status <> 'released' and i.type <> 'finished_good' and exists (select 1 from stock_balances b where b.lot_id = lo.id and b.quantity > 0) limit 10`,
  client_messages_unread: `select c.legal_name as client, count(*) as unread, max(m.created_at)::date as last, '/client-messages' as link
      from client_messages m join clients c on c.id = m.client_id where m.from_client and m.read_at is null group by c.legal_name order by max(m.created_at) desc limit 10`,
  label_approvals_pending: `select o.code as order_code, a.status, a.requested_at::date as since, '/orders/' || o.id as link
      from label_approvals a join sales_orders o on o.id = a.order_id where a.status in ('pending', 'changes') limit 10`,
  reorder_requests: `select c.legal_name as client, r.asked_at::date as asked, '/orders/' || r.source_order_id as link
      from client_reorders r join clients c on c.id = r.client_id where r.status = 'new' limit 10`,
  new_catalog_enquiries: `select number, company, country_code, created_at::date as created, '/catalog/enquiries' as link from catalog_enquiries where status = 'new' order by created_at desc limit 10`,
  offers_without_answer: `select offer_no, client, product_name, created_at::date as created, '/offers/calc/' || id as link from offers_waiting order by created_at limit 10`,
  clients_due_to_reorder: `select client, last_order, usual_gap as usual_gap_days, expected_on, '/clients/' || client_id as link
      from clients_reorder_due where expected_on <= current_date + 21 order by expected_on limit 10`,
  contracts_waiting: `select o.code as order_code, oc.status, oc.sent_at::date as sent, '/orders/' || o.id as link
      from order_contracts oc join sales_orders o on o.id = oc.order_id where oc.status in ('sent', 'accepted') limit 10`,
};

/** The day of the person asking: their cards, order tasks, CRM to-dos and unread notifications. */
export const MY_DAY: Record<string, string> = {
  my_board_cards: `select c.title, c.due_on, b.name as board, (c.due_on < current_date) as overdue, '/boards/' || c.board_id || '?card=' || c.id as link
      from board_cards c join board_card_members m on m.card_id = c.id and m.user_id = auth.uid() join boards b on b.id = c.board_id
     where c.done_at is null and c.archived_at is null order by c.due_on nulls last limit 20`,
  my_order_tasks: `select coalesce(k.title_en, k.title) as task, k.title as task_bg, k.status, so.code as order_code, '/orders/' || so.id as link
      from order_tasks k join order_task_boards tb on tb.id = k.board_id join sales_orders so on so.id = tb.sales_order_id
     where k.assignee_id = auth.uid() and k.status <> 'done' and so.status not in ('closed', 'cancelled') order by so.code limit 20`,
  my_client_todos: `select a.type, a.subject, a.due_at::date as due, c.legal_name as client, '/clients/' || a.client_id as link
      from activities a left join clients c on c.id = a.client_id where a.assigned_to = auth.uid() and a.done_at is null order by a.due_at nulls last limit 15`,
  my_unread_notifications: `select kind, params, link, created_at::date as at from notifications where user_id = auth.uid() and read_at is null order by created_at desc limit 15`,
  my_clients_waiting: `select c.legal_name as client, count(*) as unread_messages from client_messages m join clients c on c.id = m.client_id
     where m.from_client and m.read_at is null and c.owner_id = auth.uid() group by c.legal_name limit 10`,
};
