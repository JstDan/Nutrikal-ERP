import { fuzzyMatch } from "@/lib/fuzzy";

/** Case-insensitive match where every typed word must appear somewhere in the text ("magn bis" → "Magnesium Bisglycinate"). */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLocaleLowerCase();
  if (query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every((token) => haystack.includes(token))) return true;
  // Product codes typed without their dashes or spaces ("ntl th101", "TH-101" for NTL-TH101)
  const flat = (s: string) => s.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  const q = flat(query);
  if (q.length >= 3 && /\d/.test(q) && text.split(/\s+/).some((word) => flat(word).includes(q))) return true;
  // Smart search (owner, Nov 2026): Cyrillic or Latin, a letter wrong or missing ("цитрулин" → Citrulline)
  return fuzzyMatch(text, query);
}
