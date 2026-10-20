// Data for the accountant: stock movements, production consumption, stock
// value and open deliveries. Everything is read as the signed-in user, so
// costs and suppliers appear only for users who may see purchase prices.
import { withUser } from "./db/engine";

export type MovementRow = {
  date: string; type: string; sku: string; name: string; name_bg: string | null; base_unit: string; lot_number: string;
  location: string; quantity: string; unit_cost: string | null; value: string | null; reference: string | null;
  mo_code: string | null; project_code: string | null; reason: string | null;
};
export type ConsumptionRow = {
  mo_code: string; project_code: string | null; sku: string; name: string; name_bg: string | null; base_unit: string;
  quantity: string; value: string | null; missing_cost: number;
};
export type StockRow = {
  sku: string; name: string; name_bg: string | null; base_unit: string; lot_number: string; location: string; qc_status: string;
  expires_on: string | null; quantity: string; unit_cost: string | null; value: string | null;
};
export type CommitmentRow = {
  code: string; supplier: string | null; sku: string; name: string; name_bg: string | null; base_unit: string;
  expected_on: string | null; remaining: string; unit_price: string | null; value: string | null; po_reference: string | null;
};
export type AccountingData = {
  movements: MovementRow[]; consumption: ConsumptionRow[]; stock: StockRow[]; commitments: CommitmentRow[];
  totals: { received: number; consumed: number; stock: number; commitments: number; noCost: number };
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Period from search params; default = first day of this month to today. */
export function period(sp: Record<string, string | string[] | undefined>) {
  const today = new Date().toISOString().slice(0, 10);
  const from = typeof sp.from === "string" && DATE.test(sp.from) ? sp.from : `${today.slice(0, 8)}01`;
  const to = typeof sp.to === "string" && DATE.test(sp.to) ? sp.to : today;
  return from <= to ? { from, to } : { from: to, to: from };
}

export async function loadAccounting(userId: string, from: string, to: string): Promise<AccountingData> {
  return withUser(userId, async (tx) => {
    const movements = (await tx.query<MovementRow>(
      `select m.created_at::date::text as date, m.type::text, i.sku, i.name, i.name_bg, i.base_unit::text, l.lot_number,
              loc.name as location, m.quantity::text, c.unit_cost::text, (m.quantity * c.unit_cost)::text as value,
              m.reference, mo.code as mo_code, p.code as project_code, m.reason
         from stock_movements m
         join items i on i.id = m.item_id
         join lots l on l.id = m.lot_id
         join locations loc on loc.id = m.location_id
         left join lot_costs c on c.lot_id = m.lot_id
         left join manufacturing_orders mo on mo.id = m.manufacturing_order_id
         left join projects p on p.id = m.project_id
        where m.created_at >= $1::date and m.created_at < $2::date + 1
        order by m.created_at, m.id`,
      [from, to],
    )).rows;
    const consumption = (await tx.query<ConsumptionRow>(
      `select coalesce(mo.code, m.reference, '—') as mo_code, p.code as project_code, i.sku, i.name, i.name_bg, i.base_unit::text,
              (-sum(m.quantity))::text as quantity, (-sum(m.quantity * c.unit_cost))::text as value,
              count(*) filter (where c.unit_cost is null)::int as missing_cost
         from stock_movements m
         join items i on i.id = m.item_id
         left join lot_costs c on c.lot_id = m.lot_id
         left join manufacturing_orders mo on mo.id = m.manufacturing_order_id
         left join projects p on p.id = coalesce(mo.project_id, m.project_id)
        where m.type = 'consumption' and m.created_at >= $1::date and m.created_at < $2::date + 1
        group by 1, 2, i.sku, i.name, i.name_bg, i.base_unit
        order by 1, i.name`,
      [from, to],
    )).rows;
    const stock = (await tx.query<StockRow>(
      `select i.sku, i.name, i.name_bg, i.base_unit::text, b.lot_number, loc.name as location, b.qc_status::text,
              b.expires_on::text, b.quantity::text, c.unit_cost::text, (b.quantity * c.unit_cost)::text as value
         from stock_balances b
         join items i on i.id = b.item_id
         join locations loc on loc.id = b.location_id
         left join lot_costs c on c.lot_id = b.lot_id
        where b.quantity > 0
        order by i.name, b.lot_number`,
    )).rows;
    const commitments = (await tx.query<CommitmentRow>(
      `select d.code, s.name as supplier, i.sku, i.name, i.name_bg, i.base_unit::text, d.expected_on::text,
              d.remaining::text, d.unit_price::text, (d.remaining * d.unit_price)::text as value, d.po_reference
         from expected_delivery_overview d
         join items i on i.id = d.item_id
         left join suppliers s on s.id = d.supplier_id
        where d.status = 'open'
        order by d.expected_on nulls last, d.code`,
    )).rows;

    const sum = <T>(rows: T[], f: (r: T) => string | null) => rows.reduce((a, r) => a + Number(f(r) ?? 0), 0);
    return {
      movements, consumption, stock, commitments,
      totals: {
        received: sum(movements.filter((m) => m.type === "receipt"), (m) => m.value),
        consumed: sum(consumption, (c) => c.value),
        stock: sum(stock, (s) => s.value),
        commitments: sum(commitments, (c) => c.value),
        noCost: movements.filter((m) => m.unit_cost == null).length,
      },
    };
  });
}
