import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate } from "@/lib/i18n";
import { ActionForm } from "@/components/action-form";
import { Card, Empty, PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";
import { KnowledgeRow } from "@/components/ai-knowledge";
import { addKnowledge } from "./actions";

type Note = { id: string; body: string; status: "proposed" | "approved"; by: string | null; created_at: string };

/** Nutri AI's memory (owner, Nov 2026): what it knows in every conversation; proposals wait here for Admin. */
export default async function AiSettingsPage() {
  const { user, locale, t } = await requireRole("admin");
  const S = t.adminSettings;
  const A = S.ai;
  const notes = await q<Note>(user.id,
    `select k.id, k.body, k.status, p.full_name as by, k.created_at::text
       from ai_knowledge k left join profiles p on p.id = k.created_by order by k.created_at`);
  const proposed = notes.filter((n) => n.status === "proposed");
  const approved = notes.filter((n) => n.status === "approved");
  const T = { save: A.save, approve: A.approve, remove: A.remove, removeConfirm: A.removeConfirm, addLabel: A.addLabel };
  const meta = (n: Note) => fmt(A.by, { name: n.by ?? "—", date: formatDate(locale, n.created_at.slice(0, 10)) });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={S.title} subtitle={S.subtitle} />
      <SettingsTabs t={t} active="ai" />
      <Card title={A.title}>
        <p className="m-0 text-sm text-ink-2">{A.note}</p>
        <ActionForm action={addKnowledge} submitLabel={A.add}>
          <label className="field">
            <span>{A.addLabel}</span>
            <textarea name="body" required maxLength={1000} rows={2} placeholder={A.placeholder} className="input" />
          </label>
        </ActionForm>
      </Card>
      {proposed.length > 0 && (
        <Card title={A.proposed}>
          <ul className="m-0 list-none p-0">
            {proposed.map((n) => <KnowledgeRow key={n.id} id={n.id} body={n.body} proposed meta={meta(n)} T={T} />)}
          </ul>
        </Card>
      )}
      <Card title={A.approved} action={<span className="text-xs text-ink-2">{fmt(A.count, { n: approved.length })}</span>}>
        {approved.length === 0 ? <Empty>{A.empty}</Empty> : (
          <ul className="m-0 list-none p-0">
            {approved.map((n) => <KnowledgeRow key={n.id} id={n.id} body={n.body} proposed={false} meta={meta(n)} T={T} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}
