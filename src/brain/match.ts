import type { Intro, Person } from "../types.js";

export interface MatchResult { founder: Person; score: number; reasons: string[] }

/** The bar a friend uses: only make the intro if it's clearly good. */
export const MIN_SCORE = 4;

/**
 * Hard filters first (pay, setup), then a small score. Deliberately simple and explainable:
 * every point has a sentence attached, and those sentences become Wren's "why you two".
 */
export function rankFounders(c: Person, people: Person[], intros: Intro[]): MatchResult[] {
  const cp = c.candidate;
  if (!cp) return [];
  const already = new Set(intros.filter((i) => i.candidateId === c.id).map((i) => i.founderId));
  const out: MatchResult[] = [];
  for (const f of people) {
    const fp = f.founder;
    if (f.role !== "founder" || !fp || already.has(f.id)) continue;
    const reasons: string[] = [];
    let score = 0;
    const overlap = fp.mustHaves.filter((m) => cp.skills.includes(m));
    if (!overlap.length) continue;
    score += overlap.length * 2;
    reasons.push(`${f.first} needs ${overlap.join(", ")}, which ${c.first} has done`);
    if (cp.floorK !== undefined) {
      if (fp.bandK[1] < cp.floorK) continue;
      if (fp.bandK[0] >= cp.floorK) {
        score += 2;
        reasons.push(`pays $${fp.bandK[0]}-${fp.bandK[1]}K, at or above ${c.first}'s $${cp.floorK}K floor`);
      } else {
        score += 1;
        reasons.push(`band $${fp.bandK[0]}-${fp.bandK[1]}K overlaps ${c.first}'s $${cp.floorK}K floor`);
      }
    }
    if (cp.setups?.length) {
      if (!cp.setups.includes(fp.setup)) continue;
      reasons.push(`${fp.setup}, which ${c.first} wants`);
    }
    if (cp.stages?.length && cp.stages.includes(fp.stage)) {
      score += 1;
      reasons.push(`${fp.stage}, in ${c.first}'s stage range`);
    }
    out.push({ founder: f, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}
