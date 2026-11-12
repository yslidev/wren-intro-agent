/** Deterministic language helpers. Used when no Claude credentials are set, and as guardrails around the LLM. */

export type Intent = "yes" | "no" | "more" | "other";

const YES = /\b(yes|yeah|yep|yup|sure|ok(ay)?|sounds (good|great)|let'?s (do it|go|talk)|intro me|i'?m in|down|absolutely|for sure|works( for me)?|love (to|that)|please do|go ahead|looks (right|good|great)|perfect|send it)\b/i;
const NO = /\b(no|nope|nah|not (for me|interested|(right )?now|at the moment|a fit|really)|pass|skip|decline|don'?t think so|i'?ll pass)\b/i;
const MORE = /(\?|\b(more|details|tell me|who is|what'?s|why|how big|which)\b)/i;

export function intent(text: string): Intent {
  const t = text.trim();
  const no = NO.test(t) && !/\bno (problem|worries)\b/i.test(t);
  if (no) return "no";
  if (YES.test(t)) return "yes";
  if (MORE.test(t)) return "more";
  return "other";
}

export function extractFloorK(text: string): number | undefined {
  const k = text.match(/\$?\s?(\d{2,3})(?:\.\d)?\s?k\b/i);
  if (k) return Number(k[1]);
  const full = text.match(/\$?\s?(\d{3}),?000\b/);
  if (full) return Number(full[1]);
  return undefined;
}

export function extractSetups(text: string): string[] {
  const out = new Set<string>();
  if (/remote/i.test(text)) out.add("remote");
  if (/hybrid/i.test(text)) out.add("hybrid");
  if (/on-?site|in[- ]office|in person|5 days/i.test(text)) out.add("onsite");
  return [...out];
}

export function extractStages(text: string): string[] {
  const out = new Set<string>();
  if (/\bseed\b/i.test(text)) out.add("seed");
  for (const l of ["a", "b", "c"]) if (new RegExp("series\\s*" + l + "\\b", "i").test(text)) out.add("series " + l);
  return [...out];
}

export const mentionsAgent = (text: string, name = "wren") =>
  new RegExp("(^|[^a-z])@?(" + name + "|wrenn|bot|assistant)\\b", "i").test(text);

const DAY = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b/i;
const TIME = /\b(\d{1,2})(:\d{2})?\s?(am|pm)\b/i;
const AGREE = /\b(works|confirmed|booked|see you|locked( in)?|sent (you )?(an )?invite|let'?s do)\b/i;

/** Returns a slot like "Thu 10:00 AM PT" when a message agrees to a concrete time (a question proposing times doesn't count). */
export function agreedSlot(text: string, offered: string[] = []): string | undefined {
  if (!AGREE.test(text) || /\?\s*$/.test(text.trim())) return undefined;
  const day = text.match(DAY)?.[0];
  const hour = text.match(TIME)?.[1] ?? text.match(/\b(\d{1,2})(:\d{2})?\b/)?.[1];
  const hit = offered.find((s) => {
    const sd = s.match(DAY)?.[0];
    const sh = s.match(/\b(\d{1,2})(:\d{2})?/)?.[1];
    return sd && sh && day && sd.slice(0, 3).toLowerCase() === day.slice(0, 3).toLowerCase() && sh === hour;
  });
  if (hit) return hit;
  const t = text.match(TIME)?.[0];
  if (day && t) return day[0].toUpperCase() + day.slice(1, 3).toLowerCase() + " " + t.toUpperCase();
  return undefined;
}

/** Carrier opt-out keywords, matched the way Linq does: the whole trimmed message, any case, space/hyphen optional. */
export const isOptOut = (text: string) => /^(stop|unsubscribe|opt[\s-]?out|cancel|end|quit)$/i.test(text.trim().replace(/[.!]+$/, ""));

export const isSmallTalkAck = (text: string) => /^(thanks|thank you|ty|tysm|lol|haha+|love it|amazing|yay|🙏|❤️|👍)[!. ]*$/i.test(text.trim());
