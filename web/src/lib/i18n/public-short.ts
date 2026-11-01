import type { AnyLocale } from "@/lib/i18n";

// Short category names, only for the filter buttons of the open catalog. Headings keep the full name.
const NAMES = [
  "Targeted Health Formulas", "Lifestyle & Functional Concepts", "Essential Nutrients & Core Actives", "Mushroom & Adaptogen Extract", "Collagen Products",
  "Metabolic & Weight Management", "Sport & Performance Nutrition", "Premium Blends", "Women’s Health", "Men’s Health & Sexual Wellness",
  "Digestive & Gut Health", "Heart & Circulation", "Bones, Joints & Mobility", "Longevity & Cellular Health", "Liposomal Formulations", "Healthy Ageing 50+",
  "Protein Bars, Brownies and Cookies",
];
const SHORT: Record<AnyLocale, string[]> = {
  en: ["Targeted Formulas", "Lifestyle", "Essential Nutrients", "Mushrooms", "Collagen", "Weight Management", "Sport", "Premium Blends", "Women’s Health", "Men’s Health", "Gut Health", "Heart", "Bones & Joints", "Longevity", "Liposomal", "50+", "Bars & Cookies"],
  bg: ["Целеви формули", "Лайфстайл", "Нутриенти", "Гъби", "Колаген", "Метаболизъм", "Спорт", "Премиум смеси", "Женско здраве", "Мъжко здраве", "Храносмилане", "Сърце", "Кости и стави", "Дълголетие", "Липозомни", "50+", "Барове и бисквити"],
  de: ["Gezielte Formeln", "Lifestyle", "Nährstoffe", "Pilze", "Kollagen", "Stoffwechsel", "Sport", "Premium", "Frauen", "Männer", "Darm", "Herz", "Knochen und Gelenke", "Langlebigkeit", "Liposomal", "50+", "Riegel und Cookies"],
  fr: ["Formules ciblées", "Lifestyle", "Nutriments", "Champignons", "Collagène", "Métabolisme", "Sport", "Premium", "Femme", "Homme", "Digestion", "Cœur", "Os et articulations", "Longévité", "Liposomal", "50+", "Barres et cookies"],
  it: ["Formule mirate", "Lifestyle", "Nutrienti", "Funghi", "Collagene", "Metabolismo", "Sport", "Premium", "Donna", "Uomo", "Digestione", "Cuore", "Ossa e articolazioni", "Longevità", "Liposomiali", "50+", "Barrette e cookie"],
  ro: ["Formule țintite", "Lifestyle", "Nutrienți", "Ciuperci", "Colagen", "Metabolism", "Sport", "Premium", "Femei", "Bărbați", "Digestie", "Inimă", "Oase și articulații", "Longevitate", "Lipozomale", "50+", "Batoane și biscuiți"],
  el: ["Στοχευμένες", "Lifestyle", "Θρεπτικά", "Μανιτάρια", "Κολλαγόνο", "Μεταβολισμός", "Αθλητισμός", "Premium", "Γυναίκα", "Άνδρας", "Πέψη", "Καρδιά", "Οστά και αρθρώσεις", "Μακροζωία", "Λιποσωμικά", "50+", "Μπάρες και μπισκότα"],
};

export const shortCategories = (locale: AnyLocale): Record<string, string> =>
  Object.fromEntries(NAMES.map((name, i) => [name, SHORT[locale][i]]));
