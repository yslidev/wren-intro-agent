import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Person } from "../types.js";
import { agreedSlot, extractFloorK, extractSetups, extractSkills, extractStages, intent, isSmallTalkAck, mentionsAgent, type Intent } from "./text.js";
import { say, VOICE_GUIDE } from "./voice.js";

/**
 * Wren's voice and rules. Kept byte-stable so it caches across every call.
 */
const PERSONA = `You are Wren, an AI agent from Pathline that makes job introductions over iMessage the way a well-connected friend would. You text with candidates and with founders and recruiters who are hiring.

${VOICE_GUIDE}

How you text:
- Short. One to three sentences per message, like a real text from a friend. No bullet lists, no markdown, no headers.
- Use first names. Mirror the other person's energy.
- You are an AI agent and you say so when asked. Never claim to be human.

Rules you never break:
- Double opt-in. Never share a person's name, details or number with the other side until that person has said yes to the intro.
- Never invent facts about a person or company. Use only the context you are given; if you don't know, say you'll find out.
- Be selective. A bad intro costs you trust with both people, the way it would for a friend.
- In a group chat the humans are talking to each other. Speak only when someone addresses you, asks something only you can answer, or to confirm logistics. Then step back.`;

type Effort = "low" | "medium" | "high";

export interface Pitch { toCandidate: string[]; toFounder: string[]; groupIntro: string[] }

const transcript = (lines: { who: string; text: string }[]) => lines.map((l) => `${l.who}: ${l.text}`).join("\n");

export class Brain {
  private client?: Anthropic;
  constructor(readonly enabled: boolean, private model: string, private onLog: (msg: string) => void = () => {}) {
    if (enabled) this.client = new Anthropic();
  }

