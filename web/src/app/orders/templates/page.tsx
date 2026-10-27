import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { Card, Chip, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { createTemplate } from "@/app/template-actions";

type Row = { id: string; name_bg: string; name_en: string | null; is_default: boolean; active: boolean; columns: number; items: number };

/** Task templates (admin): the columns and tasks a new order's board is made from. */
export default async function TemplatesPage() {
  const { user, locale, t } = await requireRole("admin");
  const T = t.tasks.templates;
  const rows = await withUser(user.id, async (tx) => (await tx.query<Row>(
    `select t.id, t.name_bg, t.name_en, t.is_default, t.active,
            (select count(*)::int from order_task_template_columns where template_id = t.id) as columns,
            (select count(*)::int from order_task_template_items where template_id = t.id) as items
       from order_task_templates t order by t.is_default desc, t.active desc, t.name_bg`)).rows);
  const name = (x: Row) => (locale === "en" ? x.name_en || x.name_bg : x.name_bg);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader crumb={<Link href="/orders" className="text-ink-2">{t.orders.title}</Link>} title={T.title} subtitle={T.subtitle} />
      <Card>
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((x) => (
            <li key={x.id} className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-mist py-2 last:border-0">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Link href={`/orders/templates/${x.id}`} className="font-semibold break-words text-ink">{name(x)}</Link>
                {x.is_default && <Chip tone="green">{T.isDefault}</Chip>}
                {!x.active && <Chip tone="neutral">{T.inactive}</Chip>}
              </span>
              <span className="text-sm text-ink-2">{t.tasks.columns}: {x.columns} · {T.items}: {x.items}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={T.newTemplate} id="new-template-h">
        <ActionForm action={createTemplate} submitLabel={T.create}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="field"><span>{T.nameBg} *</span><input name="name_bg" required className="input" /></label>
            <label className="field"><span>{T.nameEn}</span><input name="name_en" className="input" /></label>
            <label className="field sm:col-span-2"><span>{T.copyFrom}</span>
              <select name="copy_from" className="input" defaultValue={rows.find((x) => x.is_default)?.id ?? ""}>
                <option value="">{T.emptyTemplate}</option>
                {rows.map((x) => <option key={x.id} value={x.id}>{name(x)}</option>)}
              </select>
            </label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
