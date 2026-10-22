export type ProductType = 'capsules_glass' | 'capsules_plastic' | 'powder';
export const PRODUCT_TYPES: ProductType[] = ['capsules_glass', 'capsules_plastic', 'powder'];

export type DoseUnit = 'mcg' | 'mg' | 'g';
export const DOSE_UNITS: DoseUnit[] = ['mcg', 'mg', 'g'];

export type CapsuleSize = 'size1' | 'size0' | 'size00';
export const CAPSULE_SIZES: Record<CapsuleSize, number> = { size1: 400, size0: 500, size00: 730 };

export function isCapsule(type: ProductType | null | undefined): boolean {
  return type === 'capsules_glass' || type === 'capsules_plastic';
}

export interface RawMaterial {
  id: string;
  name: string;
  price_eur_per_kg: number;
  regulatory_note: string | null;
  active: boolean;
  updated_at: string;
}

export type FixedCosts = Record<ProductType, number>;

/** One quantity step of a catalog product: unit price (EUR, EXW, excl. VAT) from min_qty units up. */
export interface CatalogTier {
  min_qty: number;
  price: number;
}

/** A catalog product from the catalog Google Sheet. */
export interface CatalogProduct {
  id: string;
  code: string;
  name: string;
  category: string | null;
  /** Smallest step first. */
  tiers: CatalogTier[];
  active: boolean;
}

/** Custom formula (raw materials, packaging, markup) or a catalog product (price from the catalog). */
export type FormulaMode = 'custom' | 'catalog';

/** A ready-made extra line for offers (certificates, design services…). */
export interface ServicePreset {
  description: string;
  unit: string;
  price: number;
}

export interface Settings {
  fixed_costs: FixedCosts;
  default_markup: number;
  default_vat_rate: number;
  /** Supplier block on the PDF offer. */
  company_name: string;
  company_id: string;
  company_vat: string;
  company_address: string;
  company_email: string;
  company_phone: string;
  /** Payment block on the PDF offer. */
  bank_iban: string;
  bank_name: string;
  bank_bic: string;
  bank_address: string;
  default_payment_terms: string;
  /** Shown next to the bank details when VAT is not added. */
  vat_exemption_text: string;
  footer_text: string;
  websites: string;
  service_presets: ServicePreset[];
  logo_data_url: string | null;
  terms_text: string;
  /** Google Sheet / Drive .xlsx share link the price list is synced from. */
  google_sheet_url: string;
  /** True when the link comes from GOOGLE_SHEET_URL on the server (not editable in the app). */
  google_sheet_from_env?: boolean;
  /** Google Sheet share link the catalog products are synced from. */
  catalog_sheet_url: string;
  /** True when the link comes from GOOGLE_CATALOG_SHEET_URL on the server (not editable in the app). */
  catalog_sheet_from_env?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fixed_costs: { capsules_glass: 2.5, capsules_plastic: 2.2, powder: 2.7 },
  default_markup: 30,
  default_vat_rate: 20,
  company_name: 'Nutrikal Ltd',
  company_id: 'BG202245000',
  company_vat: 'BG202245000',
  company_address: '133 Knyaz Boriz 1 Blvd., 9000 Varna, Bulgaria',
  company_email: 'sales@nutrikal.com',
  company_phone: '',
  bank_iban: 'BG04FINV91501017654214 (EUR)',
  bank_name: 'First Investment Bank AD',
  bank_bic: 'FINVBGSF',
  bank_address: '37 Dragan Tsankov Blvd, 1797 Sofia, Bulgaria',
  default_payment_terms: '70% Down Payment and 30% Balance Payment when goods are ready to be shipped',
  vat_exemption_text: 'VAT Exemption',
  footer_text: '',
  websites: 'Nutrikal.com',
  service_presets: [
    { description: 'Free Sale Certificate', unit: 'pcs.', price: 300 },
    { description: 'Certificate of analysis', unit: 'pcs.', price: 220 },
    { description: 'Label design service', unit: 'pcs.', price: 200 },
  ],
  logo_data_url: null,
  google_sheet_url: 'https://docs.google.com/spreadsheets/d/1dfylFe0D-xWlQ1PXcVUAGtNrPNS4bGJK/edit?usp=sharing',
  catalog_sheet_url: 'https://docs.google.com/spreadsheets/d/1WE7F6aTC3jezBPPC8oEnDS_aCee1Hpd1FPthdpYdPF0/edit?gid=0#gid=0',
  terms_text:
    'The prices are EUR/EXW excl. VAT, for the finished, ready-to-sell products and include raw materials, primary packaging materials, mixing, quality assurance, encapsulation where applicable, filling, sealing, capping where applicable, label and foil printing with basic effects, label application and shipment preparation. Lead time and MOQ to be confirmed upon order. This offer is valid for 14 business days.',
};

