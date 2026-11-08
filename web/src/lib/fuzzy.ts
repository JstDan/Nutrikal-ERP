// Smart search (owner, Nov 2026): finds a raw material, client or product whether it is typed in Cyrillic or Latin,
// and with a letter wrong or missing. The same rules live in the database (nk_search_key / nk_search_score,
// migration 20261108000300), so a list filtered in the browser and one searched on the server agree.

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "s", ч: "ch", ш: "sh", щ: "sht",
  ъ: "a", ы: "i", ь: "i", э: "e", ю: "iu", я: "ia", є: "e", і: "i", ї: "i", ґ: "g",
};

/**
 * A sound-alike key: Cyrillic written in Latin letters, accents dropped, and the letters that sound alike made one
 * (c before e/i/y and ц → s, c/q → k, z → s, ph → f, th → t, w → v, y/j → i, doubled letters once). Both the name and
 * what is typed go through it, so "цитрулин" meets "Citrulline" and "глицинат" meets "Glycinate".
 */
export function searchKey(text: string): string {
  let s = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  // A lone ц is the letter C (vitamin C), not the sound
  s = s.replace(/(^|[^а-яёєіїґ])ц(?![а-яёєіїґ])/g, "$1c");
  s = s.replace(/[а-яёєіїґ]/g, (c) => CYR[c] ?? c);
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/ph/g, "f").replace(/th/g, "t").replace(/sch/g, "sh").replace(/qu/g, "kv").replace(/x/g, "ks");
  s = s.replace(/c([eiy])/g, "s$1").replace(/(?<=[a-z0-9])c|c(?=[a-z0-9])/g, "k").replace(/q/g, "k").replace(/z/g, "s").replace(/w/g, "v").replace(/[yj]/g, "i");
  s = s.replace(/([a-z])\1+/g, "$1");
  return s.trim().replace(/\s+/g, " ");
}

/** The three-letter pieces of a word, padded like PostgreSQL's pg_trgm ("  w", " wo", "wor", …). */
function trigrams(word: string): Set<string> {
  const p = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** The letters to change, add or drop to turn one word into the other. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Wrong letters allowed in a typed word: none up to 3 letters, one from 4, two from 8. */
const allowed = (n: number) => (n >= 8 ? 2 : n >= 4 ? 1 : 0);

/**
 * How a typed word fits a text: 1 when it is part of it; a short word (1-2 letters) only as the start of a word;
 * else 0.8 when a word of the text (or its start) is a letter or two away, or the share of its three-letter pieces.
 */
function wordScore(word: string, hay: string, hayWords: string[]): number {
  if (word.length < 3) return hayWords.some((w) => w.startsWith(word)) ? 1 : 0;
  if (hay.includes(word)) return 1;
  const mine = trigrams(word);
  const max = allowed(word.length);
  let best = 0;
  for (const w of hayWords) {
    // A wrong letter or two, but never the first one ("pink" is not "sink")
    if (max && w[0] === word[0] && (distance(word, w) <= max || distance(word, w.slice(0, word.length)) <= max)) best = Math.max(best, 0.8);
    const theirs = trigrams(w);
    let n = 0;
    for (const t of mine) if (theirs.has(t)) n++;
    best = Math.max(best, n / mine.size);
  }
  return best;
}

/** 0 to 1: how well the text answers what was typed; every typed word has to fit (the weakest counts). */
export function searchScore(text: string, query: string): number {
  const q = searchKey(query);
  if (!q) return 0;
  const hay = searchKey(text);
  if (hay.includes(q)) return 1;
  const words = hay.split(" ");
  return Math.min(...q.split(" ").map((w) => wordScore(w, hay, words)));
}

/** Enough of a fit to show (a wrong or missing letter in a word still passes). */
export const SEARCH_MIN = 0.6;

export const fuzzyMatch = (text: string, query: string) => searchScore(text, query) >= SEARCH_MIN;
