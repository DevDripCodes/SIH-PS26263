// Name similarity for APAAR demographic matching. Order-insensitive (Indian names are often
// written surname-first in one system and last in another) and tolerant of initials/titles.

const TITLES = new Set(["MR", "MRS", "MS", "MISS", "DR", "SHRI", "SMT", "KUM", "KUMARI", "SRI"]);

function tokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pool = new Map<string, number>();
  for (const g of bigrams(a)) pool.set(g, (pool.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of bigrams(b)) {
    const n = pool.get(g);
    if (n) {
      overlap++;
      pool.set(g, n - 1);
    }
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

/** 0..1, rounded to 3 decimals to fit staging.abc_name_similarity NUMERIC(4,3). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a).sort().join(" ");
  const tb = tokens(b).sort().join(" ");
  if (!ta || !tb) return 0;
  return Math.round(dice(ta, tb) * 1000) / 1000;
}

export const NAME_MATCH_THRESHOLD = 0.8;
