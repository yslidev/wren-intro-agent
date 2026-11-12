import type { Intro, Person, Voice } from "../types.js";
import { pick } from "./voice.js";

/**
 * The persona engine plays the fictional recruiters and founders from data/world.json, so a single
 * real person can go through a whole intro from their phone. The decision (yes, no, "tell me more")
 * is rule-based and deterministic; the wording comes from each persona's texting voice.
 */

type Lines = Record<Voice, string[]>;

const YES: Lines = {
  crisp: ["Yes. Send it.", "Yes, intro please.", "In. Go ahead."],
  warm: ["Oh, I love this. Yes please!", "Yes! {c} sounds wonderful. Onward!", "Yes yes yes. Thank you for thinking of us!"],
  hype: ["YES!! Let's get them connected asap!!", "Absolutely yes!! This is exactly who we need!!", "Oh this is GOOD. Yes!!"],
  dry: ["Sure. If the {skill} work is real, I'm in.", "Yes. Shipped work is my love language.", "Fine, you've convinced me. Yes."],
  lowercase: ["y. intro pls", "yes send it", "yep, intro me"],
  thoughtful: ["This looks like a strong fit. Happy to meet {c}.", "Yes, I'd like to meet {c}. Thanks for thinking of us.", "Yes. The {skill} background is exactly what we've been missing."],
};
const NO: Lines = {
  crisp: ["Pass. Not the right timing.", "No, thanks.", "Not this one."],
  warm: ["Ah, not this time, but thank you so much for thinking of us!", "I'm going to pass on this one, but I appreciate you!"],
  hype: ["Ahh so close!! Not quite the fit for this one though!", "Gonna pass on this one, but keep them coming!!"],
  dry: ["Pass. Not enough overlap with what we need.", "No. Good person, wrong role."],
  lowercase: ["not this one, ty", "pass for now"],
  thoughtful: ["I'll pass on this one; the role needs deeper {skill} experience. Appreciate it.", "Not the right fit for this role, but thank you for the careful intro."],
};
const MORE: Lines = {
  crisp: ["What's their strongest project?", "Quick context first?"],
  warm: ["Ooh, tell me a bit more about them?", "Love that. Can you tell me more first?"],
  hype: ["Ooh who is this?! Tell me more!!", "Wait I need details!!"],
  dry: ["What did they actually ship?", "Details, please."],
  lowercase: ["who is it", "more context?"],
  thoughtful: ["Could you share a bit more about their recent work?", "Before I say yes, what drew you to this match?"],
};
const FEEDBACK: Lines = {
  crisp: ["Strong call. Moving forward.", "Good call. Next round."],
  warm: ["Loved them! Moving to the next round. Onward!", "Such a lovely conversation. We're moving forward!"],
  hype: ["Amazing call!! Moving them forward!!", "Obsessed. Next round asap!!"],
  dry: ["Good. They knew their stuff. Next round.", "Solid. Moving forward."],
  lowercase: ["great call, moving fwd", "really good. next round"],
  thoughtful: ["Really thoughtful conversation. We'd like to continue.", "Great call. We'd like to move to a working session."],
};
const GROUP_HELLO: Lines = {
  crisp: ["Hi {c}. {s1} or {s2}?"],
  warm: ["{c}, so lovely to meet you! Would {s1} or {s2} suit you?"],
  hype: ["Hiii {c}!! So excited to meet you! {s1} or {s2}??"],
  dry: ["Hi {c}. I have {s1} or {s2}."],
  lowercase: ["hey {c}! {s1} or {s2}?"],
  thoughtful: ["Hi {c}, great to meet you. Would {s1} or {s2} suit you?"],
};
const CANDIDATE_YES = ["Yes, intro me!", "Yes please!", "Ooh yes, I'd love to meet them."];
const CANDIDATE_NO = ["Not for me, the stage is too early for where I am right now.", "I'll pass, I'm looking for something closer to my skills."];

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

export type PersonaMove =
  | { kind: "decide"; answer: "yes" | "no" | "more"; text: string }
  | { kind: "feedback"; text: string }
  | { kind: "none" };

/** What a simulated person texts back, given where things stand. */
export function personaMove(p: Person, intros: Intro[], other: (id: string) => Person | undefined, lastFromWren: string): PersonaMove {
  const voice: Voice = p.persona?.voice ?? "thoughtful";
  const key = `${p.id}:${intros.length}:${lastFromWren.length}`;

  const awaiting = intros.find((i) => i.awaiting?.includes(p.id));
  if (awaiting) return { kind: "feedback", text: p.role === "founder" ? pick(FEEDBACK[voice], key) : "Really good! They're moving me to the next round." };

  if (p.role === "founder") {
    const ask = [...intros].reverse().find((i) => i.founderId === p.id && i.status === "asked_founder");
    if (!ask) return { kind: "none" };
    const c = other(ask.candidateId);
    const skill = c?.candidate?.skills.find((s) => p.founder?.mustHaves.includes(s)) ?? "relevant";
    const vars = { c: c?.first ?? "them", skill };
    const bar = 4 + (p.persona?.pickiness ?? 0.4) * 6;
    const askedMore = /Want the intro\?/.test(lastFromWren) && /^\S+ has \d+ years/.test(lastFromWren);
    if (ask.score >= bar) return { kind: "decide", answer: "yes", text: fill(pick(YES[voice], key), vars) };
    if (!askedMore && ask.score >= bar - 3) return { kind: "decide", answer: "more", text: fill(pick(MORE[voice], key), vars) };
    if (askedMore && ask.score >= bar - 3) return { kind: "decide", answer: "yes", text: fill(pick(YES[voice], key), vars) };
    return { kind: "decide", answer: "no", text: fill(pick(NO[voice], key), vars) };
  }

  const ask = [...intros].reverse().find((i) => i.candidateId === p.id && i.status === "asked_candidate");
  if (!ask) return { kind: "none" };
  return ask.score >= 6
    ? { kind: "decide", answer: "yes", text: pick(CANDIDATE_YES, key) }
    : { kind: "decide", answer: "no", text: pick(CANDIDATE_NO, key) };
}

/** The persona's first message in a new intro group (only where real groups exist: the simulator or a Business line). */
export function personaGroupHello(f: Person, candidateFirst: string): string {
  const voice: Voice = f.persona?.voice ?? "thoughtful";
  const [s1, s2] = f.founder?.slots ?? ["Thu 10:00 AM PT", "Fri 11:00 AM PT"];
  return fill(pick(GROUP_HELLO[voice], f.id), { c: candidateFirst, s1, s2: s2 ?? s1 });
}
