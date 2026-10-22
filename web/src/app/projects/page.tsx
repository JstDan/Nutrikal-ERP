import { redirect } from "next/navigation";

// The Projects page is switched off for now (owner, Oct 2026): sales work through Orders.
// Projects stay in the database (ERP offers and production still use them).
export default function ProjectsPage() {
  redirect("/orders");
}
