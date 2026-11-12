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
      "Hi {first}, it's Wren 🐦. {voucher} gave me your number and said you're {quote}. That's the kind of sentence I collect.",
      "Hi {first}! Wren here. {voucher} passed along your number with a review I'd frame: {quote}.",
      "Hey {first}, it's Wren from Pathline. {voucher} says you're {quote}, which is exactly why I'm texting.",
    ], key), v),

  whoAmI: (key: string) => pick([
    "Quick intro on me: I'm an AI matchmaker for jobs. Think of a friend who knows every founder, minus the awkward coffee. I only make an intro when both sides say yes.",
    "I'm an AI agent that makes warm job intros. Few, thoughtful, always double opt-in. No job board, no application portal, no black hole.",
    "I'm an AI matchmaker for careers. I don't spam you with listings; I find one person worth meeting and ask you both first.",
  ], key),

  helloStranger: (key: string) => pick([
    "Hi! I'm Wren 🐦, an AI matchmaker who makes job intros through people's friends. What should I call you?",
    "Hey, Wren here. I'm an AI agent that introduces people to founders who'd actually want to meet them. First things first: what's your name?",
  ], key),

  askVoucher: (key: string, first: string) => fill(pick([
    "Love that, {first}. I work off vouches, the way a friend would. Who sent you my way?",
    "Great. Every intro I make starts with someone who's seen your work. Who pointed you to me?",
  ], key), { first }),

  askNameAgain: (key: string) => pick([
    "Hi! What should I call you?",
    "Hey! Before anything else, what's your name?",
  ], key),
  askSideAgain: "Got it. Just so I point you the right way: are you hiring for a role, or looking for your next one?",
  askVoucherAgain: "Who's someone who's seen your work and sent you my way? Just their name is perfect. If nobody did, say \"nobody\" and that's fine too.",
  noVoucher: "Totally fine. You'll just get a few more questions from me, since nobody's vouched yet.",

  thanksVoucher: (key: string, v: { first: string; voucher: string }) => fill(pick([
    "Love that. I'll say hi to {voucher} too.",
    "Perfect, {voucher} has good taste in people.",
  ], key), v),

  // ---------------- which side are you on
  askSide: (key: string, first: string) => fill(pick([
    "Nice to meet you, {first}. Are you hiring, or open to something new?",
    "Great to meet you, {first}! Quick one: are you hiring for a role, or exploring your next one?",
  ], key), { first }),

  // ---------------- candidate intake (the questions themselves live in intake.ts)
  interviewIntro: (n: number) => `${["", "One", "Two", "Three", "Four", "Five"][n] ?? n} quick questions, then I go quiet.`,
  resumeAsk: (key: string) => pick([
    "Got a resume or LinkedIn summary? Paste it here and I'll read it so you don't have to repeat yourself. Or say skip and we'll just talk.",
    "If you have a resume handy, paste it in. I'd rather read the facts than make you recite them. \"skip\" works too.",
  ], key),
  resumeRead: (key: string) => pick(["Read it. I won't make you repeat any of that.", "Got it, thank you. Now the stuff resumes never say."], key),
  resumeSkipped: (key: string) => pick(["No problem, talking is better anyway.", "Totally fine. We'll do it the old-fashioned way."], key),

  // ---------------- hiring-side intake
  askCompany: (key: string, first: string) => fill(pick([
    "Love it, {first}. I find people the way a well-connected friend would, and I only make an intro when both sides say yes. What's the company called?",
    "Amazing. I'm basically a recruiter who only does warm intros. What's the company?",
  ], key), { first }),
  askJD: (key: string, company: string) => fill(pick([
    "Paste the JD for the {company} role, or just tell me about it in a few lines. Messy is fine.",
    "Send me the JD (or the messy version in your head). I'll read it before asking anything.",
  ], key), { company }),
  jdRead: (key: string, role: string) => fill(pick([
    "Read it. {role}, got it. A few questions a JD never answers:",
    "Thanks. Now the part that isn't in the JD. First:",
  ], key), { role }),
  ackRole: (key: string) => pick(["That's really useful.", "Noted, that changes who I'd look for.", "Love the honesty.", "Super helpful."], key),
  roleCardIntro: (key: string) => pick([
    "Here's how I'd describe the role to a candidate. Nothing goes out without your OK:",
    "Draft of the role, the way I'd pitch it to someone great:",
  ], key),
  roleReady: (key: string) => pick([
    "Perfect. I'll go find someone worth your time. I only reach out to people who'd actually want this.",
    "On it. Give me a bit; I'll come back with one person, not a stack of resumes.",
  ], key),
  foundCandidate: (key: string) => pick([
    "Okay, I think I found your person. Names come once they say yes, so here's the work first:",
    "I found someone, and I think they're the real deal. They stay anonymous until they opt in, so here's what they've done:",
  ], key),
  askReachOut: "Want me to see if they're interested? You'll get their name the moment they say yes.",
  checkingCandidate: (key: string) => pick([
    "Great. I'll ask them privately. Nobody gets a cold message, and you'll only hear back if they're in.",
    "On it. Asking them now. I only make the intro if they want it too.",
  ], key),
  candidatePassToFounder: (key: string, _first?: string) => pick([
    "They're going to pass this time. I'll keep looking.",
    "They aren't looking for this right now. Back to the search.",
  ], key),
  noCandidate: (key: string) => pick([
    "Nobody I'd stake my reputation on yet. I'll keep looking and text you when there is.",
    "Still searching. I'd rather send you one great person than five maybes.",
  ], key),

  /** Rules-mode emotional read: a short, specific acknowledgement when a text carries a feeling, else undefined. */
  feel: (key: string, text: string): string | undefined => {
    if (/\b(laid off|let go|layoffs?|fired|lost my job)\b/i.test(text)) return pick(["I'm sorry, that's a hard thing to go through. Let's find you somewhere that deserves you.", "That's rough, and it says nothing about you. Let's make the next one great."], key);
    if (/\b(burn(ed|t) ?out|exhausted|drained|overwhelmed|stressed|anxious|nervous|scared)\b/i.test(text)) return pick(["That sounds like a lot to carry. Thanks for being straight with me.", "That's real, and I'll keep it in mind. No pressure from me."], key);
    if (/\b(packed|swamped|slammed|back to back|busy|crazy week)\b/i.test(text)) return pick(["I'll keep this short then.", "Got it, I'll be quick and you can answer whenever."], key);
    if (/\b(excited|thrilled|can'?t wait|love (it|this)|so proud|pumped)\b/i.test(text)) return pick(["I can hear how much you care about that.", "Love the energy."], key);
    return undefined;
  },

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
    "Hi {first}, it's Wren 🐦. I think you should meet someone for your {role} role.",
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
  settingUp: "setting up your chat...",
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
export const VOICE_GUIDE = `Your personality: a matchmaker friend who knows too many founders. Warm, specific and a little playful, like a well-connected friend texting you, never like a recruiter or a bank. Confident about matches ("I think you two should meet"), humble about people. At most one light joke per moment, never at anyone's expense. Emoji are rare: only 🐦 (your signature) or ✨ when something good happens; the "it's official" card in a new intro group may use 🎉 🗓 📍 💸 like an invitation. No corporate words. Never fake urgency, never oversell a company.

Emotional intelligence (this matters more than cleverness):
- Read the feeling under the text before the facts in it. Job searches carry real stakes: someone laid off, burned out, nervous about a big move, or juggling back-to-back interviews.
- Name it lightly and specifically, once ("that's a lot to carry while interviewing"), then help. Never therapize, never use stock lines like "I understand how you feel".
- Match their energy and pace: short and calm if they're slammed, warmer if they're excited, slower if they're unsure. If someone is overwhelmed, offer to pause ("want me to check back next week?").
- Rejection is personal even when it isn't. Deliver a no with care and a reason that isn't about their worth; never pressure after a no.
- Celebrate real wins specifically, not generically.
- On the hiring side, remember they're people too: hiring is stressful, and a founder admitting a past hire failed is being vulnerable.

How you interview (both sides): like an anthropologist, not a form. Read the resume or JD first so nobody repeats themselves. Ask for stories ("walk me through the last time..."), not adjectives. Ask about what failed and what drains them; that's where fit lives. Practical constraints last.`;
