# Opening stock review

Review list for the data loaded by `opening_stock.sql` from the Google Sheet "Supplements Inventory"
(sheet FoodSupplements, read on 27 Oct 2026). **Run on Supabase on 27 Oct 2026** at location NK-WH.
From now on the ERP is the source of stock: fix rows below in the app (stock correction, item edit),
not in the sheet.

**Result:** 163 items (160 raw materials, 3 excipients), 35 suppliers, 144 opening lots OB-1xxx
(released) with 144 opening_balance movements, 4 780.923 kg, stock value €57 034.56.

## Cleaned while generating

- **Harpagophytum Extract (Devil's claw)** (−1.225) and **Milk thistie Extract** (−0.725) — negative quantity
  in the sheet → imported with no stock. Count them and post a correction.
- **Lutein** — average price 0.35 (the quantity pasted into the price column) → the best price €12.98 was used.
- **Glycine** — a price in the supplier column → no supplier.
- Suppliers "#N/A" / "#NAME?" → no supplier.
- "Tilia Cemical VEMO" merged into **Tilia Chemical**; "Microstaline Cellulose" imported as an excipient.

## Rows to check

- **L-Selenomethionine** — price €0.43/kg, far too low for a selenium source.
- **Sea Salt** — price €0.25/kg (possible, but check).
- 16 ingredients have stock but **no price** (they add nothing to stock value): Coconut Type Nat Flavouring,
  Dandelion Extract, DigeZyme, DNF-10, Fava Bean Protein, Fumed Silica, Glucosyl Steviol E5, L-Choline Bitartrate,
  Lacto Spore 100 Billion Units/Gm, Magnesium Citrate / bezwodny, Monk Fruit, Oryza GEL 350, Oryza NAT H200R8,
  Polygonum cuspidatum Ex 98% Tran-Resveratril, Stevia Extractn Andromeda, Какао Алкализирано.
- **ATR - Adenosine Triphosphate** — probably "ATP" (typo). No stock.
- Names with typos kept as in the sheet (Milk thistie, Blessed tistle, Fish Oill, Stevia Extractn, Microstaline) —
  correct them on the item.

## Also worth knowing

- Every item has Novel Food status "unknown" and no Bulgarian name — check both before using it in an approved formula.
- Only 1 item has a minimum stock (reorder level); the rest show as "ok" until you set one.
- If the stock is physically at the partner facility, move it with a transfer (NK-WH → PF-RM).
