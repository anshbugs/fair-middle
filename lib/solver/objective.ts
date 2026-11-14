import type { Objective, Score } from "../types";

/** Score one destination column of a durations matrix (rows = participants). Null if anyone cannot reach it. */
export function scoreColumn(durations: (number | null)[][], k: number, objective: Objective): Score | null {
  const col: number[] = [];
  for (const row of durations) {
    const v = row[k];
    if (v == null || !Number.isFinite(v)) return null;
    col.push(v);
  }
  const worst = Math.max(...col);
  const total = col.reduce((a, b) => a + b, 0);
  const spread = worst - Math.min(...col);
  return { worst, total, spread, col, key: objective === "total" ? total : worst };
}

/** Lower key wins; ties broken by total, then by spread. */
export function better(a: Score, b: Score | null): boolean {
  if (!b) return true;
  if (a.key !== b.key) return a.key < b.key;
  if (a.total !== b.total) return a.total < b.total;
  return a.spread < b.spread;
}

export function argbest(scores: (Score | null)[]): number {
  let best = -1;
  scores.forEach((s, k) => {
    if (s && better(s, best < 0 ? null : scores[best])) best = k;
  });
  return best;
}
