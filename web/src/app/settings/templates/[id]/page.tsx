import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { Card, Chip, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { COLUMN_COLORS } from "@/lib/tasks-shared";
import {
  addTemplateColumn, deleteTemplate, deleteTemplateColumn, deleteTemplateItem, moveTemplateRow, saveTemplate, saveTemplateColumn, saveTemplateItem,
} from "@/app/template-actions";

type Template = { id: string; name_bg: string; name_en: string | null; is_default: boolean; active: boolean; used: boolean };
type Column = { id: string; system_key: string | null; name_bg: string; name_en: string | null; color: string | null; hidden: boolean };
type Item = {
  id: string; column_id: string; key: string; title_bg: string; title_en: string | null; auto_rule: string | null; prefill_rule: string | null;
  default_checklist: { bg: string; en?: string }[]; depends_on: string[]; condition: string | null;
};
const RULES = [
  "payment_first", "invoice_advance", "payment_final", "invoice_final", "invoice_full", "recipes_approved", "materials_available",
  "shortfall_delivered", "materials_reserved", "packaging_reserved", "sent_to_production", "in_production", "consumption_reported",
  "qc_released", "coa_ready",
] as const;
const CONDITIONS = ["payment:split", "payment:full", "service:free_sale", "service:label_design"] as const;

/** One task template (admin): its columns and the tasks in them. Changes apply to future orders only. */
export default async function TemplatePage({ params }: PageProps<"/settings/templates/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireRole("admin");
  const T = t.tasks.templates;
  const C = t.tasks.columnsDialog;
  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const tpl = (await tx.query<Template>(
      `select id, name_bg, name_en, is_default, active,
              exists (select 1 from order_task_boards where template_id = t.id) as used
         from order_task_templates t where id = $1`, [id])).rows[0];
    if (!tpl) return null;
    const columns = (await tx.query<Column>(
      "select id, system_key, name_bg, name_en, color, hidden from order_task_template_columns where template_id = $1 order by position, id", [id])).rows;
    const items = (await tx.query<Item>(
      `select id, column_id, key, title_bg, title_en, auto_rule, prefill_rule, default_checklist, depends_on, condition
         from order_task_template_items where template_id = $1 order by position, id`, [id])).rows;
    return { tpl, columns, items };
  });
  if (!data) notFound();
  const { tpl, columns, items } = data;
  const colName = (c: Column) => (locale === "en" ? c.name_en || c.name_bg : c.name_bg);
  const itemTitle = (i: Item) => (locale === "en" ? i.title_en || i.title_bg : i.title_bg);
  const hidden = (extra: Record<string, string> = {}) => (
    <>
      <input type="hidden" name="template_id" value={tpl.id} />
      {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );
  const move = (what: "column" | "item", rowId: string, first: boolean, last: boolean, label: string) => (
    <span className="flex shrink-0 gap-1">
      {(["up", "down"] as const).map((dir) => (
        <form key={dir} action={moveTemplateRow}>
          {hidden({ what, id: rowId, dir })}
          <button type="submit" className="btn btn-outline min-h-11 min-w-11 px-2" disabled={dir === "up" ? first : last}
            aria-label={`${dir === "up" ? t.tasks.moveUp : t.tasks.moveDown}: ${label}`}>{dir === "up" ? "↑" : "↓"}</button>
        </form>
      ))}
    </span>
  );

  /** The fields of a task; the same form adds a new one (no item). */
  const itemForm = (col: Column, it?: Item) => (
    <ActionForm action={saveTemplateItem} submitLabel={it ? T.save : T.addItem} resetOnSuccess={!it}>
      {hidden(it ? { item_id: it.id } : {})}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="field"><span>{T.titleBg} *</span><input name="title_bg" required defaultValue={it?.title_bg} className="input" /></label>
        <label className="field"><span>{T.titleEn}</span><input name="title_en" defaultValue={it?.title_en ?? ""} className="input" /></label>
        <label className="field"><span>{T.key} *</span>
          <input name="key" required pattern="[a-z0-9_]{1,40}" defaultValue={it?.key} className="input" aria-describedby={`key-hint-${it?.id ?? col.id}`} />
          <small id={`key-hint-${it?.id ?? col.id}`} className="text-xs text-ink-2">{T.keyHint}</small>
        </label>
        <label className="field"><span>{t.tasks.column}</span>
          <select name="column_id" defaultValue={col.id} className="input">
            {columns.map((c) => <option key={c.id} value={c.id}>{colName(c)}</option>)}
          </select>
        </label>
        <label className="field"><span>{T.rule}</span>
          <select name="auto_rule" defaultValue={it?.auto_rule ?? ""} className="input">
            <option value="">{T.ruleNone}</option>
            {RULES.map((r) => <option key={r} value={r}>{t.tasks.rules[r]}</option>)}
          </select>
        </label>
        <label className="field"><span>{T.condition}</span>
          <select name="condition" defaultValue={it?.condition ?? ""} className="input">
            <option value="">{T.conditions.none}</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{T.conditions[c]}</option>)}
          </select>
        </label>
        <label className="field sm:col-span-2"><span>{T.checklist}</span>
          <textarea name="checklist" rows={3} className="input" aria-describedby={`cl-hint-${it?.id ?? col.id}`}
            defaultValue={(it?.default_checklist ?? []).map((x) => (x.en ? `${x.bg} | ${x.en}` : x.bg)).join("\n")} />
          <small id={`cl-hint-${it?.id ?? col.id}`} className="text-xs text-ink-2">{T.checklistHint}</small>
        </label>
      </div>
      {items.some((x) => x.id !== it?.id) && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold">{T.dependsOn}</legend>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {items.filter((x) => x.id !== it?.id).map((x) => (
              <label key={x.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" name="depends_on" value={x.key} defaultChecked={it?.depends_on.includes(x.key)} className="h-5 w-5 shrink-0 accent-ink" />
                <span className="min-w-0 break-words">{itemTitle(x)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" name="prefill" defaultChecked={it?.prefill_rule === "recipe_unchanged"} className="h-5 w-5 shrink-0 accent-ink" />
        {T.prefill}
      </label>
    </ActionForm>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/orders" className="text-ink-2">{t.orders.title}</Link> / <Link href="/settings/templates" className="text-ink-2">{T.title}</Link></>}
        title={locale === "en" ? tpl.name_en || tpl.name_bg : tpl.name_bg}
        subtitle={T.subtitle}
      />

      <Card title={T.name} id="tpl-h">
        <ActionForm action={saveTemplate} submitLabel={T.save} resetOnSuccess={false}>
          {hidden()}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="field"><span>{T.nameBg} *</span><input name="name_bg" required defaultValue={tpl.name_bg} className="input" /></label>
            <label className="field"><span>{T.nameEn}</span><input name="name_en" defaultValue={tpl.name_en ?? ""} className="input" /></label>
          </div>
          <div className="flex flex-wrap gap-x-6">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" name="is_default" defaultChecked={tpl.is_default} className="h-5 w-5 accent-ink" />{T.isDefault}
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" name="active" defaultChecked={tpl.active} className="h-5 w-5 accent-ink" />{T.active}
            </label>
          </div>
        </ActionForm>
        {tpl.used ? (
          <p className="m-0 text-xs text-ink-2">{T.deleteTemplateUsed}</p>
        ) : (
          <form action={deleteTemplate}>
            {hidden()}
            <button type="submit" className="btn btn-outline">{T.deleteTemplate}</button>
          </form>
        )}
      </Card>

      <h2 className="m-0 text-lg font-bold">{T.columns}</h2>
      {columns.map((col, ci) => {
        const colItems = items.filter((i) => i.column_id === col.id);
        return (
          <Card key={col.id} id={`col-${col.id}`}
            title={<span className="flex flex-wrap items-center gap-2">{colName(col)}{col.hidden && <Chip>{C.hidden}</Chip>}</span>}
            action={move("column", col.id, ci === 0, ci === columns.length - 1, colName(col))}>
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{C.edit}</summary>
              <div className="flex flex-col gap-3 pt-2">
                {col.system_key && <p className="m-0 text-xs text-ink-2">{C.locked}</p>}
                <ActionForm action={saveTemplateColumn} submitLabel={T.save} resetOnSuccess={false}>
                  {hidden({ column_id: col.id })}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="field"><span>{C.nameBg} *</span><input name="name_bg" required defaultValue={col.name_bg} className="input" /></label>
                    <label className="field"><span>{C.nameEn}</span><input name="name_en" defaultValue={col.name_en ?? ""} className="input" /></label>
                    <label className="field"><span>{C.color}</span>
                      <select name="color" defaultValue={col.color ?? "grey"} className="input">
                        {COLUMN_COLORS.map((k) => <option key={k} value={k}>{C.colors[k]}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" name="hidden" defaultChecked={col.hidden} className="h-5 w-5 accent-ink" />{C.hidden}
                  </label>
                </ActionForm>
                {!col.system_key && (colItems.length > 0 ? (
                  <p className="m-0 text-xs text-ink-2">{T.columnHasItems}</p>
                ) : (
                  <form action={deleteTemplateColumn}>
                    {hidden({ column_id: col.id })}
                    <button type="submit" className="btn btn-outline">{T.deleteColumn}</button>
                  </form>
                ))}
              </div>
            </details>

            <ul className="m-0 flex list-none flex-col p-0">
              {colItems.map((it, ii) => (
                <li key={it.id} className="flex flex-col gap-2 border-t border-mist py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold break-words">{itemTitle(it)}</span>
                      <Chip tone={it.auto_rule ? "green" : "neutral"}>{it.auto_rule ? t.tasks.auto : t.tasks.manual}</Chip>
                      {it.condition && <Chip tone="amber">{T.conditions[it.condition as "payment:split"]}</Chip>}
                    </span>
                    {move("item", it.id, ii === 0, ii === colItems.length - 1, itemTitle(it))}
                  </div>
                  <details>
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm">{C.edit}</summary>
                    <div className="flex flex-col gap-3 pt-2">
                      {itemForm(col, it)}
                      <form action={deleteTemplateItem}>
                        {hidden({ item_id: it.id })}
                        <button type="submit" className="btn btn-outline">{T.deleteItem}</button>
                      </form>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            <details className="border-t border-mist pt-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{T.addItem}</summary>
              <div className="pt-2">{itemForm(col)}</div>
            </details>
          </Card>
        );
      })}

      <Card title={T.addColumn} id="add-col-h">
        <ActionForm action={addTemplateColumn} submitLabel={T.addColumn}>
          {hidden()}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="field"><span>{C.nameBg} *</span><input name="name_bg" required className="input" /></label>
            <label className="field"><span>{C.nameEn}</span><input name="name_en" className="input" /></label>
            <label className="field"><span>{C.color}</span>
              <select name="color" defaultValue="grey" className="input">
                {COLUMN_COLORS.map((k) => <option key={k} value={k}>{C.colors[k]}</option>)}
              </select>
            </label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
