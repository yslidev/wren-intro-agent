import { randomUUID } from "node:crypto";
import type { Store } from "../store.js";
import { TransportUnsupported, type Transport } from "../transports/types.js";
import type { InboundEvent, Intro, Person } from "../types.js";
import type { Brain } from "./llm.js";
import { MIN_SCORE, rankFounders } from "./match.js";
import { isOptOut } from "./text.js";

/** The three questions a friend asks before vouching for you to someone they know. */
const QUESTIONS = [
  { key: "proudest", q: "First one: what's the work from the last couple of years you're proudest of?" },
  { key: "whyLeave", q: "What would actually make you leave where you are now?" },
  { key: "practical", q: "Practical stuff, so I never waste your time: lowest base salary you'd take, and remote, hybrid or in office?" },
] as const;

export interface AgentOptions { matchDelayMs: number; followupDelayMs: number }

export class Agent {
  private queues = new Map<string, Promise<void>>();
  private timers = new Set<NodeJS.Timeout>();

  constructor(private store: Store, private t: Transport, private brain: Brain, private opts: AgentOptions) {}

  /** Entry point for every inbound text, from any transport. Serialized per chat so replies stay in order. */
  handle(e: InboundEvent): Promise<void> {
    const prev = this.queues.get(e.chatId) ?? Promise.resolve();
    const next = prev.then(() => this.process(e)).catch((err) => this.store.addLog("error", `${e.chatId}: ${(err as Error).stack ?? err}`));
    this.queues.set(e.chatId, next);
    return next;
  }

  /** Wait for queued work (tests and the scripted demo use this). */
  async idle() { await Promise.all([...this.queues.values()]); }
  stop() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  private later(ms: number, fn: () => Promise<void>) {
    const h = setTimeout(() => { this.timers.delete(h); fn().catch((err) => this.store.addLog("error", String(err))); }, ms);
    this.timers.add(h);
  }

  // ------------------------------------------------------------------ inbound
  private async process(e: InboundEvent) {
    const s = this.store;
    const chat = s.ensureChat(e.chatId, { handles: e.isGroup ? (e.participants ?? [e.from]) : [e.from], isGroup: e.isGroup });
    if (e.isGroup && !chat.handles.includes(e.from)) chat.handles.push(e.from);
    s.pushMessage(chat.id, { id: e.messageId ?? randomUUID(), from: e.from, text: e.text, at: new Date().toISOString() });
    const who = s.byHandle(e.from);
    s.addLog("inbound", `${who?.first ?? e.from} ${e.isGroup ? `in ${chat.displayName ?? "group"}` : "(DM)"}: ${e.text}`);
    if (e.isGroup) return this.onGroup(e);
    // Connectivity check: "Hello Photon" (or "ping") echoes back without touching the intro flow.
    if (/^(hello photon|ping)[.!]*$/i.test(e.text.trim())) {
      const via = this.t.name === "spectrum" ? "Photon Spectrum" : this.t.name;
      await this.say(chat.id, `${via} is connected. You said: ${e.text}`);
      return;
    }
    return this.onDM(e);
  }

  private async onDM(e: InboundEvent) {
    let p = this.store.byHandle(e.from);
    if (isOptOut(e.text)) {
      if (p) { p.optedOut = true; this.store.save(); }
      this.store.addLog("decision", `${p?.first ?? e.from} opted out (${e.text.trim()}). Wren will not text them until they write again.`);
      return;
    }
    if (p?.optedOut) {
      p.optedOut = false;
      this.store.save();
      this.store.addLog("decision", `${p.first} texted again, opt-out cleared`);
    }
    if (!p) {
      p = this.store.addPerson({
        id: `c_${randomUUID().slice(0, 8)}`, handle: e.from, name: "New contact", first: "there", role: "candidate",
        stage: "new", asked: 0, notes: [], candidate: { title: "", years: 0, skills: [] },
      });
      await this.dm(p, "Hi, I'm Wren from Pathline, an AI agent that makes job intros through people's friends. Who sent you my way?");
      return;
    }

    // Free-text answers Wren asked for (decline reasons, post-call feedback) come first.
    const waiting = this.store.intros.find((i) => i.awaiting?.includes(p!.id));
    if (waiting) return this.onAwaitedAnswer(p, waiting, e.text);

    if (p.role === "founder") {
      const ask = this.store.openIntroFor(p.id, ["asked_founder"]);
      if (ask) return this.onFounderAnswer(ask, e.text);
      return this.smallTalk(p);
    }

    switch (p.stage) {
      case "new":
        if (!p.vouch) p.vouch = { name: e.text.slice(0, 60), relation: "said they referred them (not yet confirmed)", quote: "" };
        return this.startInterview(p);
      case "interviewing":
        return this.onInterviewAnswer(p, e.text);
      case "blurb_review":
        return this.onBlurbReview(p, e.text);
      case "ready": {
        const ask = this.store.openIntroFor(p.id, ["asked_candidate"]);
        if (ask) return this.onCandidateAnswer(ask, e.text);
        return this.smallTalk(p);
      }
    }
  }

