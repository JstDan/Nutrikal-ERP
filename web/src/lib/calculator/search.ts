/** Case-insensitive match where every typed word must appear somewhere in the text ("magn bis" → "Magnesium Bisglycinate"). */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLocaleLowerCase();
  if (query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every((token) => haystack.includes(token))) return true;
  // Product codes typed without their dashes or spaces ("ntl th101", "TH-101" for NTL-TH101)
  const flat = (s: string) => s.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  const q = flat(query);
  return q.length >= 3 && /\d/.test(q) && text.split(/\s+/).some((word) => flat(word).includes(q));
}
