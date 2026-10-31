"use server";

// Task templates (admin). The tables are written directly: row-level
// security lets only admin change them, the triggers keep one default
// template and the system columns. Boards made earlier keep their columns.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, withUser } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const COLORS = ["grey", "blue", "purple", "orange", "teal"];
const CONDITIONS = ["payment:split", "payment:full", "service:free_sale", "service:label_design"];
const path = (id: string | null) => `/settings/templates/${id ?? ""}`;

/** "BG | EN" per line -> [{bg, en}] */
function checklist(raw: string | null) {
  return (raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [bg, en] = l.split("|").map((x) => x.trim());
    return en ? { bg, en } : { bg };
  });
}

export async function createTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  const from = uuid(fd.get("copy_from"));
  let id: string;
  try {
    id = await withUser(user.id, async (tx) => {
      const t = (await tx.query<{ id: string }>(
        "insert into order_task_templates (name_bg, name_en) values ($1, $2) returning id", [str(fd, "name_bg"), str(fd, "name_en")])).rows[0].id;
      if (from) {
        const cols = (await tx.query<{ id: string }>(
          "select id from order_task_template_columns where template_id = $1 order by position", [from])).rows;
        for (const c of cols) {
          await tx.query(
            `with n as (
               insert into order_task_template_columns (template_id, system_key, name_bg, name_en, color, position, hidden)
               select $1, system_key, name_bg, name_en, color, position, hidden from order_task_template_columns where id = $2
               returning id)
             insert into order_task_template_items
               (template_id, column_id, key, title_bg, title_en, auto_rule, prefill_rule, default_checklist, depends_on, condition, position)
             select $1, n.id, i.key, i.title_bg, i.title_en, i.auto_rule, i.prefill_rule, i.default_checklist, i.depends_on, i.condition, i.position
               from n, order_task_template_items i where i.column_id = $2`, [t, c.id]);
        }
      } else {
        // Empty: the six stages, no tasks
        await tx.query(
          `insert into order_task_template_columns (template_id, system_key, name_bg, name_en, color, position)
           select $1, system_key, name_bg, name_en, color, row_number() over (order by position)
             from order_task_template_columns
            where template_id = (select id from order_task_templates where is_default) and system_key is not null`, [t]);
      }
      return t;
    });
  } catch (e) {
    return { error: errorText(e) };
  }
  redirect(path(id));
}

export async function saveTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const id = uuid(fd.get("template_id"));
  try {
    await q(user.id, "update order_task_templates set name_bg = $2, name_en = $3, active = $4 or $5, is_default = $5 where id = $1",
      [id, str(fd, "name_bg"), str(fd, "name_en"), fd.get("active") === "on", fd.get("is_default") === "on"]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(path(id));
  return { ok: true, message: t.tasks.templates.saved };
}

/** A template that boards were made from is only set to Not used (the button is hidden then). */
export async function deleteTemplate(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, `delete from order_task_templates where id = $1
                      and not exists (select 1 from order_task_boards where template_id = $1)`, [uuid(fd.get("template_id"))]);
  redirect("/settings/templates");
}