  // ------------------------------------------------------------------ candidate onboarding
  /** Wren texts first, using the vouch, the way a friend-of-a-friend would. */
  async kickoff(personId: string) {
    const p = this.store.person(personId);
    if (!p) throw new Error(`no person ${personId}`);
    if (p.role === "candidate" && p.stage === "new") return this.startInterview(p);
    if (p.role === "candidate" && p.stage === "ready") return this.proposeNext(p);
    await this.dm(p, `Hi ${p.first}, it's Wren from Pathline. I'll text you when I have someone worth your time.`);
  }

  private async startInterview(p: Person) {
    const hello = p.vouch?.quote
      ? `Hi ${p.first}, it's Wren from Pathline. ${p.vouch.name} gave me your number and said you're ${p.vouch.quote}.`
      : `Thanks${p.first !== "there" ? `, ${p.first}` : ""}. I'll check with ${p.vouch?.name ?? "them"} too.`;
    p.stage = "interviewing";
    p.asked = 1;
    this.store.save();
    await this.dm(p, hello, `I'm an AI agent that makes job intros the way a friend would: only a few, and only when both sides want it. Three quick questions? ${QUESTIONS[0].q}`);
  }

  private async onInterviewAnswer(p: Person, text: string) {
    const idx = p.asked - 1;
    const q = QUESTIONS[idx];
    const c = p.candidate!;
    if (q.key === "proudest") c.proudest = text;
    if (q.key === "whyLeave") c.whyLeave = text;
    const next = QUESTIONS[idx + 1]?.q;
    const r = await this.brain.interviewTurn(p, q.q, text, next);
    if (r.floorK) c.floorK = r.floorK;
    if (r.setups.length) c.setups = [...new Set([...(c.setups ?? []), ...r.setups])];
    if (r.stages.length) c.stages = [...new Set([...(c.stages ?? []), ...r.stages])];
    if (r.skills.length) c.skills = [...new Set([...c.skills, ...r.skills.map((s) => s.toLowerCase())])];
    this.store.addLog("decision", `${p.first} profile: floor=${c.floorK ?? "?"}K setups=${(c.setups ?? []).join("/") || "?"} skills=${c.skills.join(",")}`);

    if (next) {
      p.asked += 1;
      this.store.save();
      return this.dm(p, r.reply);
    }
    p.blurb = await this.brain.writeBlurb(p);
    p.stage = "blurb_review";
    this.store.save();
    await this.dm(p, r.reply, "Here's exactly how I'd describe you to a founder. Nothing goes out without your OK:", p.blurb, "Anything you'd change?");
  }

