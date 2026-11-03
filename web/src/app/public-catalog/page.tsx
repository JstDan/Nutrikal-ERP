import type { Metadata } from "next";
import { headers } from "next/headers";
import { qPublic } from "@/lib/db/engine";
import { aiConfigured } from "@/lib/ai/gateway";
import type { AnyLocale } from "@/lib/i18n";
import { PUBLIC_LOCALES, publicDict } from "@/lib/i18n/public";
import { shortCategories } from "@/lib/i18n/public-short";
import { CatalogBrowser, type PublicCatalog } from "@/components/catalog-browser";
import { PRODUCT_NAMES } from "@/lib/i18n/product-names";
import { CatalogCompany, CatalogOptions, CatalogProcess } from "@/components/catalog-sections";

const SHARE = {
  title: "Nutrikal Catalog",
  description: "Ready food supplement formulas for private label",
  images: [{ url: "/catalog/site/og-catalog.jpg", width: 1200, height: 630, alt: "Nutrikal: ready-made formulas for your own brand" }],
};

// The picture shown when the catalogue is shared (1200 × 630)
export const metadata: Metadata = {
  metadataBase: new URL(`https://${process.env.CATALOG_HOST?.trim() || "catalog.nutrikal.com"}`),
  title: SHARE.title,
  description: SHARE.description,
  openGraph: { ...SHARE, type: "website", siteName: "Nutrikal" },
  twitter: { card: "summary_large_image", ...SHARE },
};

/** The open catalogue: no sign-in, and all it can read is catalog_public(). */
export default async function PublicCatalogPage() {
  const h = await headers();
  const lang = h.get("x-nk-locale");
  const locale = PUBLIC_LOCALES.find((l) => l.code === lang)?.code ?? ("en" as AnyLocale);
  const [row] = await qPublic<{ data: PublicCatalog }>("select catalog_public() as data");
  const t = publicDict(locale);
  // Names in the visitor's language (set by Admin on the product, else product-names.ts); the English one stays searchable
  const data: PublicCatalog = locale !== "en" ? {
    ...row.data,
    products: row.data.products.map((p) => {
      const name = p.names?.[locale as "bg"]?.trim() || PRODUCT_NAMES[p.code]?.[locale as "bg"];
      return name ? { ...p, name_en: p.name, name, name_bg: name } : p;
    }),
  } : row.data;
  return (
    <CatalogBrowser ai={aiConfigured()} languages={PUBLIC_LOCALES} data={data} locale={locale} text={t.text} formats={t.formats} categories={t.categories} short={shortCategories(locale)}>
      <CatalogProcess text={t.text} />
      <CatalogOptions text={t.text} ingredients={row.data.ingredient_list} />
      <CatalogCompany text={t.text} locale={locale} />
    </CatalogBrowser>
  );
}
