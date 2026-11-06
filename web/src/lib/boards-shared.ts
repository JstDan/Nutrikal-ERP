// Boards (like Trello): types and helpers shared by the server and the browser.

export const BOARD_BUCKET = "board-files";
export const BOARD_COLORS = ["blue", "green", "orange", "purple", "red", "teal", "grey"] as const;
export const LABEL_COLORS = ["green", "yellow", "orange", "red", "purple", "blue", "teal", "grey"] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];
export type LabelColor = (typeof LABEL_COLORS)[number];

/** Background of a board tile and the strip on top of a board. */
export const BOARD_HEX: Record<BoardColor, string> = {
  blue: "#3b6fd8", green: "#3f8f3a", orange: "#c8640f", purple: "#7a4fc4", red: "#c23a2b", teal: "#1a8a81", grey: "#5d6675",
};
/** Labels: dark enough for white text (contrast ≥ 4.5:1), yellow takes dark text. */
export const LABEL_HEX: Record<LabelColor, { bg: string; fg: string }> = {
  green: { bg: "#2f7d32", fg: "#fff" }, yellow: { bg: "#f2c94c", fg: "#222831" }, orange: { bg: "#b35a09", fg: "#fff" },
  red: { bg: "#c0392b", fg: "#fff" }, purple: { bg: "#6f42c1", fg: "#fff" }, blue: { bg: "#2f5fc4", fg: "#fff" },
  teal: { bg: "#137a72", fg: "#fff" }, grey: { bg: "#5d6675", fg: "#fff" },
};

export type BoardSummary = {
  id: string; name: string; color: BoardColor; archived_at: string | null; member: boolean;
  members: number; open_cards: number; mine: number;
};

export type BoardList = { id: string; name: string; position: number; archived_at: string | null };
export type BoardLabel = { id: string; name: string; color: LabelColor };
export type BoardCard = {
  id: string; list_id: string; title: string; description: string; position: number; due_on: string | null;
  done_at: string | null; archived_at: string | null; created_by: string; created_at: string;
  client_id: string | null; client: string | null; project_id: string | null; project: string | null;
  sales_order_id: string | null; sales_order: string | null;
};
export type BoardComment = { id: string; card_id: string; author_id: string; body: string; created_at: string; edited_at: string | null };
export type BoardFile = { id: string; card_id: string; name: string; size: number; mime: string | null; uploaded_by: string; created_at: string };
export type BoardItem = { id: string; card_id: string; text: string; done: boolean; position: number };
export type LinkOption = { id: string; label: string };

export type BoardData = {
  board: { id: string; name: string; color: BoardColor; created_by: string; archived_at: string | null };
  members: { user_id: string; full_name: string }[];
  people: { id: string; full_name: string }[];
  lists: BoardList[];
  labels: BoardLabel[];
  cards: BoardCard[];
  cardMembers: { card_id: string; user_id: string }[];
  cardLabels: { card_id: string; label_id: string }[];
  checklist: BoardItem[];
  comments: BoardComment[];
  files: BoardFile[];
  options: { clients: LinkOption[]; projects: LinkOption[]; orders: LinkOption[] };
  /** Other boards the user can move a card to, with their open lists. */
  moveTargets: { id: string; name: string; lists: { id: string; name: string }[] }[];
};

/** A position between two neighbours (fractions: one row changes on a move). */
export function between(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1;
  if (before == null) return after! - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}

export type DueState = "overdue" | "today" | "soon" | "later" | "done";

/** How close a due date is (today in the viewer's time zone). */
export function dueState(due: string | null, done: boolean, today: string): DueState | null {
  if (!due) return null;
  if (done) return "done";
  if (due < today) return "overdue";
  if (due === today) return "today";
  const days = (Date.parse(due) - Date.parse(today)) / 86400000;
  return days <= 2 ? "soon" : "later";
}

export const DUE_TONE: Record<DueState, string> = {
  overdue: "bg-red-tint text-red-ink", today: "bg-amber-tint text-amber-ink", soon: "bg-amber-tint text-amber-ink",
  later: "bg-neutral-tint text-ink", done: "bg-green-tint text-green-ink",
};

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

/** Today as yyyy-mm-dd in Sofia (the team's day). */
export function todaySofia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
