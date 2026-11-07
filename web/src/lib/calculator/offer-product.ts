// What a product of an offer is, as written on the offer and in Schedule A of a contract: what is in a pack,
// how it is packed, one serving and the composition per serving. No prices. Pure (no jsPDF): also runs on the server.
import { fmt } from '@/lib/i18n';
import { hasAluminiumCap, type CalcResult } from './calc';
import { formatNumber, parseNum } from './numbers';
import { hasAluminiumLid, offerCapsules, offerServings } from './catalogCapsules';
import { OFFER_TEXT, type OfferLang } from './offer-text';
import { CAPSULE_SIZE, isCapsule, type OfferForm } from './types';

export type OfferProduct = { pack: string; format: string; dosePortion: string; doseRows: { name: string; amount: string }[] };

/** `composition: 'always'` lists it also when the offer itself left it out (a contract states what is made). */
export function offerProduct(form: OfferForm, result: CalcResult, lang: OfferLang, o: { composition?: 'always' } = {}): OfferProduct {
  const PDF = OFFER_TEXT[lang];
  const catalog = form.mode === 'catalog' ? form.catalog : null;
  const type = form.productType ?? 'powder';
  const capsule = isCapsule(type);
  const perUnit = form.quantityPerUnit;
  const catalogCaps = offerCapsules(form);
  const doseG = result.doseWeightMg / 1000;
  const caps = parseNum(form.capsulesPerDose) ?? 1;
  const servings = result.dosesPerUnit !== null ? formatNumber(result.dosesPerUnit, 2) : '–';
  let pack: string;
  let format: string;
  if (catalog) {
    const catalogServings = offerServings(form);
    pack = catalogCaps ? [`${catalogCaps} ${PDF.capsules}`, ...(catalogServings ? [`${formatNumber(catalogServings, 2)} ${PDF.servings}`] : [])].join(', ') : '';
    format = catalogCaps ? `${PDF[form.jar === 'glass' ? 'packaging_capsules_glass' : 'packaging_capsules_plastic']}${hasAluminiumLid(form) ? ` ${PDF.aluminiumLid}` : ''}` : '';
  } else if (capsule) {
    pack = `${perUnit} ${PDF.capsules}, ${servings} ${PDF.servings}`;
    format = `${PDF[`packaging_${type}`]}${hasAluminiumCap(form) ? ` ${PDF.aluminiumLid}` : ''}, ${fmt(PDF.size, { s: CAPSULE_SIZE.replace('size', '').trim() })}`;
  } else {
    const net = result.netWeightPerPouchG;
    pack = [net ? `${formatNumber(net, 0)} g` : '', `${servings} ${PDF.servings}`].filter(Boolean).join(', ');
    format = PDF.doypack;
  }
  const portion = (n: number) => `${formatNumber(n, 2)} ${n === 1 ? PDF.capsule : PDF.capsules}`;
  // A catalog product brings its own serving and composition from the product catalogue
  const dosePortion = catalog
    ? catalog.capsules_per_serving ? portion(catalog.capsules_per_serving) : catalog.serving_g ? `${formatNumber(catalog.serving_g, 2)} g` : PDF.oneServing
    : capsule ? portion(caps) : `${formatNumber(doseG, 2)} g`;
  const doseRows = !form.includeComposition && o.composition !== 'always'
    ? []
    : catalog
      ? (catalog.composition ?? [])
          .filter((i) => i.amount > 0)
          .map((i) => ({ name: i.note ? `${i.name} (${i.note})` : i.name, amount: `${formatNumber(i.amount, 4)} ${i.unit}` }))
      : form.rows
          .filter((r) => (parseNum(r.amount) ?? 0) > 0)
          .map((r) => ({ name: r.name, amount: `${formatNumber(parseNum(r.amount) ?? 0, 4)} ${r.unit}` }));
  return { pack, format, dosePortion, doseRows };
}