/** Extra offer line next to the product (certificate, design service…). Numbers as typed. */
export interface ExtraItem {
  key: string;
  description: string;
  qty: string;
  unit: string;
  price: string;
}

/** Alternative price for a specific order quantity: its own markup on the unit cost. Numbers as typed. */
export interface PriceTier {
  key: string;
  qty: string;
  markup: string;
}

/** One ingredient line of the formula. Price and note are a snapshot taken when the row was added. */
export interface FormulaRow {
  key: string;
  materialId: string | null;
  name: string;
  pricePerKg: number;
  regulatoryNote: string | null;
  amount: string;
  unit: DoseUnit;
}

/** Everything the calculator form holds. Numeric inputs are kept as strings so "1,5" can be typed. */
export interface OfferForm {
  id: string | null;
  /** Older offers have no mode: custom. */
  mode: FormulaMode;
  /** Catalog mode: the chosen product – a snapshot of its code, name and prices when it was picked. */
  catalog: Omit<CatalogProduct, 'active'> | null;
  /** The CRM client the offer is for (receiver and invoice below are a snapshot of its data). Older offers: null. */
  clientId: string | null;
  /** Nutrikal contact person printed on the offer (the sales email comes from Settings). */
  contact: { name: string; phone: string };
  receiver: {
    fullName: string;
    address: string;
    city: string;
    zip: string;
    country: string;
    phone: string;
    email: string;
  };
  invoice: {
    companyName: string;
    /** Company identification no. (e.g. EIK / registration number). */
    identificationNo: string;
    registrationAddress: string;
    vatNumber: string;
  };
  offer: {
    offerNo: string;
    offerDate: string;
    validUntil: string;
    productName: string;
  };
  productType: ProductType | null;
  rows: FormulaRow[];
  capsulesPerDose: string;
  capsuleSize: CapsuleSize;
  maxFillMg: string;
  quantityPerUnit: string;
  numberOfUnits: string;
  markup: string;
  addVat: boolean;
  vatRate: string;
  /** Discount % applied to the product line only. */
  discount: string;
  extraItems: ExtraItem[];
  /** Price per unit for other order quantities. */
  priceTiers: PriceTier[];
  paymentTerms: string;
  includeComposition: boolean;
  notes: string;
  /** Fixed costs snapshot; null means "use current settings" (unsaved offers). */
  fixedCosts: FixedCosts | null;
}

export interface OfferRecord {
  id: string;
  offer_no: string;
  receiver_name: string;
  receiver_email: string;
  client_id: string | null;
  company_name: string | null;
  product_name: string | null;
  product_type: ProductType | null;
  total_excl_vat: number;
  total_incl_vat: number;
  data: OfferForm;
  results: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type OfferInput = Omit<OfferRecord, 'id' | 'created_by' | 'created_at' | 'updated_at'> & { id?: string | null };

/** One run of the Google Sheet price-list sync. */
export interface SyncRun {
  id: string;
  created_at: string;
  source: 'manual' | 'scheduled' | 'auto';
  status: 'success' | 'error';
  added: number;
  changed: number;
  unchanged: number;
  invalid: number;
  missing: number;
  /** Materials deactivated because they were removed from the sheet. */
  removed: number;
  /** Inactive materials reactivated because they are back in the sheet. */
  restored: number;
  error: string | null;
}

/** One run of the catalog sync (catalog Google Sheet → catalog products). */
export interface CatalogSyncRun {
  id: string;
  created_at: string;
  source: 'manual' | 'scheduled' | 'auto';
  status: 'success' | 'error';
  added: number;
  changed: number;
  unchanged: number;
  /** Products deactivated because they were removed from the sheet. */
  removed: number;
  error: string | null;
}
