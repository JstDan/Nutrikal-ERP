import type { Metadata } from "next";
import { headers } from "next/headers";
import { qPublic } from "@/lib/db/engine";
import { getDict, isLocale, type Locale } from "@/lib/i18n";
import { CatalogBrowser, type PublicCatalog } from "@/components/catalog-browser";
import { CatalogCompany } from "@/components/catalog-sections";

export const metadata: Metadata = {
  title: "Nutrikal Catalogue",
  description: "Ready food supplement formulas for private label",
};

/** The open catalogue: no sign-in, and all it can read is catalog_public(). */
export default async function PublicCatalogPage() {
  const h = await headers();
  const lang = h.get("x-nk-locale");
  const locale: Locale = isLocale(lang) ? lang : "en";
  const [row] = await qPublic<{ data: PublicCatalog }>("select catalog_public() as data");
  const t = getDict(locale);
  return (
    <CatalogBrowser data={row.data} locale={locale} text={t.publicCatalog} formats={t.enums.productFormat}>
      <CatalogCompany text={t.publicCatalog} locale={locale} />
    </CatalogBrowser>
  );
}
