"use client";

import { useState } from "react";
import { setLotDetails } from "@/app/actions";
import { ActionForm } from "@/components/action-form";

export type LotDetail = { lot_id: string; label: string; expires_on: string | null; supplier_lot: string | null };

type Labels = { lot: string; expires: string; batch: string; hint: string; submit: string };

/**
 * Admin, under Stock: the expiry date and the supplier's batch number of a lot (owner, Nov 2026). Both are optional;
 * the fields show the lot's current values and an empty field clears the value.
 */
export function LotDetailsForm({ lots, labels }: { lots: LotDetail[]; labels: Labels }) {
  const [lotId, setLotId] = useState(lots[0]?.lot_id ?? "");
  const lot = lots.find((l) => l.lot_id === lotId) ?? lots[0];
  if (!lot) return null;

  return (
    <ActionForm action={setLotDetails} submitLabel={labels.submit} resetOnSuccess={false}>
      <p className="m-0 text-[13px] text-ink-2">{labels.hint}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        <label className="field"><span>{labels.lot} *</span>
          <select name="lot_id" required value={lot.lot_id} onChange={(e) => setLotId(e.target.value)} className="input">
            {lots.map((l) => <option key={l.lot_id} value={l.lot_id}>{l.label}</option>)}
          </select>
        </label>
        {/* keyed by the lot, so the fields start from the chosen lot's values */}
        <label key={`e-${lot.lot_id}`} className="field"><span>{labels.expires}</span>
          <input name="expires_on" type="date" defaultValue={lot.expires_on ?? ""} className="input" />
        </label>
        <label key={`b-${lot.lot_id}`} className="field"><span>{labels.batch}</span>
          <input name="supplier_lot" maxLength={100} defaultValue={lot.supplier_lot ?? ""} className="input" />
        </label>
      </div>
    </ActionForm>
  );
}
