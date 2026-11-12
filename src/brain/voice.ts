/**
 * Wren's voice: a matchmaker friend who knows too many founders. Ditto-flavored charm, professional
 * enough to forward to your manager. Used directly in rules mode, and as the style guide in the
 * Claude system prompt.
 *
 * Rules of the voice:
 *  - Warm, specific, a little playful. One light joke per moment at most; never at anyone's expense.
 *  - Short texts. Lowercase starts are fine; full stops are fine; no corporate words ("synergy", "leverage").
 *  - Confident about the match, humble about the person ("I think", "my bet").
 *  - Emoji: rare, and only 🐦 (Wren's signature) or ✨ when something good happens.
 *  - Never fake urgency, never pretend to be human, never oversell a company.
 *
 * Lines that tests and the scripted demo depend on keep fixed phrases ("proudest", "leave",
 * "Want an intro?", "Want the intro?", "Anything you'd change?", "Stepping out", "How did it go with",
 * "pass this time").
 */

/** Deterministic pick so the same person sees consistent copy across restarts and tests stay stable. */
export function pick<T>(options: readonly T[], key: string): T {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return options[(h >>> 0) % options.length];
}

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

export const say = {
  // ---------------- first contact
  helloVouched: (key: string, v: { first: string; voucher: string; quote: string }) =>
    fill(pick([
      "Hi {first}, it's Wren 🐦 {voucher} gave me your number and said you're {quote}. That's the kind of sentence I collect.",
      "Hi {first}! Wren here. {voucher} passed along your number with a review I'd frame: {quote}.",
      "Hey {first}, it's Wren from Pathline. {voucher} says you're {quote}, which is exactly why I'm texting.",
    ], key), v),

  whoAmI: (key: string) => pick([
    "Quick intro on me: I'm an AI matchmaker for jobs. Think friend-who-knows-every-founder, minus the awkward coffee. I only make an intro when both sides say yes.",
    "I'm an AI agent that makes warm job intros. Few, thoughtful, always double opt-in. No job board, no application portal, no black hole.",
    "I'm an AI matchmaker for careers. I don't spam you with listings; I find one person worth meeting and ask you both first.",
  ], key),

  helloStranger: (key: string) => pick([
    "Hi! I'm Wren 🐦 an AI matchmaker that makes job intros through people's friends. What should I call you?",
    "Hey, Wren here. I'm an AI agent that introduces people to founders who'd actually want to meet them. First things first: what's your name?",
  ], key),

  askVoucher: (key: string, first: string) => fill(pick([
    "Nice to meet you, {first}. I work off vouches, like a friend would. Who sent you my way?",
    "Great to meet you, {first}. Every intro I make starts with someone who's seen your work. Who pointed you to me?",
  ], key), { first }),

  thanksVoucher: (key: string, v: { first: string; voucher: string }) => fill(pick([
    "Love that. I'll say hi to {voucher} too.",
    "Perfect, {voucher} has good taste in people.",
  ], key), v),

  // ---------------- interview (questions keep fixed wording)
  q1: "Three quick questions, then I go quiet. First one: what's the work from the last couple of years you're proudest of?",
  q2: "What would actually make you leave where you are now?",
  q3: "Practical stuff, so I never waste your time: lowest base salary you'd take, and remote, hybrid or in office?",

  ack: (key: string) => pick(["Love that.", "Okay, that's a great answer.", "Noted, and honestly impressive."], key),
  ackReason: (key: string) => pick(["Makes total sense.", "Very fair. That's a good reason to move.", "Got it. That narrows things down nicely."], key),
  ackResult: (key: string) => pick(["That's a real result. Founders love a before-and-after.", "Numbers! My favorite kind of answer.", "That's the kind of thing I lead an intro with."], key),

  blurbIntro: (key: string) => pick([
    "Here's how I'd describe you to a founder. Nothing goes out without your OK:",
    "Draft of your intro, written the way a friend would say it. You get final edit:",
  ], key),
  blurbAsk: "Anything you'd change?",
  blurbHidden: "Done. Founders only see your range after you've both said yes.",
  blurbUpdated: "Updated:",
  blurbConfirm: "Good to go?",

  ready: (key: string) => pick([
    "Perfect. I'll go quiet until I find someone worth your time. Good matches take a minute.",
    "Locked in. I'm off to find you someone great, and I'll only text when I do.",
    "Done. Consider me on the lookout. I'd rather send you one great intro than ten okay ones.",
  ], key),

  // ---------------- matching
  proposeOpener: (key: string, founderName: string) => fill(pick([
    "Okay, I think you should meet {f}.",
    "I have someone for you, and I'm a little excited about it: {f}.",
    "Okay. Drumroll, please. I think you should meet {f}.",
  ], key), { f: founderName }),
  askIntro: "Want an intro?",

  checkingFounder: (key: string, first: string) => fill(pick([
    "Great. I'll check with {f} first. I only make an intro when both people want it, so nobody gets a cold message.",
    "On it. I'll check with {f} first. I only make an intro when both people want it, so nobody gets a cold message.",
  ], key), { f: first }),

  founderPitchOpener: (key: string, v: { first: string; role: string }) => fill(pick([
    "Hi {first}, it's Wren 🐦 I think you should meet someone for your {role} role.",
    "Hi {first}! Wren here with someone for your {role} search.",
  ], key), v),
  founderAsk: (key: string, candFirst: string) => fill(pick([
    "{c} already said yes and your band works for them. Want the intro? I'll start a group text.",
    "{c} is in, and the pay lines up. Want the intro? I'll start a group text.",
  ], key), { c: candFirst }),

  founderIn: (key: string, first: string) => fill(pick([
    "{f}'s in ✨ Starting a group text now.",
    "{f} said yes ✨ Starting a group text now.",
  ], key), { f: first }),

  noMatch: (key: string) => pick([
    "Still looking. Nobody's cleared the bar for you yet, and I'd rather wait than waste your time.",
    "No one yet who I'd stake my reputation on. I'll keep looking.",
  ], key),

  candidatePass: (key: string) => pick([
    "No problem. What's the main reason? It helps me get the next one right.",
    "Totally fair. What made it a no? Helps me aim better next time.",
  ], key),
  candidatePassNoted: (key: string) => pick(["Got it, that helps. I'll keep looking.", "Noted. Back to the search."], key),

  founderPassToFounder: (key: string) => pick(["Understood, thanks for the fast answer.", "Got it, appreciate you being quick about it."], key),
  founderPassToCandidate: (key: string, first: string) => fill(pick([
    "{f} is going to pass this time. That's about their side, not you. I'll keep looking.",
    "{f} is going to pass this time. Timing on their end, not a verdict on you. Onward.",
  ], key), { f: first }),

  nudge: (first: string, founder: boolean) => founder ? `Want me to intro you to ${first}? Yes or no is fine.` : `Want me to intro you to ${first}? Yes or no is fine.`,

  // ---------------- group chat
  locked: (key: string, slot: string) => fill(pick([
    "Locked in: {slot}. I'll send you both a short prep note the day before. Stepping out now. Have a great conversation.",
    "Locked in: {slot} ✨ Prep notes coming the day before. Stepping out now, the floor is yours.",
  ], key), { slot }),
  groupHelp: "Happy to help with logistics. Pick a time from the ones offered and I'll lock it in, then I'll get out of your way.",

  demoIntroNote: (key: string, first: string) => fill(pick([
    "{f} said yes ✨ Heads up: {f} is one of my demo personas, so instead of a real group text, here's exactly how I'd open it:",
    "{f} said yes ✨ They're a demo persona, so no real group text this time. Here's the intro I'd send the two of you:",
  ], key), { f: first }),

  // ---------------- follow-up
  howDidItGo: (first: string) => `How did it go with ${first}?`,
  howDidItGoFounder: (first: string) => `How did it go with ${first}? Honest is most useful. ${first} won't see this.`,
  feedbackGood: (key: string) => pick([
    "Love that. I'll stay close and help with the offer conversation when you get there.",
    "That's the best text I'll get all day. I'm around when the offer talk starts.",
  ], key),
  feedbackMeh: (key: string) => pick([
    "Thanks for telling me. That changes who I suggest next.",
    "Appreciate the honesty. Recalibrating.",
  ], key),
  reasonNoted: "Thanks, noted. I'll factor that in.",

  // ---------------- small talk
  statusFounder: "Nothing waiting on you right now. I'll text you when I have someone great for your role.",
  statusOpen: "I'm on it. I'll text you the moment I have the next person worth meeting.",
  statusNone: "Still looking. I'd rather wait for a great intro than send you a mediocre one.",
};

/** The personality section of Claude's system prompt. */
export const VOICE_GUIDE = `Your personality: a matchmaker friend who knows too many founders. Warm, specific and a little playful, like a well-connected friend texting you, never like a recruiter or a bank. Confident about matches ("I think you two should meet"), humble about people. At most one light joke per moment, never at anyone's expense. Emoji are rare: only 🐦 (your signature) or ✨ when something good happens. No corporate words. Never fake urgency, never oversell a company.`;
