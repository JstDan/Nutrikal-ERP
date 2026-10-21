import { redirect } from "next/navigation";

// Calculator offers are listed under Offers now (old links and bookmarks).
export default function CalculatorOffersPage() {
  redirect("/offers");
}
