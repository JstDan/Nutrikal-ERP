# Opening stock review

Review list from the Nutrikal Inventory app for the data loaded by `opening_stock.sql`. Nothing below was changed
automatically — fix the data in `opening_stock.sql` before running it, or the item in the app afterwards.

**Ingredients seeded:** 142 (125 with opening stock, 17 with no stock)

## Supplier names merged

- **Astron Chemicals** ← "Astron chemical" (1), "Astron Chemical" (1), "Astron chemicals" (4)
- **Tilia Chemical** ← "Tilia chemical" (2), "Tilia Chemical VEMO" (1)
- **Shaanxi Jiahe Phytochem Co Ltd** ← "Shaanxi Jiahe Phytochem" (1), "Shaanxi Jiahe Phytochem Co Ltd" (11)

## Rows to check

- **Lutein** — avg price 0.35 equals the quantity and is far below best price 12.98 — the qty was probably pasted into the price column.
- **Apigenin / Bamboo Brown Extract** — identical qty 12.5, avg price 23.5 and supplier "SRS Nutrition Express" — likely a copy-paste; check the real stock of each.
- **Artichoke Extract / Berberine HCI / Three Needle Ex** — identical qty 0.55, avg price 112.68 and supplier "Shaanxi Jiahe Phytochem Co Ltd" — likely a copy-paste; check the real stock of each.
- **Grape Flavour / Passionfruit Flavour** — identical qty 9.95, avg price 53 and supplier "Flavours Factory" — likely a copy-paste; check the real stock of each.
- **L-Selenomethionine / Boswellia Serrata Ex** — looks like two ingredients in one row (qty 3, no price/supplier). Split into two ingredients if so.
- **ATR - Adenosine Triphosphate** — probably "ATP - Adenosine Triphosphate" (typo). No stock or price.
- **Collagen** — possible duplicate of "Collagen Hydrolyzed" (3.03 kg @ €12.02 vs 600 kg @ €9.50).
- **Acerola Cherry Extract** — best price €30.00 is higher than avg price €6.00.
- **Boswellia 65%** — best price €26.00 is higher than avg price €22.25.
- **Fennel Seed Extract powder** — best price €8.66 is higher than avg price €8.58.
- **L-Theanine** — best price €23.00 is higher than avg price €21.50.
- **Lutein** — best price €12.98 is higher than avg price €0.35.
- **Acacia Fiber/Gum Arabica** — best price is 0.00 — probably missing rather than free.
- **Green Tea Extract (50% EGCG)** — qty 19.487 × avg €24.67 = €480.74, but total price is €480.68 (off by €0.06).
- **Magnesium Bisglycinate** — qty 72.0055 × avg €10.2 = €734.46, but total price is €734.10 (off by €0.36).

## Also worth knowing

- 29 ingredients have stock but **no price** (their opening movement has no price, so they add nothing to stock value): Chamomile Extract, Citrus Flavonoids 50%, Cordyceps Extract 30%, Corn Silk Extract, Dandelion Extract, DigeZyme, DNF-10, Enzyme Blend, Fisetin 98%, Fumed Silica, Glucosyl Steviol E5, Juniper Berry Extract, L-Selenomethionine / Boswellia Serrata Ex, Lactase 100000 ALU/gm, Magnesium Citrate, Marigold Extract (20% Lutein 4% Zeaxanthin), Nettle Root Extract, Olive Leaf Extract 20%, Pea Protein, Peppermint Leaf Extract, Probiotics Powder, Pumpkin Seed Extract, Rhodiola Rosea Extract 3%, Rice Protein, Saw Palmetto Extract, Spermidine 1%, Stevia Extract, Tributyrin Powder 60%, Vitamin B12 (1%).
- `min_stock` was empty for every row except Collagen Hydrolyzed (25), so they show as "ok" until you set a minimum.
