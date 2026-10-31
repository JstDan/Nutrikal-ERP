"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

const text = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const val = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => val(fd, k) || null;

/** One ingredient on a line: name | amount | specification | basis. Only name and amount are public. */
const ingredientLines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const [name, amount = "", spec = "", basis = ""] = l.split("|").map((p) => p.trim());
  return { name, amount, ...(spec && { spec }), ...(basis && { basis }) };
});

/** A recipe becomes a product in one step; a second press opens the same product. */
export async function createCatalogProduct(fd: FormData) {
  const { user } = await getSession();
  const [row] = await q<{ id: string }>(user.id, "select catalog_from_formula($1) as id", [val(fd, "formula_id")]);
  revalidatePath("/catalog");
  redirect(`/catalog/${row.id}`);
}

export async function saveCatalogProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id,
      `update catalog_products set name = $2, name_bg = $3, description = $4, description_bg = $5, category_id = $6, sort_order = $7,
              min_qty = $8, product_format = $9, pack = $10, pack_bg = $11, ingredients = $12::jsonb, review_status = $13, internal_notes = $14 where id = $1`,
      [val(fd, "id"), val(fd, "name"), opt(fd, "name_bg"), opt(fd, "description"), opt(fd, "description_bg"), opt(fd, "category_id"), Number(val(fd, "sort_order")) || 0,
       Number(val(fd, "min_qty")) || 500, opt(fd, "product_format"), opt(fd, "pack"), opt(fd, "pack_bg"), JSON.stringify(ingredientLines(val(fd, "ingredients"))), opt(fd, "review_status"), opt(fd, "internal_notes")]);
  } catch (e) {
    return { error: text(e) };
  }
  revalidatePath("/catalog", "layout");
  return { ok: true, message: t.catalog.saved };
}

export async function addCatalogTier(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id,
      `insert into catalog_price_tiers (product_id, min_qty, unit_price) values ($1, $2, $3)
       on conflict (product_id, min_qty) do update set unit_price = excluded.unit_price`,
      [val(fd, "product_id"), Number(val(fd, "min_qty")), Number(val(fd, "unit_price").replace(",", "."))]);
  } catch (e) {
    return { error: text(e).includes("catalog_below_minimum") ? t.catalog.belowMinimum : text(e) };
  }
  revalidatePath("/catalog", "layout");
  return { ok: true, message: t.catalog.saved };
}

export async function removeCatalogTier(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from catalog_price_tiers where id = $1", [val(fd, "id")]);
  revalidatePath("/catalog", "layout");
}

export async function publishCatalogProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "update catalog_products set is_published = true where id = $1", [val(fd, "id")]);
  } catch (e) {
    const key = text(e).match(/catalog_(\w+)/)?.[1] as keyof typeof t.catalog.problems | undefined;
    return { error: key && key in t.catalog.problems ? t.catalog.problems[key] : text(e) };
  }
  revalidatePath("/catalog", "layout");
  return { ok: true, message: t.catalog.publishedNow };
}

export async function linkCatalogRecipe(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "update catalog_products set formula_id = $2 where id = $1", [val(fd, "id"), val(fd, "formula_id")]);
  revalidatePath("/catalog", "layout");
}

export async function publishReadyCatalog() {
  const { user } = await getSession();
  await q(user.id, "select catalog_publish_ready()");
  revalidatePath("/catalog", "layout");
}

export async function unpublishCatalogProduct(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "update catalog_products set is_published = false where id = $1", [val(fd, "id")]);
  revalidatePath("/catalog", "layout");
}

export async function enquiryToClient(fd: FormData) {
  const { user } = await getSession();
  const [row] = await q<{ id: string }>(user.id, "select catalog_enquiry_to_client($1) as id", [val(fd, "id")]);
  revalidatePath("/catalog", "layout");
  redirect(`/clients/${row.id}`);
}

export async function setEnquiryStatus(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "update catalog_enquiries set status = $2 where id = $1", [val(fd, "id"), val(fd, "status")]);
  revalidatePath("/catalog", "layout");
}
