import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { Empty, PageHeader } from "@/components/ui";

type Hit = { href: string; code: string; name: string; note: string | null };
type Group = "clients" | "projects" | "orders" | "offers" | "formulas" | "items" | "lots" | "invoices" | "production";

const LIMIT = 8;

/**
 * One search over the main records. Every query runs as the signed-in user, so each role finds only
 * what it may read; a group the role has no rights on simply stays empty.
 */
const QUERIES: Record<Group, string> = {
  clients: `select '/clients/' || c.id as href, c.code, c.legal_name as name,
                   concat_ws(' · ', c.trade_name, c.city, c.country_code) as note
              from clients c
             where c.legal_name ilike $1 or c.trade_name ilike $1 or c.code ilike $1 or c.vat_number ilike $1 or c.company_id ilike $1
             order by c.legal_name limit ${LIMIT}`,
  projects: `select '/clients/' || p.client_id as href, p.code, p.name, c.legal_name as note
               from projects p join clients c on c.id = p.client_id
              where p.name ilike $1 or p.code ilike $1
              order by p.code desc limit ${LIMIT}`,
  // The overview holds no prices, so the designer finds orders too
  orders: `select '/orders/' || o.id as href, o.code, o.client as name, null as note
             from sales_order_overview o
            where o.code ilike $1 or o.client ilike $1
            order by o.code desc limit ${LIMIT}`,
  offers: `select '/offers/calc/' || o.id as href, o.offer_no as code, coalesce(nullif(o.company_name, ''), o.receiver_name) as name, o.product_name as note
             from calc_offers o
            where o.offer_no ilike $1 or o.company_name ilike $1 or o.receiver_name ilike $1 or o.product_name ilike $1
            order by o.created_at desc limit ${LIMIT}`,
  formulas: `select '/formulas/' || f.id as href, f.code, case when $2 = 'bg' then coalesce(f.name_bg, f.name) else f.name end as name, c.legal_name as note
               from formulas f left join clients c on c.id = f.client_id
              where f.code ilike $1 or f.name ilike $1 or f.name_bg ilike $1
              order by f.code desc limit ${LIMIT}`,
  items: `select '/inventory/items/' || i.id as href, i.sku as code, case when $2 = 'bg' then coalesce(i.name_bg, i.name) else i.name end as name, null as note
            from items i
           where i.sku ilike $1 or i.name ilike $1 or i.name_bg ilike $1
           order by i.name limit ${LIMIT}`,
  lots: `select '/traceability?lot=' || l.id as href, l.lot_number as code, case when $2 = 'bg' then coalesce(i.name_bg, i.name) else i.name end as name, l.supplier_lot as note
           from lots l join items i on i.id = l.item_id
          where l.lot_number ilike $1 or l.supplier_lot ilike $1
          order by l.received_on desc limit ${LIMIT}`,
  invoices: `select '/invoices/' || v.id as href, coalesce(v.number, '—') as code, c.legal_name as name, null as note
               from invoices v join clients c on c.id = v.client_id
              where v.number ilike $1 or c.legal_name ilike $1
              order by v.created_at desc limit ${LIMIT}`,
  production: `select '/production/' || m.id as href, m.code, coalesce(f.name, '') as name, null as note
                 from manufacturing_orders m left join formula_versions fv on fv.id = m.formula_version_id left join formulas f on f.id = fv.formula_id
                where m.code ilike $1 or m.batch_number ilike $1
                order by m.code desc limit ${LIMIT}`,
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { user, t } = await requireStaff();
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const S = t.search;

  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const groups = term
    ? await Promise.all(
        (Object.keys(QUERIES) as Group[]).map(async (g) => {
          try {
            return [g, await q<Hit>(user.id, QUERIES[g], QUERIES[g].includes("$2") ? [pattern, user.locale] : [pattern])] as const;
          } catch {
            // No rights on this table for the role: nothing to show here
            return [g, [] as Hit[]] as const;
          }
        }),
      )
    : [];
  const found = groups.filter(([, hits]) => hits.length);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={S.title} subtitle={term ? fmt(S.resultsFor, { q: term }) : S.hint} />
      {term && !found.length && <Empty>{S.none}</Empty>}
      {found.map(([g, hits]) => (
        <section key={g} aria-label={S.groups[g]} className="card px-5 pt-4 pb-3">
          <h2 className="m-0 mb-1 text-sm font-semibold">{S.groups[g]}</h2>
          <ul className="m-0 list-none p-0">
            {hits.map((h) => (
              <li key={`${h.code} ${h.href}`} className="border-b border-mist last:border-0">
                <Link href={h.href} className="row min-h-11 items-center py-2 text-ink no-underline hover:bg-mist/40 grid-cols-[minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)]">
                  <span className="truncate font-semibold tabular-nums">{h.code}</span>
                  <span className="truncate">{h.name}</span>
                  <span className="hide-md truncate text-sm text-ink-2">{h.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
