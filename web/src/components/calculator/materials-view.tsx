"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveRegulatoryNote, syncPriceList } from "@/app/calculator/actions";
import { extractSheetId } from "@/lib/calculator/materialImport";
import { matchesQuery } from "@/lib/calculator/search";
import type { RawMaterial, Settings, SyncRun } from "@/lib/calculator/types";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import { Chip, Empty } from "@/components/ui";
import { CalcTextProvider, Notice, Toast, Toggle, useCalcText, useToast, type CalcDict } from "./kit";

type Props = {
  t: CalcDict;
  locale: Locale;
  materials: RawMaterial[];
  settings: Settings;
  lastSync: SyncRun | null;
  isAdmin: boolean;
};

export function MaterialsView(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <Materials {...props} />
    </CalcTextProvider>
  );
}

const GRID = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_130px_minmax(0,1.2fr)_120px]";

function Materials({ materials, settings, lastSync, isAdmin }: Props) {
  const { t, eur } = useCalcText();
  const m = t.materials;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const { toast, show, clear } = useToast();

  const filtered = useMemo(
    () => materials.filter((x) => (showInactive || x.active) && matchesQuery(x.name, query)),
    [materials, showInactive, query],
  );

  const saveNote = async (x: RawMaterial, note: string | null) => {
    const res = await saveRegulatoryNote(x.id, note);
    if (!res.ok) return show("error", res.error);
    show("success", fmt(m.noteSaved, { name: x.name }));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <SyncCard settings={settings} lastSync={lastSync} onDone={(ok, message) => show(ok ? "success" : "error", message)} />
      <Notice>{m.managedInSheet}</Notice>

      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-[1_1_280px]">
          <label htmlFor="material-filter" className="sr-only">{m.search}</label>
          <input id="material-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.search} className="input" />
        </div>
        <Toggle checked={showInactive} onChange={setShowInactive}>{m.showInactive}</Toggle>
        <span className="text-sm text-ink-2">{fmt(m.count, { n: materials.filter((x) => x.active).length })}</span>
      </div>

      <section aria-label={m.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm ${GRID} border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
          <span>{m.name}</span>
          <span className="text-right">{m.price}</span>
          <span>{m.note}</span>
          <span>{m.status}</span>
        </div>
        {filtered.length === 0 && <div className="py-4"><Empty>{t.formula.noResults}</Empty></div>}
        {filtered.map((x) => (
          <div key={x.id} className={`row ${GRID} border-b border-mist py-3 text-sm last:border-0`}>
            <span className={`min-w-0 font-medium break-words ${x.active ? "" : "text-ink-2"}`}>{x.name}</span>
            <span className="text-right tabular-nums">{eur(x.price_eur_per_kg)}</span>
            <div className="col-span-2 min-w-0 md:col-span-1">
              {isAdmin ? (
                <NoteCell material={x} label={`${m.note} – ${x.name}`} onSave={(note) => saveNote(x, note)} />
              ) : x.regulatory_note ? (
                <span className="break-words text-amber-ink">⚠ {x.regulatory_note}</span>
              ) : (
                <span className="hide-sm text-ink-2">–</span>
              )}
            </div>
            <span className="col-span-2 md:col-span-1">
              {x.active ? <Chip tone="green">{m.statusActive}</Chip> : <Chip>{m.statusRemoved}</Chip>}
              {x.manual && <span className="ml-1.5"><Chip tone="amber">{t.formula.manualChip}</Chip></span>}
            </span>
          </div>
        ))}
      </section>

      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}

/** The regulatory note is the only raw-material field editable in the app; it saves when leaving the field. */
function NoteCell({ material, label, onSave }: { material: RawMaterial; label: string; onSave: (note: string | null) => void }) {
  const current = material.regulatory_note ?? "";
  const [value, setValue] = useState(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setValue(current);
  }
  return (
    <textarea
      aria-label={label}
      rows={1}
      value={value}
      placeholder="–"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() !== current && onSave(value.trim() || null)}
      className={`input min-h-11! py-2.5! ${value ? "text-amber-ink!" : ""}`}
    />
  );
}

/** Status of the Google Sheet price-list sync with a manual "Sync" button. */
function SyncCard({ settings, lastSync, onDone }: { settings: Settings; lastSync: SyncRun | null; onDone: (ok: boolean, message: string) => void }) {
  const { t, locale } = useCalcText();
  const s = t.sync;
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const fileId = extractSheetId(settings.google_sheet_url);
  const when = (iso: string) => formatDate(locale, iso, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const sync = async () => {
    setSyncing(true);
    const res = await syncPriceList();
    setSyncing(false);
    if (!res.ok) return onDone(false, `${s.failed}: ${res.error}`);
    const run = res.data;
    if (run.status === "success") onDone(true, fmt(s.okShort, { added: run.added, changed: run.changed, removed: run.removed }));
    else onDone(false, `${s.failed}: ${run.error ?? ""}`);
    router.refresh();
  };

  return (
    <section aria-labelledby="sync-title" className="card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <h2 id="sync-title" className="m-0 text-lg font-bold">{s.title}</h2>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">{s.hint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {fileId && (
            <a href={settings.google_sheet_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
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
          {fmt(s.ok, { added: lastSync.added, changed: lastSync.changed, unchanged: lastSync.unchanged })}
          {lastSync.invalid > 0 && <><br />{fmt(s.invalidRows, { n: lastSync.invalid })}</>}
          {lastSync.removed > 0 && <><br />{fmt(s.removed, { n: lastSync.removed })}</>}
          {lastSync.restored > 0 && <><br />{fmt(s.restored, { n: lastSync.restored })}</>}
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
