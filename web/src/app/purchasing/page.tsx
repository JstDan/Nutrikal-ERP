import { redirect } from "next/navigation";

// Purchase requests moved into Доставки (owner, Oct 2026): one page for deliveries.
export default async function PurchasingPage({ searchParams }: PageProps<"/purchasing">) {
  const sp = await searchParams;
  redirect(`/deliveries?status=requests${typeof sp.status === "string" ? `&rs=${encodeURIComponent(sp.status)}` : ""}`);
}
