"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, withUser } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";
import { CATALOG_BUCKET, MAX_FILE_BYTES, newCatalogImagePath, putFile, removeFile } from "@/lib/files";
import { CATALOG_NAME_LANGS, PRODUCT_NAMES } from "@/lib/i18n/product-names";

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
  // Names on the open catalogue: only what differs from product-names.ts is kept, so the file still fills the rest
  const base = PRODUCT_NAMES[val(fd, "code")];
  const names = Object.fromEntries(CATALOG_NAME_LANGS
    .map((l) => [l, val(fd, `name_${l}`)] as const)
    .filter(([l, v]) => v && v !== base?.[l]));
  try {
    await q(user.id,
      `update catalog_products set name = $2, name_bg = $3, description = $4, description_bg = $5, category_id = $6, sort_order = $7,
              min_qty = $8, product_format = $9, pack = $10, pack_bg = $11, ingredients = $12::jsonb, review_status = $13, internal_notes = $14,
              names = $15::jsonb where id = $1`,
      [val(fd, "id"), val(fd, "name"), opt(fd, "name_bg"), opt(fd, "description"), opt(fd, "description_bg"), opt(fd, "category_id"), Number(val(fd, "sort_order")) || 0,
       Number(val(fd, "min_qty")) || 500, opt(fd, "product_format"), opt(fd, "pack"), opt(fd, "pack_bg"), JSON.stringify(ingredientLines(val(fd, "ingredients"))), opt(fd, "review_status"), opt(fd, "internal_notes"),
       JSON.stringify(names)]);
  } catch (e) {
    return { error: text(e) };
  }
  revalidatePath("/catalog", "layout");
  return { ok: true, message: t.catalog.saved };
}

/**
 * The designer (and Admin) keep a product's look (owner, Nov 2026): names, descriptions, site names, category and
 * pack text. The database lets the designer change nothing else (catalog_products_designer_guard).
 */
export async function saveCatalogLook(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const base = PRODUCT_NAMES[val(fd, "code")];
  const names = Object.fromEntries(CATALOG_NAME_LANGS
    .map((l) => [l, val(fd, `name_${l}`)] as const)
    .filter(([l, v]) => v && v !== base?.[l]));
  try {
    const rows = await q(user.id,
      `update catalog_products set name = $2, name_bg = $3, description = $4, description_bg = $5, category_id = $6, pack = $7, pack_bg = $8,
              names = $9::jsonb where id = $1 returning id`,
      [val(fd, "id"), val(fd, "name"), opt(fd, "name_bg"), opt(fd, "description"), opt(fd, "description_bg"), opt(fd, "category_id"),
       opt(fd, "pack"), opt(fd, "pack_bg"), JSON.stringify(names)]);
    if (!rows.length) return { error: t.catalog.imageNotAllowed };
  } catch (e) {
    return { error: text(e) };
  }
  revalidatePath("/catalog", "layout");
  return { ok: true, message: t.catalog.saved };
}

const IMAGE_URL = /^\/api\/catalog-image\/([0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z]{3,4})$/;

/**
 * Admin puts a new picture on a product (owner, Nov 2026): kept in Storage, the old uploaded one is removed.
 * Who may do it is the write rule of catalog_products: the file is removed again when the update is refused.
 */
export async function uploadCatalogImage(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const C = t.catalog;
  const id = val(fd, "id");
  const file = fd.get("image");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(file instanceof File) || file.size === 0) return { error: C.imageMissing };
  if (file.size > MAX_FILE_BYTES) return { error: C.imageTooLarge };
  const key = newCatalogImagePath(id.toLowerCase(), file.type);
  if (!key) return { error: C.imageType };
  let old: string | null = null;
  try {
    await putFile(CATALOG_BUCKET, key, Buffer.from(await file.arrayBuffer()), file.type);
    const saved = await withUser(user.id, async (tx) => {
      const before = (await tx.query<{ image: string | null }>("select image from catalog_products where id = $1 for update", [id])).rows[0];
      const done = (await tx.query("update catalog_products set image = $2 where id = $1 returning id", [id, `/api/catalog-image/${key}`])).rows.length;
      old = before?.image ?? null;
      return done > 0;
    });
    if (!saved) {
      await removeFile(CATALOG_BUCKET, key);
      return { error: C.imageNotAllowed };
    }
  } catch (e) {
    await removeFile(CATALOG_BUCKET, key).catch(() => {});
    return { error: text(e) };
  }
  const oldKey = (old as string | null)?.match(IMAGE_URL)?.[1];
  if (oldKey) await removeFile(CATALOG_BUCKET, oldKey).catch(() => {});
  revalidatePath("/catalog", "layout");
  return { ok: true, message: C.imageSaved };
}

/** Admin takes the picture off: the open catalogue shows the empty jar or pouch again. */
export async function removeCatalogImage(fd: FormData) {
  const { user } = await getSession();
  const id = val(fd, "id");
  const old = await withUser(user.id, async (tx) => {
    const before = (await tx.query<{ image: string | null }>("select image from catalog_products where id = $1 for update", [id])).rows[0];
    const done = (await tx.query("update catalog_products set image = null where id = $1 returning id", [id])).rows.length;
    return done ? before?.image ?? null : null;
  });
  const oldKey = old?.match(IMAGE_URL)?.[1];
  if (oldKey) await removeFile(CATALOG_BUCKET, oldKey).catch(() => {});
  revalidatePath("/catalog", "layout");
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

/** The whole public list at once: one ingredient on a line, group | name. */
export async function saveIngredientList(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const rows = val(fd, "list").split("\n").map((l) => l.split("|").map((p) => p.trim())).filter((r) => r.length === 2 && r[1]);
  try {
    await withUser(user.id, async (tx) => {
      await tx.query("delete from catalog_ingredient_list where true");
      await tx.query(
        "insert into catalog_ingredient_list (grp, name, sort_order) select x ->> 0, x ->> 1, 10 from jsonb_array_elements($1::jsonb) x on conflict do nothing",
        [JSON.stringify(rows)]);
    });
  } catch (e) {
    return { error: text(e) };
  }
  revalidatePath("/catalog", "layout");
  return { ok: true, message: t.catalog.saved };
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
