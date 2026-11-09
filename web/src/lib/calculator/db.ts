// Calculator reads, always as the signed-in user (row-level security decides what comes back).
import { q } from "@/lib/db/engine";
import { countryName } from "./countries";
import { DEFAULT_SETTINGS, type CatalogProduct, type OfferRecord, type RawMaterial, type ServicePreset, type Settings } from "./types";

// Postgres numeric columns arrive as strings.
const num = (v: number | string | null | undefined) => Number(v ?? 0);

type SettingsRow = Omit<Settings, "fixed_costs" | "default_markup" | "default_vat_rate" | "service_presets" | "bulk_rate_per_1000" | "bulk_shells_per_1000" | "bulk_batch_cost"> & {
  fixed_cost_capsules_glass: number | string;
  fixed_cost_capsules_plastic: number | string;
  fixed_cost_powder: number | string;
  bulk_rate_per_1000: number | string | null;
  bulk_shells_per_1000: number | string | null;
  bulk_batch_cost: number | string | null;
  default_markup: number | string;
  default_vat_rate: number | string;
  service_presets: ServicePreset[] | null;
};

export function settingsFromRow(r: SettingsRow): Settings {
  const s = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = (r as Record<string, unknown>)[k];
    if (typeof v === "string") (s as Record<string, unknown>)[k] = v;
  }
  return {
    ...s,
    logo_data_url: r.logo_data_url ?? null,
    fixed_costs: {
      capsules_glass: num(r.fixed_cost_capsules_glass),
      capsules_plastic: num(r.fixed_cost_capsules_plastic),
      capsules_bulk: 0,
      powder: num(r.fixed_cost_powder),
    },
    bulk_rate_per_1000: num(r.bulk_rate_per_1000),
    bulk_shells_per_1000: num(r.bulk_shells_per_1000),
    bulk_batch_cost: num(r.bulk_batch_cost),
    default_markup: num(r.default_markup),
    default_vat_rate: num(r.default_vat_rate),
    service_presets: (r.service_presets ?? []).map((p) => ({ ...p, price: num(p.price) })),
  };
}

export async function loadSettings(userId: string): Promise<Settings> {
  const [row] = await q<SettingsRow>(userId, "select * from calc_settings");
  return row ? settingsFromRow(row) : DEFAULT_SETTINGS;
}

/** Catalog products in their order (active only, unless includeInactive). The calculator leaves out products without
 *  a known composition until it is filled in (owner, Oct 2026); the catalog tab lists them too (withoutComposition). */
export async function loadCatalog(userId: string, { includeInactive = false, withoutComposition = false } = {}): Promise<CatalogProduct[]> {
  const rows = await q<CatalogProduct>(
    userId,
    `select id, code, name, category, tiers, active, sort_order, capsules_per_serving, capsules_per_container,
            serving_g::float as serving_g, servings_per_container, composition from calc_catalog_products
      where (composition is not null or $2) and (active or $1) order by active desc, sort_order, code`,
    [includeInactive, withoutComposition],
  );
  return rows.map((p) => ({ ...p, tiers: p.tiers.map((x) => ({ min_qty: Number(x.min_qty), price: Number(x.price) })) }));
}

export async function loadMaterials(userId: string): Promise<RawMaterial[]> {
  const rows = await q<RawMaterial>(
    userId,
    "select id, name, price_eur_per_kg, regulatory_note, active, manual, updated_at::text from calc_raw_materials order by name",
  );
  return rows.map((m) => ({ ...m, price_eur_per_kg: num(m.price_eur_per_kg) }));
}

const OFFER_COLUMNS = `id, offer_no, receiver_name, receiver_email, client_id, company_name, product_name, product_type,
  total_excl_vat, total_incl_vat, data, results, created_by, created_at::text, updated_at::text`;

export const toOffer = (r: OfferRecord): OfferRecord => ({
  ...r,
  total_excl_vat: num(r.total_excl_vat),
  total_incl_vat: num(r.total_incl_vat),
});

export async function loadOffers(userId: string): Promise<OfferRecord[]> {
  const rows = await q<OfferRecord>(userId, `select ${OFFER_COLUMNS} from calc_offers order by created_at desc`);
  return rows.map(toOffer);
}

export async function loadOffer(userId: string, id: string): Promise<OfferRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await q<OfferRecord>(userId, `select ${OFFER_COLUMNS} from calc_offers where id = $1`, [id]);
  return row ? toOffer(row) : null;
}

/** CRM client data the calculator can copy into an offer. */
export type CrmClient = {
  id: string;
  name: string;
  companyName: string;
  identificationNo: string;
  vatNumber: string;
  address: string;
  /** Registered (invoice) address when it differs from the address. */
  registrationAddress: string;
  city: string;
  zip: string;
  country: string;
  email: string;
  phone: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

export async function loadCrmClients(userId: string): Promise<CrmClient[]> {
  const rows = await q<{
    id: string; code: string; legal_name: string; trade_name: string | null; company_id: string | null; vat_number: string | null;
    address_line1: string | null; address_line2: string | null; city: string | null; postal_code: string | null; country_code: string;
    billing_email: string | null; phone: string | null; registration_address: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  }>(
    userId,
    `select c.id, c.code, c.legal_name, c.trade_name, c.company_id, c.vat_number, c.address_line1, c.address_line2, c.city,
            c.postal_code, c.country_code, c.billing_email, c.phone, c.registration_address,
            nullif(trim(concat_ws(' ', k.first_name, k.last_name)), '') as contact_name, k.email as contact_email, k.phone as contact_phone
       from clients c
       left join lateral (
         select first_name, last_name, email, phone from contacts
          where client_id = c.id order by is_primary desc, created_at limit 1
       ) k on true
      where c.status <> 'inactive'
      order by c.legal_name`,
  );
  return rows.map((c) => ({
    id: c.id,
    name: `${c.legal_name}${c.trade_name ? ` (${c.trade_name})` : ""} · ${c.code}`,
    companyName: c.legal_name,
    identificationNo: c.company_id ?? "",
    vatNumber: c.vat_number ?? "",
    address: [c.address_line1, c.address_line2].filter(Boolean).join(", "),
    registrationAddress: c.registration_address ?? "",
    city: c.city ?? "",
    zip: c.postal_code ?? "",
    country: countryName(c.country_code),
    email: c.billing_email ?? "",
    phone: c.phone ?? "",
    contactName: c.contact_name ?? "",
    contactEmail: c.contact_email ?? "",
    contactPhone: c.contact_phone ?? "",
  }));
}