  private async onBlurbReview(p: Person, text: string) {
    const i = await this.brain.classify("Anything you'd change about the blurb?", text);
    if (i === "yes" || /^(no|nope|nah)[,.! ]*(looks|it'?s|all)?\s*(good|great|right|fine)?[.! ]*$/i.test(text.trim()) || /looks (good|right|great)/i.test(text)) {
      p.stage = "ready";
      this.store.save();
      await this.dm(p, "Perfect. I'll stay quiet until I find someone worth your time.");
      this.later(this.opts.matchDelayMs, () => this.proposeNext(p));
      return;
    }
    const r = await this.brain.reviseBlurb(p, text);
    p.blurb = r.blurb;
    p.hideComp = p.hideComp || r.hideComp;
    this.store.save();
    await this.dm(p, r.hideComp ? "Done. Founders only see your range after you've both said yes." : "Updated:", ...(r.hideComp ? [] : [p.blurb]), "Good to go?");
  }

  // ------------------------------------------------------------------ matching + double opt-in
  async proposeNext(c: Person) {
    const ranked = rankFounders(c, this.store.people, this.store.intros);
    this.store.addLog("decision", `match ${c.first}: ${ranked.map((r) => `${r.founder.first}=${r.score}`).join(", ") || "no candidates"}`);
    const top = ranked.find((r) => r.score >= MIN_SCORE);
    if (!top) {
      await this.dm(c, "Still looking. Nobody I've seen yet clears the bar for you, and I'd rather wait than waste your time.");
      return;
    }
    const pitch = await this.brain.pitch(c, top.founder, top.reasons);
    const intro: Intro = {
      id: `i_${randomUUID().slice(0, 8)}`, candidateId: c.id, founderId: top.founder.id, status: "asked_candidate",
      reasons: top.reasons, score: top.score, pitch, feedback: {}, createdAt: new Date().toISOString(),
    };
    this.store.addIntro(intro);
    await this.dm(c, ...pitch.toCandidate);
  }

  private async onCandidateAnswer(intro: Intro, text: string) {
    const c = this.store.person(intro.candidateId)!, f = this.store.person(intro.founderId)!;
    const i = await this.brain.classify(`Want an intro to ${f.name}?`, text);
    this.store.addLog("decision", `${c.first} on ${f.first}: ${i}`);
    if (i === "yes") {
      intro.status = "asked_founder";
      this.store.save();
      await this.dm(c, `Great. I'll check with ${f.first} first. I only make an intro when both people want it, so nobody gets a cold message.`);
      await this.dm(f, ...intro.pitch!.toFounder);
      return;
    }
    if (i === "no") {
      intro.status = "declined_candidate";
      if (text.trim().split(/\s+/).length > 3) {
        intro.feedback[c.id] = text;
        this.store.save();
        await this.dm(c, "Got it, that helps. I'll keep looking.");
        this.later(this.opts.matchDelayMs, () => this.proposeNext(c));
      } else {
        intro.awaiting = [c.id];
        this.store.save();
        await this.dm(c, "No problem. What's the main reason? It helps me get the next one right.");
      }
      return;
    }
    if (i === "more") return this.dm(c, await this.brain.moreAbout(c, f));
    return this.dm(c, `Want me to intro you to ${f.first}? Yes or no is fine.`);
  }

  private async onFounderAnswer(intro: Intro, text: string) {
    const c = this.store.person(intro.candidateId)!, f = this.store.person(intro.founderId)!;
    const i = await this.brain.classify(`Want the intro to ${c.name}?`, text);
    this.store.addLog("decision", `${f.first} on ${c.first}: ${i}`);
    if (i === "yes") return this.connect(intro);
    if (i === "no") {
      intro.status = "declined_founder";
      this.store.save();
      await this.dm(f, "Understood, thanks for the fast answer.");
      await this.dm(c, `${f.first} is going to pass this time. That's about their side, not you. I'll keep looking.`);
      this.later(this.opts.matchDelayMs, () => this.proposeNext(c));
      return;
    }
    if (i === "more") return this.dm(f, await this.brain.moreAbout(f, c));
    return this.dm(f, `Want me to intro you to ${c.first}? Yes or no is fine.`);
  }

  /** The moment of connection: a new group thread with both people and Wren. */
  private async connect(intro: Intro) {
    const c = this.store.person(intro.candidateId)!, f = this.store.person(intro.founderId)!;
    const fp = f.founder!;
    const [opener, ...rest] = intro.pitch!.groupIntro;
    await this.dm(c, `${f.first}'s in. Starting a group text now.`);
    try {
      const displayName = `${c.first} + ${f.first} (${fp.company})`;
      const { chatId, messageId } = await this.t.createGroup([c.handle, f.handle], opener, displayName);
      this.store.ensureChat(chatId, { handles: [c.handle, f.handle], isGroup: true, displayName, introId: intro.id });
      this.record(chatId, opener, messageId);
      for (const line of rest) await this.say(chatId, line);
      intro.chatId = chatId;
      intro.status = "connected";
      this.store.save();
      this.store.addLog("decision", `connected ${c.first} + ${f.first} in ${chatId}`);
    } catch (err) {
      if (!(err instanceof TransportUnsupported)) throw err;
      // Relay intro for transports that can't start groups (Photon's local kit).
      intro.status = "connected";
      this.store.save();
      await this.dm(c, opener, `${f.first}'s number is ${f.handle}. ${rest.at(-1) ?? ""}`);
      await this.dm(f, `Here's ${c.first}: ${c.handle}. ${c.blurb ?? ""}`);
      this.store.addLog("decision", `relay intro ${c.first} + ${f.first} (transport can't create groups)`);
    }
  }

  // ------------------------------------------------------------------ group chats
  private async onGroup(e: InboundEvent) {
    const chat = this.store.chat(e.chatId)!;
    const intro = chat.introId ? this.store.intro(chat.introId) : undefined;
    const f = intro ? this.store.person(intro.founderId) : undefined;
    const history = chat.messages.slice(0, -1).map((m) => ({ who: this.nameOf(m.from), text: m.text }));
    const g = await this.brain.gate(history, this.nameOf(e.from), e.text, f?.founder?.slots ?? []);
    this.store.addLog("decision", `gate (${chat.displayName ?? chat.id}): ${g.action}${g.slot ? ` slot=${g.slot}` : ""}`);

    if (g.slot && intro && intro.status === "connected") {
      intro.slot = g.slot;
      intro.status = "scheduled";
      this.store.save();
      await this.say(chat.id, `Locked in: ${g.slot}. I'll send you both a short prep note the day before. Stepping out now. Have a great conversation.`);
      this.later(this.opts.followupDelayMs, () => this.followUp(intro));
      return;
    }
    if (g.action === "react" && e.messageId) {
      await this.t.react(chat.id, e.messageId, "love");
      const m = chat.messages.find((x) => x.id === e.messageId);
      if (m) { m.reaction = "love"; this.store.save(); this.store.emit("change", { type: "reaction", chatId: chat.id }); }
      return;
    }
    if (g.action === "respond") {
      const ctx = intro && f ? { offeredTimes: f.founder?.slots, company: f.founder?.company, role: f.founder?.roleTitle, status: intro.status } : {};
      await this.say(chat.id, await this.brain.groupReply([...history, { who: this.nameOf(e.from), text: e.text }], ctx));
    }
  }

  private async followUp(intro: Intro) {
    const c = this.store.person(intro.candidateId)!, f = this.store.person(intro.founderId)!;
    intro.status = "followed_up";
    intro.awaiting = [c.id, f.id];
    this.store.save();
    await this.dm(c, `How did it go with ${f.first}?`);
    await this.dm(f, `How did it go with ${c.first}? Honest is most useful. ${c.first} won't see this.`);
  }

  private async onAwaitedAnswer(p: Person, intro: Intro, text: string) {
    intro.feedback[p.id] = text;
    intro.awaiting = intro.awaiting!.filter((id) => id !== p.id);
    this.store.save();
    if (intro.status === "declined_candidate") {
      await this.dm(p, "Thanks, noted. I'll factor that in.");
      this.later(this.opts.matchDelayMs, () => this.proposeNext(p));
      return;
    }
    const good = /\b(great|good|well|amazing|loved|next step|moving forward|excited|offer)\b/i.test(text) && !/\bnot\b/i.test(text);
    await this.dm(p, good
      ? "Love that. I'll stay close and help with the offer conversation when you get there."
      : "Thanks for telling me. That changes who I suggest next.");
    if (!intro.awaiting.length) this.store.addLog("decision", `feedback complete for ${intro.id}: ${JSON.stringify(intro.feedback)}`);
  }

  private async smallTalk(p: Person) {
    const chat = this.store.dmChatFor(p.handle);
    const history = (chat?.messages ?? []).map((m) => ({ who: this.nameOf(m.from), text: m.text }));
    const open = this.store.intros.filter((i) => i.candidateId === p.id || i.founderId === p.id);
    const status = p.role === "founder"
      ? "Nothing waiting on you right now. I'll text you when I have someone great for your role."
      : open.length
        ? "I'm on it. I'll text you the moment I have the next person worth meeting."
        : "Still looking. I'd rather wait for a great intro than send you a mediocre one.";
    await this.dm(p, await this.brain.chat(p, history, status));
  }

  // ------------------------------------------------------------------ outbound helpers
  private nameOf(handle: string) {
    if (handle === this.t.agentHandle) return "Wren";
    return this.store.byHandle(handle)?.first ?? handle;
  }

  private record(chatId: string, text: string, messageId?: string) {
    this.store.pushMessage(chatId, { id: messageId ?? randomUUID(), from: this.t.agentHandle, text, at: new Date().toISOString() });
    const chat = this.store.chat(chatId);
    this.store.addLog("outbound", `Wren -> ${chat?.isGroup ? chat.displayName : chat?.handles.map((h) => this.nameOf(h)).join(",")}: ${text}`);
  }

  async dm(p: Person, ...texts: string[]) {
    if (p.optedOut) {
      this.store.addLog("decision", `skipped ${texts.length} text(s) to ${p.first}: opted out`);
      return;
    }
    for (const text of texts.filter(Boolean)) {
      const { chatId, messageId } = await this.t.sendDM(p.handle, text);
      this.store.ensureChat(chatId, { handles: [p.handle], isGroup: false });
      this.record(chatId, text, messageId);
    }
  }

  async say(chatId: string, ...texts: string[]) {
    for (const text of texts.filter(Boolean)) {
      const { messageId } = await this.t.sendToChat(chatId, text);
      this.record(chatId, text, messageId);
    }
  }
}