  /** One structured call. Returns null on any failure so callers fall back to the rule-based path. */
  private async ask<S extends z.ZodType>(name: string, schema: S, task: string, input: string, effort: Effort): Promise<z.infer<S> | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort, format: betaZodOutputFormat(schema) },
        system: [
          { type: "text", text: PERSONA, cache_control: { type: "ephemeral" } },
          { type: "text", text: task },
        ],
        messages: [{ role: "user", content: input }],
      });
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
        this.onLog(`${name}: stop_reason=${res.stop_reason}, using fallback`);
        return null;
      }
      this.onLog(`${name}: Claude (${res.usage.input_tokens} in / ${res.usage.output_tokens} out)`);
      return res.parsed_output ?? null;
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) this.onLog(`${name}: rate limited, using fallback`);
      else if (err instanceof Anthropic.APIError) this.onLog(`${name}: API ${err.status} ${err.message.slice(0, 120)}, using fallback`);
      else this.onLog(`${name}: ${(err as Error).message.slice(0, 160)}, using fallback`);
      return null;
    }
  }

  // ---------- 1:1 interview ----------
  async interviewTurn(p: Person, question: string, answer: string, nextQuestion?: string) {
    const out = await this.ask(
      "interview",
      z.object({
        reply: z.string().describe("Your next text: a brief, specific reaction to the answer, then the next question verbatim if there is one."),
        floorK: z.number().nullable().describe("Lowest base salary in thousands of USD if stated, else null"),
        setups: z.array(z.enum(["remote", "hybrid", "onsite"])),
        stages: z.array(z.enum(["seed", "series a", "series b", "series c"])),
        skills: z.array(z.string()).describe("Lowercase skill tags clearly shown by the answer, e.g. payments, onboarding, growth, ml, design"),
      }),
      "You are interviewing a candidate, like a friend would before introducing them. React to their answer in one short sentence that shows you listened (reference a detail), then ask the next question if one is given. Extract structured fields only when clearly stated.",
      JSON.stringify({ candidate: { name: p.name, title: p.candidate?.title, vouch: p.vouch }, question, answer, nextQuestion: nextQuestion ?? null }),
      "low",
    );
    if (out) return out;
    const floor = extractFloorK(answer), setups = extractSetups(answer);
    const key = `${p.id}:${p.asked}`;
    const ack = !nextQuestion && (floor || setups.length)
      ? `Got it: ${[floor ? `$${floor}K floor` : "", setups.join(" or ")].filter(Boolean).join(", ")}.`
      : /\d/.test(answer) && /from|to|cut|grew|%|x\b/i.test(answer) ? say.ackResult(key)
      : p.asked === 2 ? say.ackReason(key) : say.ack(key);
    return {
      reply: nextQuestion ? `${ack} ${nextQuestion}` : ack,
      floorK: extractFloorK(answer) ?? null,
      setups: extractSetups(answer) as ("remote" | "hybrid" | "onsite")[],
      stages: extractStages(answer) as ("seed" | "series a" | "series b" | "series c")[],
      skills: extractSkills(answer),
    };
  }

  async writeBlurb(p: Person): Promise<string> {
    const c = p.candidate!;
    const out = await this.ask(
      "blurb",
      z.object({ blurb: z.string() }),
      "Write the 2-3 sentence intro blurb you would send a founder about this candidate. It must be readable in 20 seconds: their role and years, one concrete proof of work in their words, the vouch (name + relationship + what they said), and what they want next. Plain text, third person, no salary.",
      JSON.stringify({ name: p.name, ...c, vouch: p.vouch }),
      "medium",
    );
    if (out?.blurb) return out.blurb;
    const want = c.whyLeave ? ` What ${p.first} wants next, in their words: "${c.whyLeave.trim()}"` : "";
    const title = c.title ? `, ${c.title}` : "";
    return `${p.name || p.first}${title}${c.years ? `, ${c.years} years in` : ""}.${proofAndVouch(p)}${want}`.trim();
  }

  async reviseBlurb(p: Person, request: string): Promise<{ blurb: string; hideComp: boolean }> {
    const out = await this.ask(
      "revise_blurb",
      z.object({ blurb: z.string(), hideComp: z.boolean().describe("true if they asked not to share pay expectations") }),
      "The candidate asked for a change to the intro blurb you'll send founders. Apply exactly their change and nothing else.",
      JSON.stringify({ blurb: p.blurb, request }),
      "low",
    );
    if (out) return out;
    return { blurb: p.blurb ?? "", hideComp: /comp|salary|pay|range|money/i.test(request) };
  }

  // ---------- reading replies ----------
  async classify(context: string, text: string): Promise<Intent> {
    const quick = intent(text);
    if (quick === "yes" || quick === "no") return quick; // unambiguous; skip the call
    const out = await this.ask(
      "classify",
      z.object({ intent: z.enum(["yes", "no", "more", "other"]) }),
      "Classify the person's reply to your question. yes = agrees, no = declines, more = wants more information first, other = anything else.",
      JSON.stringify({ yourQuestion: context, reply: text }),
      "low",
    );
    return out?.intent ?? quick;
  }

  // ---------- the match ----------
  async pitch(c: Person, f: Person, reasons: string[]): Promise<Pitch> {
    const fp = f.founder!;
    const out = await this.ask(
      "pitch",
      z.object({
        toCandidate: z.array(z.string()).describe("2-4 texts to the candidate proposing the founder. End by asking if they want an intro."),
        toFounder: z.array(z.string()).describe("2-3 texts to the founder proposing the candidate (the candidate already said yes). Include the blurb. End by asking if they want the intro."),
        groupIntro: z.array(z.string()).describe("5 texts for the new group chat, no links: (1) exactly 'setting up your chat...'; (2) an invitation card: '<Candidate> x <Founder>, it's official 🎉' then lines starting 🗓 when (they pick here), 📍 where (25-min video call), 💸 already settled (band, equity, setup); (3) one warm line on who the hiring person is, with their vouch; (4) one warm line on the candidate's proof of work and vouch; (5) 'what day works best?' with the hiring side's open times, then say you'll step out."),
      }),
      "Write the texts for a double opt-in intro. Ground every claim in the context. Reasons are why this match is good; use the strongest one or two in plain language. Share the founder's band only in the group intro; never share the candidate's salary floor if hideComp is true.",
      JSON.stringify({ candidate: { name: c.name, blurb: c.blurb, vouch: c.vouch, hideComp: c.hideComp, ...c.candidate }, founder: { name: f.name, vouch: f.vouch, ...fp }, reasons }),
      "medium",
    );
    if (out && out.toCandidate.length && out.toFounder.length && out.groupIntro.length) return out;
    const why = reasons.slice(0, 2).join("; ");
    const stage = titleStage(fp.stage);
    const key = `${c.id}:${f.id}`;
    const recruiter = f.persona && f.persona.kind !== "founder" ? ` ${f.first} is running the search (${f.persona.title}).` : "";
    const vouchLine = f.vouch ? ` And ${f.vouch.name} (${f.vouch.relation}) calls ${f.first} ${f.vouch.quote}.` : "";
    const who = f.persona ? `${f.persona.title} at ${fp.company}` : `who's hiring ${an(fp.roleTitle)} at ${fp.company}`;
    return {
      toCandidate: [
        say.proposeOpener(key, f.name),
        `${fp.company} is ${an([stage, fp.sector].filter(Boolean).join(" "))} company hiring ${an(fp.roleTitle)}. ${fp.success ? `What great looks like at 90 days: ${lowerFirst(sentence(fp.success))}` : `Their biggest problem right now: ${fp.problem}.`}${recruiter}`,
        ...(fp.pitch ? [`${f.first}'s honest pitch and catch, in their words: "${fp.pitch.trim()}"`] : []),
        `Why you two: ${why}.${vouchLine}`,
        say.askIntro,
      ],
      toFounder: [
        say.founderPitchOpener(key, { first: f.first, role: fp.roleTitle }),
        c.blurb ?? c.name,
        say.founderAsk(key, c.first),
      ],
      // The moment of connection: Ditto's group-chat ritual + the shape of a friend's intro text.
      groupIntro: [
        say.settingUp,
        `${c.first} x ${f.first}, it's official 🎉\n\n🗓 when: you two pick it in here\n📍 where: 25-min video call, I'll send the link\n💸 already settled: ${fp.bandK[0] ? `$${fp.bandK[0]}-${fp.bandK[1]}K` : "pay shared up front"}${fp.equity ? ` + ${fp.equity}` : ""}${fp.setup ? `, ${fp.setup}` : ""}`,
        `${f.first} is ${f.persona ? `${f.persona.title} at ${fp.company}` : `building ${fp.company}`}, hiring ${an(fp.roleTitle)}.${f.vouch?.quote ? ` ${f.vouch.name} calls ${f.first} ${f.vouch.quote}.` : ""}`,
        candidateLine(c),
        `what day works best? ${f.first} has ${fp.slots.slice(0, 2).join(" or ")}. I'll step out once you two pick.`,
      ],
    };
  }

  async moreAbout(asker: Person, other: Person): Promise<string> {
    if (other.role === "founder") {
      const fp = other.founder!;
      return `${fp.company}: ${fp.stage}, ${fp.sector}. The role is ${fp.roleTitle}, ${fp.setup}, $${fp.bandK[0]}-${fp.bandK[1]}K plus ${fp.equity}. ${other.first}'s biggest problem right now: ${fp.problem}. Want an intro?`;
    }
    const cp = other.candidate!;
    return `${other.first} has ${cp.years} years in ${cp.skills.slice(0, 3).join(", ")}. ${cp.whyLeave ? `What they want next: ${lowerFirst(sentence(cp.whyLeave))}` : ""} Want the intro?`.replace(/\s+/g, " ");
  }

  // ---------- group chats ----------
  /**
   * The gate, as Linq recommends for group agents: decide whether to speak before deciding what to say.
   * Most messages in a live intro are the two humans talking, and Wren should stay out of those.
   */
  async gate(history: { who: string; text: string }[], sender: string, text: string, offeredSlots: string[]) {
    const ruleSlot = agreedSlot(text, offeredSlots);
    const out = await this.ask(
      "gate",
      z.object({
        action: z.enum(["respond", "react", "ignore"]),
        agreedSlot: z.string().nullable().describe("If this message confirms a specific meeting time both people agreed on, that time, e.g. 'Thu 10:00 AM PT'; else null"),
      }),
      "You are in a group chat you created to introduce two people. Decide what to do with the latest message. respond: someone addressed you (by name, 'bot', 'AI'), asked something only you can answer, or confirmed a meeting time. react: a short thanks or laugh aimed at you. ignore: the humans talking to each other. Default to ignore when unsure.",
      transcript([...history.slice(-12), { who: `${sender} (latest)`, text }]),
      "low",
    );
    if (out) return { action: out.agreedSlot ? ("respond" as const) : out.action, slot: out.agreedSlot ?? ruleSlot ?? null };
    if (ruleSlot) return { action: "respond" as const, slot: ruleSlot };
    if (mentionsAgent(text)) return { action: isSmallTalkAck(text.replace(/@?wren/i, "")) ? ("react" as const) : ("respond" as const), slot: null };
    return { action: "ignore" as const, slot: null };
  }

  async groupReply(history: { who: string; text: string }[], context: object): Promise<string> {
    const out = await this.ask(
      "group_reply",
      z.object({ reply: z.string() }),
      "Reply in the intro group chat. Answer only what you were asked, in one or two sentences, then hand the conversation back to them.",
      JSON.stringify({ context, chat: transcript(history.slice(-15)) }),
      "low",
    );
    return out?.reply ?? say.groupHelp;
  }

  async chat(p: Person, history: { who: string; text: string }[], status: string): Promise<string> {
    const out = await this.ask(
      "chat",
      z.object({ reply: z.string() }),
      "Reply to this person in your 1:1 thread. Status tells you where things stand; use it, don't invent progress.",
      JSON.stringify({ person: { name: p.name, role: p.role }, status, chat: transcript(history.slice(-10)) }),
      "low",
    );
    return out?.reply ?? status;
  }
}

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const titleStage = (s: string) => (s === "seed" ? "seed-stage" : /^series/i.test(s) ? s.replace(/\b\w/g, (ch) => ch.toUpperCase()) : s);
/** "a Founding Engineer", "an iOS Engineer", "an ML Engineer", "an AI company". */
const an = (w: string) => `${/^([aeio]|u(?!s|n[ii]))|^(ml|llm|sre|mba|hr|seo)\b/i.test(w) ? "an" : "a"} ${w}`;
const shortRelation = (r: string) => r.split(",")[0];

