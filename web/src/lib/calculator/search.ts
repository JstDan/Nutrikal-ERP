/** Case-insensitive match where every typed word must appear somewhere in the text ("magn bis" → "Magnesium Bisglycinate"). */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}
