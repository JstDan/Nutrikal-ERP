"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { syncCatalog } from "@/app/calculator/actions";
import { extractSheetId } from "@/lib/calculator/materialImport";
import { matchesQuery } from "@/lib/calculator/search";
import type { CatalogProduct, CatalogSyncRun, Settings } from "@/lib/calculator/types";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import { Chip, Empty } from "@/components/ui";
import { CalcTextProvider, Field, Notice, Toast, Toggle, inputClass, useCalcText, useToast, type CalcDict } from "./kit";

type Props = {
  t: CalcDict;
  locale: Locale;
  /** All catalog products, removed ones included. */
  products: CatalogProduct[];
  settings: Settings;
  lastSync: CatalogSyncRun | null;
  isAdmin: boolean;
};

/** Third calculator tab: the catalog products from the catalog Google Sheet and their own sync. */
export function CatalogView(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <Catalog {...props} />
    </CalcTextProvider>
  );
}

const GRID = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.2fr)_120px]";

function Catalog({ products, settings, lastSync, isAdmin }: Props) {
  const { t, eur, num } = useCalcText();
  const c = t.catalogTab;
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const { toast, show, clear } = useToast();

  const filtered = useMemo(
    () => products.filter((p) => (showInactive || p.active) && matchesQuery(`${p.code} ${p.name} ${p.category ?? ""}`, query)),
    [products, showInactive, query],
  );

  return (
    <div className="flex flex-col gap-5">
      <CatalogSyncCard settings={settings} lastSync={lastSync} onDone={(ok, message) => show(ok ? "success" : "error", message)} />
      <Notice>{c.managedInSheet}</Notice>

      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-[1_1_280px]">
          <label htmlFor="catalog-filter" className="sr-only">{c.search}</label>
          <input id="catalog-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c.search} className="input" />
        </div>
        <Toggle checked={showInactive} onChange={setShowInactive}>{c.showInactive}</Toggle>
        <span className="text-sm text-ink-2">{fmt(c.count, { n: products.filter((p) => p.active).length })}</span>
      </div>

      <section aria-label={c.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm ${GRID} border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
          <span>{t.catalog.code}</span>
          <span>{c.name}</span>
          <span>{t.catalog.steps}</span>
          <span>{c.status}</span>
        </div>
        {filtered.length === 0 && <div className="py-4"><Empty>{products.length ? t.catalog.noResults : t.catalog.empty}</Empty></div>}
        {filtered.map((p) => (
          <div key={p.id} className={`row ${GRID} border-b border-mist py-3 text-sm last:border-0`}>
            <div className="min-w-0 md:contents">
              <span className="font-semibold">{p.code}</span>
              <span className={`block min-w-0 break-words md:inline ${p.active ? "" : "text-ink-2"}`}>
                {p.name}
                {p.category && <span className="block text-xs text-ink-2">{p.category}</span>}
              </span>
            </div>
            <span className="col-span-2 min-w-0 text-ink-2 tabular-nums md:col-span-1 md:text-ink">
              {p.tiers.map((x) => `${fmt(t.catalog.fromQty, { n: num(x.min_qty) })} ${eur(x.price)}`).join(" · ")}
            </span>
            <span className="col-start-2 row-start-1 md:col-start-4">
              {p.active ? <Chip tone="green">{c.statusActive}</Chip> : <Chip>{c.statusRemoved}</Chip>}
            </span>
          </div>
        ))}
      </section>
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}

function CatalogSyncCard({ settings, lastSync, onDone }: {
  settings: Settings; lastSync: CatalogSyncRun | null; onDone: (ok: boolean, message: string) => void;
}) {
  const { t, locale } = useCalcText();
  const c = t.catalogTab;
  const s = t.sync;
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const fileId = extractSheetId(settings.catalog_sheet_url);
  const when = (iso: string) => formatDate(locale, iso, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const sync = async () => {
    setSyncing(true);
    const res = await syncCatalog();
    setSyncing(false);
    if (!res.ok) return onDone(false, `${s.failed}: ${res.error}`);
    const run = res.data;
    if (run.status === "success") onDone(true, fmt(c.okShort, { added: run.added, changed: run.changed, removed: run.removed }));
    else onDone(false, `${s.failed}: ${run.error ?? ""}`);
    router.refresh();
  };

  return (
    <section aria-labelledby="catalog-sync-title" className="card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <h2 id="catalog-sync-title" className="m-0 text-lg font-bold">{c.syncTitle}</h2>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">{c.syncHint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {fileId && (
            <a href={settings.catalog_sheet_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
              {s.openSheet} <span aria-hidden="true">↗</span>
            </a>
          )}
          <button type="button" onClick={sync} disabled={syncing || !fileId} className="btn btn-primary">
            {syncing ? s.syncing : s.syncNow}
          </button>
        </div>
      </div>
      {!lastSync ? (
        <p className="m-0 text-sm text-ink-2">{s.never}</p>
      ) : lastSync.status === "success" ? (
        <Notice tone="success">
          <b>{s.last}: {when(lastSync.created_at)} ({s[`source_${lastSync.source}`]})</b>
          <br />
          {fmt(c.ok, { added: lastSync.added, changed: lastSync.changed, unchanged: lastSync.unchanged })}
          {lastSync.removed > 0 && <><br />{fmt(c.removed, { n: lastSync.removed })}</>}
        </Notice>
      ) : (
        <Notice tone="error">
          <b>{s.failed}: {when(lastSync.created_at)} ({s[`source_${lastSync.source}`]})</b>
          <br />
          {lastSync.error}
        </Notice>
      )}
    </section>
  );
}
