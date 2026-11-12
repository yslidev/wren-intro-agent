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

/** Rule-based skill tags, so matching works for real people even without Claude. Tags match data/world.json. */
const SKILL_WORDS: [string, RegExp][] = [
  ["payments", /\b(payments?|billing|invoic\w*|chargebacks?|checkout|payouts?)\b/i],
  ["fintech", /\b(fintech|bank\w*|lending|neobank|financial)\b/i],
  ["risk", /\b(fraud|risk|kyc|aml)\b/i],
  ["growth", /\b(growth|activation|retention|funnel|acquisition|conversion|churn)\b/i],
  ["onboarding", /\b(onboarding|activation|first[- ]run|time[- ]to[- ]value)\b/i],
  ["b2b", /\b(b2b|saas|merchants?|smb|customers? success)\b/i],
  ["enterprise", /\b(enterprise|procurement|fortune 500)\b/i],
  ["product", /\b(product manager|\bpm\b|roadmap|specs?|prioriti[sz]\w*|product)\b/i],
  ["analytics", /\b(analytics|dashboards?|metrics|a\/b|experiments?)\b/i],
  ["research", /\b(user research|interviews?|usability)\b/i],
  ["ml", /\b(ml|machine learning|models?|fine[- ]?tun\w*|training)\b/i],
  ["llm", /\b(llms?|gpt|claude|agents?|prompts?|rag)\b/i],
  ["evals", /\bevals?\b|\bevaluation/i],
  ["infra", /\b(infra\w*|latency|scal\w*|kubernetes|aws|gcp|platform|migrat\w*|monolith|uptime)\b/i],
  ["data", /\b(data|sql|pipelines?|warehouse|etl)\b/i],
  ["python", /\bpython\b/i],
  ["go", /\bgolang\b/i],
  ["typescript", /\b(typescript|javascript|node(\.js)?)\b/i],
  ["react", /\breact\b/i],
  ["mobile", /\b(mobile|ios|android|app store)\b/i],
  ["ios", /\b(ios|swift)\b/i],
  ["design", /\b(design\w*|figma|ux|ui)\b/i],
  ["prototyping", /\bprototyp\w*/i],
  ["brand", /\bbrand\w*/i],
  ["consumer", /\b(consumer|social|b2c)\b/i],
  ["sales", /\b(sales|closed|quota|deals?|pipeline|account executive)\b/i],
  ["gtm", /\b(gtm|go[- ]to[- ]market)\b/i],
  ["content", /\b(content|writing|blog|newsletter)\b/i],
  ["community", /\bcommunity\b/i],
  ["devtools", /\b(developers?|devtools|api|sdk|cli)\b/i],
  ["security", /\b(security|soc ?2|pentest)\b/i],
  ["compliance", /\b(compliance|hipaa|regulat\w*)\b/i],
  ["healthcare", /\b(health\w*|clinic\w*|hospital|nurses?|patients?)\b/i],
  ["workflow", /\b(workflows?|ops tooling|internal tools?)\b/i],
  ["ops", /\b(operations|ops)\b/i],
  ["logistics", /\b(logistics|shipping|freight|carriers?|dispatch)\b/i],
  ["marketplace", /\bmarketplace\b/i],
  ["climate", /\b(climate|energy|batter\w*|solar|carbon)\b/i],
  ["education", /\b(education|edtech|teachers?|students?|schools?)\b/i],
  ["commerce", /\b(e-?commerce|retail|shop\w*)\b/i],
  ["creator", /\bcreators?\b/i],
];
export function extractSkills(text: string): string[] {
  return SKILL_WORDS.filter(([, re]) => re.test(text)).map(([s]) => s);
}

/** "I'm Yushan", "it's Yushan Li", "yushan" -> { first: "Yushan", name: "Yushan Li" } */
const NOT_NAMES = /^(yo|hi|hey|hello|hiya|sup|ok|okay|yes|yeah|no|nope|lol|haha|hmm|thanks|ty|open|hiring|looking|sure|cool|nice|good|great|what|who|why|how|the|a|an|i|im|its|just|so|well|um|uh|test|ping|hello photon)$/i;
const NOT_NAME_WORDS = /\b(open|hiring|looking|job|role|new|sth|something|interested|recruit\w*|help|intros?|friend|said)\b/i;

