import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate } from "@/lib/i18n";
import { ActionForm } from "@/components/action-form";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";
import { forgetTrash, restoreTrash } from "@/app/trash-actions";

type Row = {
  id: string; kind: string; label: string; deleted_at: string; purge_after: string; deleted_by: string | null;
  restored_at: string | null; restored_by: string | null;
};

/** What was deleted in the last 30 days: Admin restores it or deletes it for good (Settings > Trash). */
export default async function TrashPage() {
  const { user, locale, t } = await requireRole("admin");
  const T = t.trash;
  const rows = await q<Row>(user.id,
    `select t.id, t.kind, t.label, t.deleted_at::text, t.purge_after::text, d.full_name as deleted_by,
            t.restored_at::text, r.full_name as restored_by
       from trash t left join profiles d on d.id = t.deleted_by left join profiles r on r.id = t.restored_by
      order by coalesce(t.restored_at, t.deleted_at) desc`);
  const open = rows.filter((r) => !r.restored_at);
  const restored = rows.filter((r) => r.restored_at);
  const when = (d: string) => formatDate(locale, d, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.adminSettings.title} subtitle={t.adminSettings.subtitle} />
      <SettingsTabs t={t} active="trash" />
      <Card title={T.title} id="trash-h">
        <p className="m-0 text-sm text-ink-2">{T.subtitle}</p>
        {open.length === 0 && <Empty>{T.empty}</Empty>}
        <ul className="m-0 flex list-none flex-col p-0">
          {open.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 border-t border-mist py-3">
              <div className="min-w-0 flex-[1_1_280px]">
                <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
                  <Chip tone="neutral">{(T.kinds as Record<string, string>)[r.kind] ?? r.kind}</Chip>
                  <span className="font-semibold break-words">{r.label}</span>
                </p>
                <p className="m-0 mt-1 text-xs text-ink-2">
                  {fmt(T.deletedBy, { name: r.deleted_by ?? "—", date: when(r.deleted_at) })} · {fmt(T.goesOn, { date: formatDate(locale, r.purge_after) })}
                </p>
              </div>
              {!user.readOnly && (
                <div className="flex flex-wrap items-start gap-2">
                  <ActionForm action={restoreTrash} submitLabel={T.restore} resetOnSuccess={false}>
                    <input type="hidden" name="id" value={r.id} />
                  </ActionForm>
                  <details>
                    <summary className="btn btn-outline cursor-pointer list-none text-red-ink">{T.forget}</summary>
                    <div className="mt-2 flex max-w-[360px] flex-col gap-2 rounded-sm border border-red-line bg-red-tint p-3">
                      <p className="m-0 text-sm font-semibold text-red-ink">{fmt(T.forgetConfirm, { label: r.label })}</p>
                      <ActionForm action={forgetTrash} submitLabel={T.forget} resetOnSuccess={false}>
                        <input type="hidden" name="id" value={r.id} />
                      </ActionForm>
                    </div>
                  </details>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {restored.length > 0 && (
        <Card title={T.restoredList} id="trash-restored-h">
          <ul className="m-0 flex list-none flex-col p-0">
            {restored.map((r) => (
              <li key={r.id} className="border-t border-mist py-2 text-sm">
                <span className="font-semibold break-words">{(T.kinds as Record<string, string>)[r.kind] ?? r.kind} · {r.label}</span>
                <span className="block text-xs text-ink-2">{fmt(T.restoredBy, { name: r.restored_by ?? "—", date: when(r.restored_at!) })}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
