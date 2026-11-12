import type { Intro, Person } from "../types.js";

/**
 * `reasons` are templates, so the same reason can be said to the candidate ("you have done exactly that")
 * or about them ("Alex has done exactly that"). Render with `renderReasons`.
 */
export interface MatchResult { founder: Person; score: number; reasons: string[] }

/** "payments, onboarding and growth" */
export const joinList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Render reason templates for "you" (talking to the candidate) or a name/label (talking about them). */
export function renderReasons(reasons: string[], who: string, max = reasons.length): string {
  const you = who === "you";
  const parts = reasons.slice(0, max).map((r) => r
    .replace(/\{Cs\}/g, you ? "your" : `${who}'s`)
    .replace(/\{C\}/g, who)
    .replace(/\{has\}/g, you ? "have" : "has")
    .replace(/\{wants\}/g, you ? "want" : "wants"));
  const s = parts.length > 1 ? `${parts.slice(0, -1).join("; ")}; and ${parts.at(-1)}` : parts[0] ?? "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The bar a friend uses: only make the intro if it's clearly good. */
export const MIN_SCORE = 4;
/** A friend wouldn't suggest a match on one shared buzzword. */
export const MIN_OVERLAP = 2;

type Family = "eng" | "design" | "pm" | "gtm" | "data" | "ops";
const FAMILIES: [Family, RegExp][] = [
  ["pm", /\b(pm|product manager|product lead|head of product)\b/i],
  ["design", /\bdesign(er)?\b/i],
  ["data", /\b(data scientist|analyst|analytics)\b/i],
  ["gtm", /\b(account executive|sales|growth|marketing|advocate|devrel|gtm)\b/i],
  ["ops", /\b(chief of staff|operations|bizops|ops)\b/i],
  ["eng", /\b(engineer|developer|swe|ios|android|backend|frontend|full-?stack|ml)\b/i],
];
/** The kind of job a title describes, or undefined if we can't tell (then we don't filter on it). */
export function family(title = ""): Family | undefined {
  return FAMILIES.find(([, re]) => re.test(title))?.[0];
}

/** Employer-initiated: the same rules, run from the role's side. Candidates still in intake are skipped. */
export function rankCandidates(f: Person, people: Person[], intros: Intro[]): { candidate: Person; score: number; reasons: string[] }[] {
  const already = new Set(intros.filter((i) => i.founderId === f.id).map((i) => i.candidateId));
  const out: { candidate: Person; score: number; reasons: string[] }[] = [];
  for (const c of people) {
    if (c.role !== "candidate" || c.stage !== "ready" || already.has(c.id) || c.optedOut) continue;
    const r = rankFounders(c, [f], [])[0];
    if (r) out.push({ candidate: c, score: r.score, reasons: r.reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Hard filters first (role family, pay, setup, real skill overlap), then a small score. Deliberately simple and
 * explainable: every point has a sentence attached, and those sentences become Wren's "why you two".
 */
export function rankFounders(c: Person, people: Person[], intros: Intro[]): MatchResult[] {
  const cp = c.candidate;
  if (!cp) return [];
  const already = new Set(intros.filter((i) => i.candidateId === c.id).map((i) => i.founderId));
  const cFam = family(cp.title);
  const out: MatchResult[] = [];
  for (const f of people) {
    const fp = f.founder;
    if (f.role !== "founder" || !fp || already.has(f.id)) continue;
    const fFam = family(fp.roleTitle);
    if (cFam && fFam && cFam !== fFam) continue;
    const reasons: string[] = [];
    let score = 0;
    const overlap = fp.mustHaves.filter((m) => cp.skills.includes(m));
    if (overlap.length < MIN_OVERLAP) continue;
    score += overlap.length * 2;
    reasons.push(`${f.first} needs ${joinList(overlap)}, and {C} {has} done exactly that`);
    if (cp.floorK !== undefined) {
      if (fp.bandK[1] < cp.floorK) continue;
      if (fp.bandK[0] >= cp.floorK) {
        score += 2;
        reasons.push(`the band ($${fp.bandK[0]}-${fp.bandK[1]}K) clears {Cs} $${cp.floorK}K floor`);
      } else {
        score += 1;
        reasons.push(`the band ($${fp.bandK[0]}-${fp.bandK[1]}K) reaches {Cs} $${cp.floorK}K floor`);
      }
    }
    if (cp.setups?.length) {
      if (!cp.setups.includes(fp.setup)) continue;
      reasons.push(`it's ${fp.setup}, which {C} {wants}`);
    }
    if (cp.stages?.length && cp.stages.includes(fp.stage)) {
      score += 1;
      reasons.push(`${fp.stage} is in {Cs} range`);
    }
    out.push({ founder: f, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}