/** Explicitly stated names ("my name is Yushan", "I'm Yushan", "call me Yu") — safe to act on mid-conversation. */
export function statedName(text: string): { first: string; name: string } | undefined {
  const t = text.trim().replace(/[.!?]+$/, "");
  const lead = String.raw`(?:my name is|my name's|call me|this is|i am|i'?m|it'?s)\s+`;
  // "it's yushan li" (two words, then the end) or "I'm Morgan, hiring for..." (one word, then a break).
  const m = t.match(new RegExp(lead + String.raw`([a-z][\w'-]*)\s+([a-z][\w'-]*)$`, "i"))
    ?? t.match(new RegExp(lead + String.raw`([a-z][\w'-]*)(?=\s*(?:[,;:—-]|$)|\s+(?:and|here|from|at|but|hiring|looking)\b)`, "i"));
  if (!m) return undefined;
  const words = [m[1], m[2]].filter((w): w is string => Boolean(w));
  if (NOT_NAMES.test(words[0]) || words.some((w) => NOT_NAME_WORDS.test(w))) return undefined;
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const parts = words.filter((w) => !NOT_NAMES.test(w)).map(cap);
  return { first: parts[0], name: parts.join(" ") };
}

export function extractName(text: string): { first: string; name: string } | undefined {
  const stated = statedName(text);
  if (stated) return stated;
  const t = text.trim().replace(/[.!?,]+$/, "");
  // A bare reply to "what should I call you?" is a name only if it looks like one: 1-3 words, no filler.
  if (/\b(i'?m|my|it'?s|this is)\b/i.test(t) || NOT_NAME_WORDS.test(t) || t.split(/\s+/).length > 3) return undefined;
  const words = t.split(/\s+/).slice(0, 2);
  if (!words.length || words[0].length > 20 || !/^[a-z]/i.test(words[0]) || NOT_NAMES.test(words[0])) return undefined;
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const parts = words.map(cap);
  return { first: parts[0], name: parts.join(" ") };
}

/** "Maya Chen sent me", "my friend Aiden", "it was Aiden Bai" -> "Aiden Bai". Undefined if it isn't a person's name. */
export function extractVoucher(text: string): string | "nobody" | undefined {
  const t = text.trim().replace(/[.!?]+$/, "");
  if (/^(nobody|no one|noone|none|myself|i found you|found you (online|on)|google|twitter|x|linkedin)\b/i.test(t)) return "nobody";
  const m = t.match(/^(?:(?:my\s+)?(?:friend|coworker|colleague|manager|old boss|boss|cofounder)\s+)?(?:it was\s+|from\s+)?([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,2})(?:\s+(?:sent|told|referred|pointed|mentioned|said)\b.*)?$/);
  const name = m?.[1] ?? (/^[a-z][\w'-]+(\s+[a-z][\w'-]+)?$/i.test(t) ? t : undefined);
  if (!name || NOT_NAMES.test(name) || NOT_NAME_WORDS.test(name) || /\b(i'?m|my|you|me)\b/i.test(name)) return undefined;
  return name.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Hiring, looking, or can't tell. */
export function readSide(text: string): "hiring" | "looking" | undefined {
  if (/\b(hiring|recruit\w*|we need|open role|headcount|jd|job description|on behalf of|for my (startup|team|company))\b/i.test(text)) return "hiring";
  if (/\b(open|looking|exploring|job ?hunting|new (role|job|thing|opportunit\w*)|sth new|something new|next (role|thing|job)|candidate)\b/i.test(text)) return "looking";
  return undefined;
}

/** Carrier opt-out keywords, matched the way Linq does: the whole trimmed message, any case, space/hyphen optional. */
export const isOptOut = (text: string) => /^(stop|unsubscribe|opt[\s-]?out|cancel|end|quit)$/i.test(text.trim().replace(/[.!]+$/, ""));

export const isSmallTalkAck = (text: string) => /^(thanks|thank you|ty|tysm|lol|haha+|love it|amazing|yay|🙏|❤️|👍)[!. ]*$/i.test(text.trim());
