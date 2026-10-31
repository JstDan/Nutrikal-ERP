// Demo sign-in: one user per role. Replaced by Supabase Auth later.
export const DEMO_USERS = [
  { id: "00000000-0000-4000-8000-00000000000a", role: "admin", name: "Admin", initials: "AD" },
  { id: "00000000-0000-4000-8000-00000000000b", role: "sales", name: "Sales", initials: "SA" },
  { id: "00000000-0000-4000-8000-00000000000d", role: "production", name: "Production", initials: "PR" },
  { id: "00000000-0000-4000-8000-00000000000e", role: "developer", name: "Developer", initials: "DV" },
  { id: "00000000-0000-4000-8000-00000000000f", role: "bookkeeper", name: "Bookkeeper", initials: "BK" },
  { id: "00000000-0000-4000-8000-000000000010", role: "accountant", name: "Accountant", initials: "AC" },
  { id: "00000000-0000-4000-8000-000000000011", role: "designer", name: "Designer", initials: "DS" },
] as const;

export type Role = (typeof DEMO_USERS)[number]["role"];
export const DEFAULT_USER_ID = DEMO_USERS[0].id;