export async function addTemplateColumn(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  const id = uuid(fd.get("template_id"));
  const color = str(fd, "color");
  try {
    await q(user.id, `insert into order_task_template_columns (template_id, name_bg, name_en, color, position)
                      values ($1, $2, $3, $4, (select coalesce(max(position), 0) + 1 from order_task_template_columns where template_id = $1))`,
      [id, str(fd, "name_bg"), str(fd, "name_en"), color && COLORS.includes(color) ? color : "grey"]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(path(id));
  return { ok: true };
}

export async function saveTemplateColumn(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const color = str(fd, "color");
  try {
    await q(user.id, "update order_task_template_columns set name_bg = $2, name_en = $3, color = $4, hidden = $5 where id = $1",
      [uuid(fd.get("column_id")), str(fd, "name_bg"), str(fd, "name_en"), color && COLORS.includes(color) ? color : null, fd.get("hidden") === "on"]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(path(uuid(fd.get("template_id"))));
  return { ok: true, message: t.tasks.templates.saved };
}

/** Swaps a column (or a task) with its neighbour above or below. */
export async function moveTemplateRow(fd: FormData) {
  const { user } = await getSession();
  const table = fd.get("what") === "item" ? "order_task_template_items" : "order_task_template_columns";
  const parent = table === "order_task_template_items" ? "column_id" : "template_id";
  const up = fd.get("dir") === "up";
  await withUser(user.id, async (tx) => {
    const rows = (await tx.query<{ id: string }>(
      `select id from ${table} where ${parent} = (select ${parent} from ${table} where id = $1) order by position, id`, [uuid(fd.get("id"))])).rows;
    const i = rows.findIndex((r) => r.id === fd.get("id"));
    const j = up ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (const [n, r] of rows.entries()) await tx.query(`update ${table} set position = $2 where id = $1`, [r.id, n + 1]);
  });
  revalidatePath(path(uuid(fd.get("template_id"))));
}

/** Only an empty column that is not a system stage (the button is hidden otherwise). */
export async function deleteTemplateColumn(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, `delete from order_task_template_columns c where id = $1 and system_key is null
                      and not exists (select 1 from order_task_template_items where column_id = c.id)`, [uuid(fd.get("column_id"))]);
  revalidatePath(path(uuid(fd.get("template_id"))));
}

/** A task of a template: new (no item_id) or changed. */
export async function saveTemplateItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const templateId = uuid(fd.get("template_id"));
  const itemId = uuid(fd.get("item_id"));
  const rule = str(fd, "auto_rule");
  const condition = str(fd, "condition");
  const deps = fd.getAll("depends_on").filter((v): v is string => typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v));
  try {
    await withUser(user.id, async (tx) => {
      // Dependencies only on tasks of the same template, never on itself
      const keys = new Set((await tx.query<{ key: string }>(
        "select key from order_task_template_items where template_id = $1 and id is distinct from $2", [templateId, itemId])).rows.map((r) => r.key));
      const values = [
        str(fd, "key"), str(fd, "title_bg"), str(fd, "title_en"), rule,
        !rule && fd.get("prefill") === "on" ? "recipe_unchanged" : null,
        JSON.stringify(checklist(str(fd, "checklist"))), deps.filter((k) => keys.has(k)),
        condition && CONDITIONS.includes(condition) ? condition : null, uuid(fd.get("column_id")),
      ];
      if (itemId) {
        await tx.query(
          `update order_task_template_items set key = $2, title_bg = $3, title_en = $4, auto_rule = $5, prefill_rule = $6,
                  default_checklist = $7::jsonb, depends_on = $8, condition = $9, column_id = $10 where id = $1`, [itemId, ...values]);
      } else {
        await tx.query(
          `insert into order_task_template_items
             (template_id, key, title_bg, title_en, auto_rule, prefill_rule, default_checklist, depends_on, condition, column_id, position)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10,
                   (select coalesce(max(position), 0) + 1 from order_task_template_items where column_id = $10))`, [templateId, ...values]);
      }
    });
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(path(templateId));
  return { ok: true, message: itemId ? t.tasks.templates.saved : undefined };
}

export async function deleteTemplateItem(fd: FormData) {
  const { user } = await getSession();
  await withUser(user.id, async (tx) => {
    const it = (await tx.query<{ key: string; template_id: string }>(
      "delete from order_task_template_items where id = $1 returning key, template_id", [uuid(fd.get("item_id"))])).rows[0];
    // Other tasks no longer wait for it
    if (it) await tx.query("update order_task_template_items set depends_on = array_remove(depends_on, $2) where template_id = $1 and $2 = any (depends_on)",
      [it.template_id, it.key]);
  });
  revalidatePath(path(uuid(fd.get("template_id"))));
}
