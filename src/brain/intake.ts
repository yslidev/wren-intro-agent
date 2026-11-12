/**
 * Intake: how Wren gets to know a candidate and a role, like a good agency recruiter, or an anthropologist.
 *
 * The method (see docs/intake.md):
 *  1. Take the artifact first (resume / JD), so nobody repeats what's already written down.
 *  2. Then ask for stories, not adjectives. "Walk me through the last time..." beats "are you a self-starter?".
 *  3. Ask about failure and friction on purpose; that's where the real fit signal lives.
 *  4. Mirror each side: what the candidate needs to hear about the role is what we ask the employer, and vice versa.
 *  5. Practical constraints last, once there's trust.
 *
 * EDIT ME: these question banks are meant to be tuned. Each question names the field it fills, so the matching
 * and the intro copy keep working when wording changes. Tests rely on the words "proudest" and "leave".
 */

export interface IntakeQuestion {
  key: string;
  ask: string;
  /** What we're actually listening for. Shown in docs and given to Claude so follow-ups stay on target. */
  listenFor: string;
}

/** Candidate side. Wren asks these after reading the resume. */
export const CANDIDATE_QUESTIONS: IntakeQuestion[] = [
  {
    key: "proudest",
    ask: "Walk me through the work you're proudest of from the last couple of years. What was broken before you touched it?",
    listenFor: "a concrete before/after, their actual role vs. the team's, the scale, and how they talk about other people",
  },
  {
    key: "energy",
    ask: "What kind of problem makes you lose track of time? And what kind quietly drains you?",
    listenFor: "the work they'd do unpaid vs. the work that burns them out; this is what 'good at' vs. 'good for' turns on",
  },
  {
    key: "whyLeave",
    ask: "What would actually make you leave where you are now?",
    listenFor: "the real push (manager, scope, money, mission, pace), stated plainly; it predicts what will make them stay",
  },
  {
    key: "practical",
    ask: "Practical stuff, so I never waste your time: lowest base salary you'd take, and remote, hybrid or in office?",
    listenFor: "pay floor and setup; hard filters, never negotiated by Wren",
  },
];

/** Hiring side. Wren asks these after reading the JD. */
export const ROLE_QUESTIONS: IntakeQuestion[] = [
  {
    key: "success",
    ask: "Picture this person 90 days in, and it went great. What did they ship or change?",
    listenFor: "the actual outcome, which is usually different from the JD's list of requirements",
  },
  {
    key: "antiPattern",
    ask: "Has someone done this job before, here or anywhere, and it didn't work out? What was missing?",
    listenFor: "the real must-have, learned the hard way; the line in the JD that actually matters",
  },
  {
    key: "pitch",
    ask: "What's the honest pitch, and the honest catch? Why would someone great take this, and what might scare them off?",
    listenFor: "what to tell candidates up front; candor here is what makes a warm intro trustworthy",
  },
  {
    key: "practical",
    ask: "Last one, the practical stuff: base range, equity, and remote, hybrid or in office?",
    listenFor: "band, equity and setup; shared with the candidate before anyone meets",
  },
];

// ---------------------------------------------------------------- parsing the artifacts

/** "Senior PM at Corvid", "6 years" etc. from a pasted resume or LinkedIn summary. Best-effort, rules only. */
export function parseResume(text: string): { title?: string; years?: number } {
  const years = text.match(/(\d{1,2})\+?\s*(?:years?|yrs?)\b/i);
  const titleLine = text.split(/\n|\. /).map((l) => l.trim()).find((l) =>
    /\b(engineer|developer|designer|product manager|pm|scientist|analyst|recruiter|account executive|founder|lead|head of|director|chief)\b/i.test(l) && l.length < 90);
  const title = titleLine?.replace(/^[-•*\s]+/, "").replace(/[,;(]?\s*\d{1,2}\+?\s*(years?|yrs?)\b.*$/i, "").trim();
  return { title: title || undefined, years: years ? Number(years[1]) : undefined };
}

/** Role title, band and setup from a pasted JD. */
export function parseJD(text: string): { roleTitle?: string; bandK?: [number, number]; equity?: string; setup?: string } {
  const titleLine = text.split(/\n|\. /).map((l) => l.trim()).find((l) =>
    /\b(engineer|developer|designer|pm|product manager|scientist|analyst|account executive|lead|head of|chief of staff|advocate|marketer|researcher)\b/i.test(l) && l.length < 80);
  const band = text.match(/\$?\s?(\d{2,3})\s?k?\s?(?:-|–|to)\s?\$?\s?(\d{2,3})\s?k/i);
  const equity = text.match(/(\d+(?:\.\d+)?(?:\s?-\s?\d+(?:\.\d+)?)?\s?%)\s*(?:equity)?/i);
  const setup = /\bremote\b/i.test(text) ? "remote" : /\bhybrid\b/i.test(text) ? "hybrid" : /on-?site|in[- ]office/i.test(text) ? "onsite" : undefined;
  return {
    roleTitle: titleLine?.replace(/^(we'?re hiring|hiring|role|title)[:\s-]*/i, "").split(/[,(—–-]\s/)[0].trim(),
    bandK: band ? [Number(band[1]), Number(band[2])] : undefined,
    equity: equity?.[1].replace(/\s/g, ""),
    setup,
  };
}

/** Does this sound like someone hiring (vs. someone looking)? */
export const soundsLikeHiring = (t: string) =>
  /\b(hiring|recruit\w*|we need|looking for (a|an|someone)|open role|headcount|jd|job description|our team|my team|for my startup|on behalf of)\b/i.test(t);

export const soundsLikeSkip = (t: string) => /^(skip|no|nah|nope|later|don'?t have one|not now)[.! ]*$/i.test(t.trim());
