// Order Task Manager: data of a board and what is computed from it
// (blocked tasks, stage progress, the "Next:" sentence). Shared by the
// server page and the client board; no server imports here.
import type { Locale } from "@/lib/i18n";

export type TaskStatus = "todo" | "in_progress" | "waiting" | "done";
export type ColumnColor = "grey" | "blue" | "purple" | "orange" | "teal";
export const COLUMN_COLORS: ColumnColor[] = ["grey", "blue", "purple", "orange", "teal"];
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "waiting", "done"];

export type BoardColumn = {
  id: string; system_key: string | null; name_bg: string; name_en: string | null; color: ColumnColor | null;
  position: number; hidden: boolean;
};
export type BoardTask = {
  id: string; column_id: string; template_key: string | null; title: string; title_en: string | null; description: string;
  kind: "auto" | "manual"; auto_rule: string | null; status: TaskStatus; assignee_id: string | null; position: number;
  note: Record<string, string | number> | null; completed_at: string | null; override: boolean; override_reason: string | null;
  created_by: string | null;
};
export type ChecklistItem = { id: string; task_id: string; text: string; text_en: string | null; done: boolean; position: number };
export type Dependency = { task_id: string; depends_on_task_id: string };
export type TaskLink = { id: string; task_id: string; entity_type: string; entity_id: string; label: string; is_auto: boolean; href: string | null };
export type TaskFile = { id: string; task_id: string; comment_id: string | null; name: string; size: number; mime: string | null; uploaded_by: string; created_at: string };
export type TaskComment = {
  id: string; task_id: string; author_id: string; body: string; mentions: string[]; created_at: string; edited_at: string | null; deleted_at: string | null;
};
export type TaskActivity = { id: string; task_id: string; actor_id: string | null; action: string; payload: Record<string, unknown>; created_at: string };
export type BoardUser = { id: string; full_name: string; role: string };
export type MaterialLine = {
  item_id: string; sku: string; name: string; name_bg: string | null; kind: string; unit: string; required: number; reserved: number;
  free: number; incoming: number; incoming_on: string | null; incoming_ref: string | null; status: "ok" | "short_incoming" | "short_no_order";
};
export type MaterialCheck = {
  id: string; checked_at: string; source: string; total: number; ok: number; lines: MaterialLine[];
  recipe_versions: { id: string; code: string; version: number }[];
};
export type LinkOption = { entity_type: string; entity_id: string; label: string };
export type TemplateOption = { id: string; name_bg: string; name_en: string | null; is_default: boolean };

export type BoardData = {
  board: { id: string; payment_mode: "split" | "full"; template_id: string | null; template_name: string | null };
  columns: BoardColumn[];
  tasks: BoardTask[];
  checklist: ChecklistItem[];
  deps: Dependency[];
  links: TaskLink[];
  files: TaskFile[];
  comments: TaskComment[];
  reads: Record<string, string>;     // task id -> last read
  activity: TaskActivity[];
  users: BoardUser[];
  checks: MaterialCheck[];           // newest first
  linkOptions: LinkOption[];
  formulaHref: string | null;
};

export const taskTitle = (t: { title: string; title_en: string | null }, l: Locale) => (l === "en" ? t.title_en ?? t.title : t.title);
export const columnName = (c: { name_bg: string; name_en: string | null }, l: Locale) => (l === "en" ? c.name_en || c.name_bg : c.name_bg);
export const itemText = (c: { text: string; text_en: string | null }, l: Locale) => (l === "en" ? c.text_en ?? c.text : c.text);

/** Open tasks each task waits for. */
export function blockersOf(data: Pick<BoardData, "tasks" | "deps">): Map<string, BoardTask[]> {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const m = new Map<string, BoardTask[]>();
  for (const d of data.deps) {
    const on = byId.get(d.depends_on_task_id);
    if (!on || on.status === "done") continue;
    m.set(d.task_id, [...(m.get(d.task_id) ?? []), on]);
  }
  return m;
}

/** Open tasks that wait for each task. */
export function blockingOf(data: Pick<BoardData, "tasks" | "deps">): Map<string, BoardTask[]> {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const m = new Map<string, BoardTask[]>();
  for (const d of data.deps) {
    const waiting = byId.get(d.task_id);
    if (!waiting || waiting.status === "done") continue;
    m.set(d.depends_on_task_id, [...(m.get(d.depends_on_task_id) ?? []), waiting]);
  }
  return m;
}

/** Visible columns in process order. */
export const visibleColumns = (cols: BoardColumn[]) => cols.filter((c) => !c.hidden).sort((a, b) => a.position - b.position);

/** Tasks of a column: completed first (in the order they were completed), then open ones in process order. */
export function columnTasks(tasks: BoardTask[], columnId: string): { done: BoardTask[]; open: BoardTask[] } {
  const all = tasks.filter((t) => t.column_id === columnId);
  return {
    done: all.filter((t) => t.status === "done").sort((a, b) => (a.completed_at ?? "").localeCompare(b.completed_at ?? "")),
    open: all.filter((t) => t.status !== "done").sort((a, b) => a.position - b.position),
  };
}

export type StageState = "done" | "active" | "not_started";
/** Per visible column: done / total and its state; the first column with open tasks is the active one. */
export function stages(data: Pick<BoardData, "columns" | "tasks">): { column: BoardColumn; done: number; total: number; state: StageState }[] {
  let activeSeen = false;
  return visibleColumns(data.columns).map((column) => {
    const all = data.tasks.filter((t) => t.column_id === column.id);
    const done = all.filter((t) => t.status === "done").length;
    let state: StageState = "not_started";
    if (all.length > 0 && done === all.length) state = "done";
    else if (all.length === 0) state = "not_started";
    else if (!activeSeen) { state = "active"; activeSeen = true; }
    else if (done > 0) state = "active";
    return { column, done, total: all.length, state };
  });
}

/** The first open tasks in stage order (for "Next:"), and how many tasks dispatch still waits for. */
export function nextUp(data: Pick<BoardData, "columns" | "tasks" | "deps">, max = 3): { tasks: BoardTask[]; dispatchBlockers: number } {
  const blockers = blockersOf(data);
  const order = new Map(visibleColumns(data.columns).map((c, i) => [c.id, i]));
  const open = data.tasks
    .filter((t) => t.status !== "done" && order.has(t.column_id) && !blockers.has(t.id))
    .sort((a, b) => (order.get(a.column_id)! - order.get(b.column_id)!) || a.position - b.position);
  const dispatch = data.tasks.find((t) => t.template_key === "dispatch" && t.status !== "done");
  return { tasks: open.slice(0, max), dispatchBlockers: dispatch ? blockers.get(dispatch.id)?.length ?? 0 : 0 };
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

/** Text with links made clickable: parts of plain text and URLs. */
export function linkParts(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const re = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], href: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export const TASK_FILE_TYPES = ["pdf", "png", "jpg", "jpeg", "webp", "svg", "ai", "psd", "eps", "doc", "docx", "xls", "xlsx", "csv", "txt", "zip"];
export const TASK_FILE_MAX = 25 * 1024 * 1024;
export const fileExt = (name: string) => (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