/** "Alex recently rebuilt dispute handling ... Maya Chen calls Alex the best PM ..." for the group intro. */
function candidateLine(p: Person): string {
  const proud = p.candidate?.proudest?.trim();
  const proof = proud
    ? /^(i\s)?(shipped|built|rebuilt|led|launched|cut|grew|took|ran|designed|redesigned|found|closed|turned|wrote|created|scaled|migrated)\b/i.test(proud)
      ? `${p.first} recently ${lowerFirst(sentence(proud.replace(/^i\s/i, "")))}`
      : `${p.first}'s proudest work: ${lowerFirst(sentence(proud))}`
    : `${p.first}: ${p.blurb ?? p.candidate?.title ?? ""}`;
  const vouch = p.vouch?.quote ? ` ${p.vouch.name} calls ${p.first} ${p.vouch.quote}.` : "";
  return (proof + vouch).trim();
}

/** " Proudest work: ... Maya Chen, Alex's manager at Corvid, calls Alex ..." */
function proofAndVouch(p: Person): string {
  const c = p.candidate;
  const proof = c?.proudest ? ` Proudest work: ${lowerFirst(sentence(c.proudest))}` : "";
  const vouch = p.vouch?.quote ? ` ${p.vouch.name}, ${shortRelation(p.vouch.relation)}, calls ${p.first} ${p.vouch.quote}.` : "";
  return proof + vouch;
}
