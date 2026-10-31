import { redirect } from "next/navigation";

/** Offers are created in the calculator. */
export default function NewOfferPage() {
  redirect("/calculator");
}
