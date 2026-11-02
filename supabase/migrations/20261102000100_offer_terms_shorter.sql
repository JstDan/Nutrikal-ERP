-- The standard offer terms repeated what the offer says under Included, and a validity of
-- 14 business days against the date printed in its head. Shorter text (owner, Nov 2026);
-- a text edited under Settings stays as it is.
alter table public.calc_settings alter column terms_text
  set default 'The prices are EUR/EXW, for finished, ready-to-sell products. MOQ to be confirmed upon order.';

update public.calc_settings
   set terms_text = 'The prices are EUR/EXW, for finished, ready-to-sell products. MOQ to be confirmed upon order.'
 where terms_text = 'The prices are EUR/EXW excl. VAT, for the finished, ready-to-sell products and include raw materials, primary packaging materials, mixing, quality assurance, encapsulation where applicable, filling, sealing, capping where applicable, label and foil printing with basic effects, label application and shipment preparation. Lead time and MOQ to be confirmed upon order. This offer is valid for 14 business days.';
