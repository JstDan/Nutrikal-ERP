import type { Metadata } from "next";
import { headers } from "next/headers";
import { qPublic } from "@/lib/db/engine";
import { aiConfigured } from "@/lib/ai/gateway";
import type { AnyLocale } from "@/lib/i18n";
import { PUBLIC_LOCALES, publicDict } from "@/lib/i18n/public";
import { CatalogBrowser, type PublicCatalog } from "@/components/catalog-browser";
import { CatalogCompany, CatalogOptions, CatalogProcess } from "@/components/catalog-sections";

export const metadata: Metadata = {
  title: "Nutrikal Catalog",
  description: "Ready food supplement formulas for private label",
};

/** The open catalogue: no sign-in, and all it can read is catalog_public(). */
export default async function PublicCatalogPage() {
  const h = await headers();
  const lang = h.get("x-nk-locale");
  const locale = PUBLIC_LOCALES.find((l) => l.code === lang)?.code ?? ("en" as AnyLocale);
  const [row] = await qPublic<{ data: PublicCatalog }>("select catalog_public() as data");
  const t = publicDict(locale);
  return (
    <CatalogBrowser ai={aiConfigured()} languages={PUBLIC_LOCALES} data={row.data} locale={locale} text={t.text} formats={t.formats} categories={t.categories}>
      <CatalogProcess text={t.text} />
      <CatalogOptions text={t.text} ingredients={row.data.ingredient_list} />
      <CatalogCompany text={t.text} locale={locale} />
    </CatalogBrowser>
  );
}
