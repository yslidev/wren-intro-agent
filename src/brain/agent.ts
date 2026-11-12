import { randomUUID } from "node:crypto";
import type { Store } from "../store.js";
import { TransportUnsupported, type Transport } from "../transports/types.js";
import type { FounderProfile, InboundEvent, Intro, Person } from "../types.js";
import { CANDIDATE_QUESTIONS, parseJD, parseResume, ROLE_QUESTIONS, soundsLikeHiring, soundsLikeSkip } from "./intake.js";
import type { Brain } from "./llm.js";
import { MIN_SCORE, rankCandidates, rankFounders, renderReasons } from "./match.js";
import { personaGroupHello, personaMove } from "./personas.js";
import { extractFloorK, extractName, extractSetups, extractSkills, isOptOut } from "./text.js";
import { say } from "./voice.js";

export interface AgentOptions { matchDelayMs: number; followupDelayMs: number; personaDelayMs?: number }

const DEFAULT_SLOTS = ["Thu 10:00 AM PT", "Fri 2:00 PM PT"];

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

  /** Fictional people never get real texts. Their messages stay in the store, and the persona engine answers. */
  private isPersona(p: Person) { return Boolean(p.simulated || (p.fictional && this.t.name !== "sim")); }
  /** Real group chats with personas only exist in the simulator; elsewhere Wren shows the intro it would send. */
  private canGroupWith(...ps: Person[]) { return this.t.name === "sim" || !ps.some((p) => this.isPersona(p)); }

  // ------------------------------------------------------------------ inbound
  private async process(e: InboundEvent) {
    // iPhones send smart punctuation ("I’m", “quotes”). Normalize once so every rule downstream sees plain ASCII.
    e = { ...e, text: e.text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...") };
    const s = this.store;
    const chat = s.ensureChat(e.chatId, { handles: e.isGroup ? (e.participants ?? [e.from]) : [e.from], isGroup: e.isGroup });
    if (e.isGroup && !chat.handles.includes(e.from)) chat.handles.push(e.from);
    s.pushMessage(chat.id, { id: e.messageId ?? randomUUID(), from: e.from, text: e.text, at: new Date().toISOString() });
    const who = s.byHandle(e.from);
    s.addLog("inbound", `${who?.first || e.from}${who && this.isPersona(who) ? " (persona)" : ""} ${e.isGroup ? `in ${chat.displayName ?? "group"}` : "(DM)"}: ${e.text}`);
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
      this.store.addLog("decision", `${p?.first || e.from} opted out (${e.text.trim()}). Wren will not text them until they write again.`);
      return;
    }
    if (p?.optedOut) {
      p.optedOut = false;
      this.store.save();
      this.store.addLog("decision", `${p.first} texted again, opt-out cleared`);
    }
    if (!p) {
      p = this.store.addPerson({
        id: `c_${randomUUID().slice(0, 8)}`, handle: e.from, name: "", first: "", role: "candidate",
        stage: "naming", asked: 0, notes: [], candidate: { title: "", years: 0, skills: [] },
      });
      await this.dm(p, say.helloStranger(p.id));
      return;
    }

    // Free-text answers Wren asked for (decline reasons, post-call feedback) come first.
    const waiting = this.store.intros.find((i) => i.awaiting?.includes(p!.id));
    if (waiting) return this.onAwaitedAnswer(p, waiting, e.text);

    // Older records (or a contact who skipped the name question) get asked their name first.
    if (p.stage === "naming" || (p.stage === "new" && !p.vouch && (!p.first || p.first === "there"))) return this.onName(p, e.text);

    switch (p.stage) {
      case "side": return this.onSide(p, e.text);
      // ---- hiring side
      case "company": return this.onCompany(p, e.text);
      case "jd": return this.onJD(p, e.text);
      case "role_interview": return this.onRoleAnswer(p, e.text);
      case "role_review": return this.onRoleReview(p, e.text);
      // ---- candidate side
      case "new":
        if (!p.vouch) return this.onVoucher(p, e.text);
        return this.startInterview(p);
      case "resume": return this.onResume(p, e.text);
      case "interviewing": return this.onInterviewAnswer(p, e.text);
      case "blurb_review": return this.onBlurbReview(p, e.text);
      case "ready": {
        if (p.role === "founder") {
          const ask = this.store.openIntroFor(p.id, ["asked_founder"]);
          if (ask) return this.onFounderAnswer(ask, e.text);
        } else {
          const ask = this.store.openIntroFor(p.id, ["asked_candidate"]);
          if (ask) return this.onCandidateAnswer(ask, e.text);
        }
        return this.smallTalk(p);
      }
    }
  }

  private async onName(p: Person, text: string) {
    const r = await this.brain.readIntake("name", text);
    if (!r.name) return this.dm(p, say.askNameAgain(`${p.id}:${text.length}`));
    p.name = r.name;
    p.first = r.name.split(/\s+/)[0];
    // Someone who opens with "I'm Yushan, hiring for my startup" skips the next question.
    if (r.side === "hiring") return this.becomeHiring(p);
    if (r.side === "looking") return this.toVoucherStep(p);
    p.stage = "side";
    this.store.save();
    await this.dm(p, say.askSide(p.id, p.first));
  }

  private async onSide(p: Person, text: string) {
    const r = await this.brain.readIntake("side", text);
    // "My name is Yushan" arriving late: fix the name, then ask again.
    if (r.name && r.name !== p.name) { p.name = r.name; p.first = r.name.split(/\s+/)[0]; this.store.save(); }
    if (r.side === "hiring") return this.becomeHiring(p);
    if (r.side === "looking") return this.toVoucherStep(p);
    return this.dm(p, r.name ? say.askSide(`${p.id}:again`, p.first) : say.askSideAgain);
  }

  private async toVoucherStep(p: Person) {
    p.stage = "new";
    this.store.save();
    await this.dm(p, say.askVoucher(p.id, p.first));
  }

  private async onVoucher(p: Person, text: string) {
    const r = await this.brain.readIntake("voucher", text);
    if (!r.voucher) return this.dm(p, say.askVoucherAgain);
    const nobody = r.voucher.toLowerCase() === "nobody";
    p.vouch = nobody
      ? { name: "no one yet", relation: "found Wren directly", quote: "" }
      : { name: r.voucher, relation: "said they referred them (not yet confirmed)", quote: "" };
    p.stage = "resume";
    this.store.save();
    await this.dm(p, nobody ? say.noVoucher : say.thanksVoucher(p.id, { first: p.first, voucher: r.voucher }), say.resumeAsk(p.id));
  }

  // ------------------------------------------------------------------ hiring-side intake
  private async becomeHiring(p: Person) {
    p.role = "founder";
    p.candidate = undefined;
    p.founder = { company: "", stage: "early-stage", sector: "", roleTitle: "", bandK: [0, 0], equity: "", setup: "", mustHaves: [], problem: "", slots: DEFAULT_SLOTS };
    p.stage = "company";
    this.store.save();
    await this.dm(p, say.askCompany(p.id, p.first));
  }

  private async onCompany(p: Person, text: string) {
    p.founder!.company = text.trim().replace(/^(it'?s|we'?re|i'?m at|at)\s+/i, "").replace(/[.!]+$/, "").slice(0, 60);
    p.stage = "jd";
    this.store.save();
    await this.dm(p, say.askJD(p.id, p.founder!.company));
  }

  private async onJD(p: Person, text: string) {
    const fp = p.founder!;
    const parsed = parseJD(text);
    fp.jd = text.slice(0, 4000);
    fp.roleTitle = parsed.roleTitle || fp.roleTitle || "the role";
    if (parsed.bandK) fp.bandK = parsed.bandK;
    if (parsed.equity) fp.equity = parsed.equity;
    if (parsed.setup) fp.setup = parsed.setup;
    fp.mustHaves = [...new Set([...fp.mustHaves, ...extractSkills(text)])];
    p.stage = "role_interview";
    p.asked = 1;
    this.store.save();
    this.store.addLog("decision", `${p.first}'s role: ${fp.roleTitle} at ${fp.company}, needs ${fp.mustHaves.join(",") || "?"}, band ${fp.bandK.join("-")}K`);
    await this.dm(p, say.jdRead(p.id, fp.roleTitle), ROLE_QUESTIONS[0].ask);
  }

  private async onRoleAnswer(p: Person, text: string) {
    const fp = p.founder!;
    const q = ROLE_QUESTIONS[p.asked - 1];
    if (q.key === "success") { fp.success = text; fp.problem = `what great looks like at 90 days: ${lowerFirst(text.replace(/[.!]+$/, ""))}`; }
    if (q.key === "antiPattern") { fp.antiPattern = text; fp.mustHaves = [...new Set([...fp.mustHaves, ...extractSkills(text)])]; }
    if (q.key === "pitch") fp.pitch = text;
    if (q.key === "practical") {
      const j = parseJD(text);
      if (j.bandK) fp.bandK = j.bandK;
      else { const f = extractFloorK(text); if (f) fp.bandK = [f, f + 30]; }
      if (j.equity) fp.equity = j.equity;
      const s = extractSetups(text)[0] ?? j.setup;
      if (s) fp.setup = s;
    }
    const next = ROLE_QUESTIONS[p.asked];
    if (next) {
      p.asked += 1;
      this.store.save();
      return this.dm(p, `${say.ackRole(`${p.id}:${p.asked}`)} ${next.ask}`);
    }
    p.stage = "role_review";
    this.store.save();
    await this.dm(p, say.roleCardIntro(p.id), roleCard(fp), say.blurbAsk);
  }

  private async onRoleReview(p: Person, text: string) {
    const fp = p.founder!;
    const i = await this.brain.classify("Anything you'd change about the role card?", text);
    if (i === "yes" || /looks (good|right|great)|^(no|nope|nah)[,.! ]*(looks|all)?\s*(good|great|right|fine)?[.! ]*$/i.test(text.trim())) {
      p.stage = "ready";
      this.store.save();
      await this.dm(p, say.roleReady(p.id));
      this.later(this.opts.matchDelayMs, () => this.proposeCandidateTo(p));
      return;
    }
    fp.pitch = [fp.pitch, text].filter(Boolean).join(" ");
    this.store.save();
    await this.dm(p, say.blurbUpdated, roleCard(fp), say.blurbConfirm);
  }

  /** Employer-initiated: Wren finds the best candidate for a role and asks the hiring side first. */
  async proposeCandidateTo(f: Person) {
    const ranked = rankCandidates(f, this.store.people, this.store.intros);
    this.store.addLog("decision", `match for ${f.first}'s ${f.founder?.roleTitle}: ${ranked.slice(0, 5).map((r) => `${r.candidate.first}=${r.score}`).join(", ") || "nobody yet"}`);
    const top = ranked.find((r) => r.score >= MIN_SCORE);
    if (!top) return this.dm(f, say.noCandidate(f.id));
    const c = top.candidate;
    const pitch = await this.brain.pitch(c, f, top.reasons);
    const intro: Intro = {
      id: `i_${randomUUID().slice(0, 8)}`, candidateId: c.id, founderId: f.id, status: "asked_founder", initiatedBy: "founder",
      reasons: top.reasons.map((r) => renderReasons([r], c.first)), score: top.score, pitch, feedback: {}, createdAt: new Date().toISOString(),
    };
    this.store.addIntro(intro);
    // Candidates stay anonymous until they say yes: the hiring side sees the work, not the name.
    const anon = (s: string) => s.split(c.name).join("This person").split(c.first).join("they");
    await this.dm(f, say.foundCandidate(f.id), anon(c.blurb ?? c.candidate?.title ?? "Someone I know well."), `Why I think so: ${renderReasons(top.reasons, "this person", 2)}.`, say.askReachOut);
  }

  // ------------------------------------------------------------------ candidate intake
  /** Wren texts first, using the vouch, the way a friend-of-a-friend would. */
  async kickoff(personId: string) {
    const p = this.store.person(personId);
    if (!p) throw new Error(`no person ${personId}`);
    if (p.role === "candidate" && p.stage === "new") return this.startInterview(p);
    if (p.role === "candidate" && p.stage === "ready") return this.proposeNext(p);
    if (p.role === "founder" && p.stage === "ready" && p.founder?.roleTitle) return this.proposeCandidateTo(p);
    await this.dm(p, `Hi ${p.first}, it's Wren 🐦. I'll text you when I have someone worth your time.`);
  }

  private async onResume(p: Person, text: string) {
    const c = p.candidate!;
    if (!soundsLikeSkip(text)) {
      const r = parseResume(text);
      c.resume = text.slice(0, 4000);
      if (r.title) c.title = r.title;
      if (r.years) c.years = r.years;
      c.skills = [...new Set([...c.skills, ...extractSkills(text)])];
      this.store.addLog("decision", `${p.first}'s resume: ${c.title || "?"}, ${c.years || "?"} yrs, skills ${c.skills.join(",") || "?"}`);
      await this.dm(p, say.resumeRead(p.id));
    } else {
      await this.dm(p, say.resumeSkipped(p.id));
    }
    return this.startInterview(p, true);
  }

  private async startInterview(p: Person, afterResume = false) {
    p.stage = "interviewing";
    p.asked = 1;
    this.store.save();
    const q1 = `${say.interviewIntro(CANDIDATE_QUESTIONS.length)} ${CANDIDATE_QUESTIONS[0].ask}`;
    if (p.vouch?.quote && !afterResume) {
      await this.dm(p, say.helloVouched(p.id, { first: p.first, voucher: p.vouch.name, quote: p.vouch.quote }), say.whoAmI(p.id), q1);
    } else {
      await this.dm(p, q1);
    }
  }

  private async onInterviewAnswer(p: Person, text: string) {
    const q = CANDIDATE_QUESTIONS[p.asked - 1];
    const c = p.candidate!;
    if (q.key === "proudest") c.proudest = text;
    if (q.key === "whyLeave") c.whyLeave = text;
    if (q.key === "energy") c.energy = text;
    const next = CANDIDATE_QUESTIONS[p.asked]?.ask;
    const r = await this.brain.interviewTurn(p, q.ask, text, next);
    if (r.floorK) c.floorK = r.floorK;
    if (r.setups.length) c.setups = [...new Set([...(c.setups ?? []), ...r.setups])];
    if (r.stages.length) c.stages = [...new Set([...(c.stages ?? []), ...r.stages])];
    if (r.skills.length) c.skills = [...new Set([...c.skills, ...r.skills.map((s) => s.toLowerCase())])];
    this.store.addLog("decision", `${p.first} profile: floor=${c.floorK ?? "?"}K setups=${(c.setups ?? []).join("/") || "?"} skills=${c.skills.join(",") || "?"}`);

    if (next) {
      p.asked += 1;
      this.store.save();
      return this.dm(p, r.reply);
    }
    p.blurb = await this.brain.writeBlurb(p);
    p.stage = "blurb_review";
    this.store.save();
    await this.dm(p, r.reply, say.blurbIntro(p.id), p.blurb, say.blurbAsk);
  }

  private async onBlurbReview(p: Person, text: string) {
    const i = await this.brain.classify("Anything you'd change about the blurb?", text);
    if (i === "yes" || /^(no|nope|nah)[,.! ]*(looks|it'?s|all)?\s*(good|great|right|fine)?[.! ]*$/i.test(text.trim()) || /looks (good|right|great)/i.test(text)) {
      p.stage = "ready";
      this.store.save();
      await this.dm(p, say.ready(p.id));
      this.later(this.opts.matchDelayMs, () => this.proposeNext(p));
      return;
    }
    const r = await this.brain.reviseBlurb(p, text);
    p.blurb = r.blurb;
    p.hideComp = p.hideComp || r.hideComp;
    this.store.save();
    await this.dm(p, r.hideComp ? say.blurbHidden : say.blurbUpdated, ...(r.hideComp ? [] : [p.blurb]), say.blurbConfirm);
  }

  // ------------------------------------------------------------------ matching + double opt-in
  /** Candidate-initiated: Wren finds the best role for a candidate and asks the candidate first. */
  async proposeNext(c: Person) {
    const ranked = rankFounders(c, this.store.people, this.store.intros);
    this.store.addLog("decision", `match ${c.first}: ${ranked.slice(0, 5).map((r) => `${r.founder.first} (${r.founder.founder?.company})=${r.score}`).join(", ") || "no candidates"}${ranked.length > 5 ? ` +${ranked.length - 5} more` : ""}`);
    const top = ranked.find((r) => r.score >= MIN_SCORE);
    if (!top) {
      await this.dm(c, say.noMatch(c.id));
      return;
    }
    const pitch = await this.brain.pitch(c, top.founder, top.reasons);
    const intro: Intro = {
      id: `i_${randomUUID().slice(0, 8)}`, candidateId: c.id, founderId: top.founder.id, status: "asked_candidate", initiatedBy: "candidate",
      reasons: top.reasons.map((r) => renderReasons([r], c.first)), score: top.score, pitch, feedback: {}, createdAt: new Date().toISOString(),
    };
    this.store.addIntro(intro);
    await this.dm(c, ...pitch.toCandidate);
  }

  private async onCandidateAnswer(intro: Intro, text: string) {
    const c = this.store.person(intro.candidateId)!, f = this.store.person(intro.founderId)!;
    const i = await this.brain.classify(`Want an intro to ${f.name}?`, text);
    this.store.addLog("decision", `${c.first} on ${f.first}: ${i}`);
    const founderFirst = intro.initiatedBy === "founder";
    if (i === "yes") {
      if (founderFirst) return this.connect(intro); // the hiring side already said yes
      intro.status = "asked_founder";
      this.store.save();
      await this.dm(c, say.checkingFounder(c.id, f.first));
      await this.dm(f, ...intro.pitch!.toFounder);
      return;
    }
    if (i === "no") {
      intro.status = "declined_candidate";
      if (founderFirst) await this.dm(f, say.candidatePassToFounder(f.id, c.first));
      if (text.trim().split(/\s+/).length > 3) {
        intro.feedback[c.id] = text;
        this.store.save();
        await this.dm(c, say.candidatePassNoted(c.id));
        if (!founderFirst) this.later(this.opts.matchDelayMs, () => this.proposeNext(c));
      } else {
        intro.awaiting = [c.id];
        this.store.save();
        await this.dm(c, say.candidatePass(c.id));
      }
      if (founderFirst) this.later(this.opts.matchDelayMs, () => this.proposeCandidateTo(f));
      return;
    }
    if (i === "more") return this.dm(c, await this.brain.moreAbout(c, f));
    return this.dm(c, say.nudge(f.first, false));
  }

  private async onFounderAnswer(intro: Intro, text: string) {
    const c = this.store.person(intro.candidateId)!, f = this.store.person(intro.founderId)!;
    const i = await this.brain.classify(`Want the intro to ${c.name}?`, text);
    this.store.addLog("decision", `${f.first} on ${c.first}: ${i}`);
    const founderFirst = intro.initiatedBy === "founder";
    if (i === "yes") {
      if (!founderFirst) return this.connect(intro);
      intro.status = "asked_candidate";
      this.store.save();
      await this.dm(f, say.checkingCandidate(f.id));
      await this.dm(c, ...intro.pitch!.toCandidate);
      return;
    }
    if (i === "no") {
      intro.status = "declined_founder";
      this.store.save();
      await this.dm(f, say.founderPassToFounder(f.id));
      if (founderFirst) this.later(this.opts.matchDelayMs, () => this.proposeCandidateTo(f));
      else {
        await this.dm(c, say.founderPassToCandidate(c.id, f.first));
        this.later(this.opts.matchDelayMs, () => this.proposeNext(c));
      }
      return;
    }
    if (i === "more") {
      const more = await this.brain.moreAbout(f, c);
      return this.dm(f, founderFirst ? more.split(c.name).join("This person").split(c.first).join("They") : more);
    }
    return this.dm(f, founderFirst ? say.askReachOut : say.nudge(c.first, true));
  }

  /**
   * The moment of connection. Like a friend's intro text, but done the way Ditto does it: Wren opens a named
   * group chat with both people, introduces each to the other in a line, puts what's already settled on the
   * table, offers times, then steps back so the two of them actually talk.
   */
  private async connect(intro: Intro) {
    const c = this.store.person(intro.candidateId)!, f = this.store.person(intro.founderId)!;
    const fp = f.founder!;
    const [opener, ...rest] = intro.pitch!.groupIntro;

    if (!this.canGroupWith(c, f)) {
      // A real person matched with a demo persona: show exactly the intro Wren would send, then follow up later.
      intro.status = "connected";
      this.store.save();
      const real = [c, f].filter((p) => !this.isPersona(p));
      for (const p of real) await this.dm(p, say.demoIntroNote(p.id, (p === c ? f : c).first), ...rest);
      this.store.addLog("decision", `demo intro ${c.first} + ${f.first} (persona, no real group)`);
      this.later(this.opts.followupDelayMs, () => this.followUp(intro));
      return;
    }

    await this.dm(c, say.founderIn(c.id, f.first));
    if (intro.initiatedBy === "founder") await this.dm(f, say.founderIn(f.id, c.first));
    try {
      const displayName = `${c.first} & ${f.first} 🤝`;
      const { chatId, messageId } = await this.t.createGroup([c.handle, f.handle], opener, displayName);
      this.store.ensureChat(chatId, { handles: [c.handle, f.handle], isGroup: true, displayName, introId: intro.id });
      this.record(chatId, opener, messageId);
      for (const line of rest) await this.say(chatId, line);
      intro.chatId = chatId;
      intro.status = "connected";
      this.store.save();
      this.store.addLog("decision", `connected ${c.first} + ${f.first} in "${displayName}" (${fp.company})`);
      for (const p of [f, c]) {
        if (!this.isPersona(p)) continue;
        const other = p === f ? c : f;
        this.later(this.opts.personaDelayMs ?? 3000, () =>
          this.handle({ chatId, isGroup: true, from: p.handle, text: p === f ? personaGroupHello(f, c.first) : `Hi ${other.first}! So glad Wren connected us.`, messageId: randomUUID(), participants: [c.handle, f.handle] }));
      }
    } catch (err) {
      if (!(err instanceof TransportUnsupported)) throw err;
      // Relay intro for transports that can't start groups (Photon local kit, Spectrum shared lines).
      intro.status = "connected";
      this.store.save();
      await this.dm(c, ...rest.slice(0, -1), `${f.first}'s number is ${f.handle}. ${rest.at(-1) ?? ""}`);
      await this.dm(f, `Here's ${c.first}: ${c.handle}. ${c.blurb ?? ""}`);
      this.store.addLog("decision", `relay intro ${c.first} + ${f.first} (transport can't create groups)`);
      this.later(this.opts.followupDelayMs, () => this.followUp(intro));
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
      await this.say(chat.id, say.locked(intro.id, g.slot));
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
    if (intro.status === "followed_up") return;
    intro.status = "followed_up";
    intro.awaiting = [c.id, f.id];
    this.store.save();
    await this.dm(c, say.howDidItGo(f.first));
    await this.dm(f, say.howDidItGoFounder(c.first));
  }

  private async onAwaitedAnswer(p: Person, intro: Intro, text: string) {
    intro.feedback[p.id] = text;
    intro.awaiting = intro.awaiting!.filter((id) => id !== p.id);
    this.store.save();
    if (intro.status === "declined_candidate") {
      await this.dm(p, say.reasonNoted);
      if (intro.initiatedBy !== "founder") this.later(this.opts.matchDelayMs, () => this.proposeNext(p));
      return;
    }
    const good = /\b(great|good|well|amazing|loved|next (step|round)|moving (forward|fwd)|excited|offer|continue|solid|obsessed)\b/i.test(text) && !/\bnot\b/i.test(text);
    await this.dm(p, good ? say.feedbackGood(`${p.id}:${intro.id}`) : say.feedbackMeh(`${p.id}:${intro.id}`));
    if (!intro.awaiting.length) this.store.addLog("decision", `feedback complete for ${intro.id}: ${JSON.stringify(intro.feedback)}`);
  }

  private async smallTalk(p: Person) {
    const chat = this.store.dmChatFor(p.handle);
    const history = (chat?.messages ?? []).map((m) => ({ who: this.nameOf(m.from), text: m.text }));
    const open = this.store.intros.filter((i) => i.candidateId === p.id || i.founderId === p.id);
    const status = p.role === "founder" ? say.statusFounder : open.length ? say.statusOpen : say.statusNone;
    await this.dm(p, await this.brain.chat(p, history, status));
  }

  // ------------------------------------------------------------------ personas
  /** After Wren texts a fictional person, they answer in their own voice (if there's something to answer). */
  private schedulePersona(p: Person, chatId: string, lastText: string) {
    this.later(this.opts.personaDelayMs ?? 3000, async () => {
      const move = personaMove(p, this.store.intros, (id) => this.store.person(id), lastText);
      if (move.kind === "none") return;
      this.store.addLog("decision", `persona ${p.first} (${p.persona?.voice ?? "candidate"}): ${move.kind === "decide" ? move.answer : "feedback"}`);
      await this.handle({ chatId, isGroup: false, from: p.handle, text: move.text, messageId: randomUUID() });
    });
  }

  // ------------------------------------------------------------------ outbound helpers
  private nameOf(handle: string) {
    if (handle === this.t.agentHandle) return "Wren";
    return this.store.byHandle(handle)?.first || handle;
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
    const lines = texts.filter(Boolean);
    if (!lines.length) return;
    let chatId = "";
    for (const text of lines) {
      if (this.isPersona(p) && this.t.name !== "sim") {
        // Never text a fictional number over a real network.
        chatId = `persona:${p.handle}`;
        this.store.ensureChat(chatId, { handles: [p.handle], isGroup: false });
        this.record(chatId, text);
        continue;
      }
      const sent = await this.t.sendDM(p.handle, text);
      chatId = sent.chatId;
      this.store.ensureChat(chatId, { handles: [p.handle], isGroup: false });
      this.record(chatId, text, sent.messageId);
    }
    if (this.isPersona(p)) this.schedulePersona(p, chatId, lines.at(-1)!);
  }

  async say(chatId: string, ...texts: string[]) {
    for (const text of texts.filter(Boolean)) {
      const { messageId } = await this.t.sendToChat(chatId, text);
      this.record(chatId, text, messageId);
    }
  }
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** How Wren will describe the role to candidates. The hiring side approves it, like candidates approve their blurb. */
export function roleCard(fp: FounderProfile): string {
  const band = fp.bandK[0] ? `$${fp.bandK[0]}-${fp.bandK[1]}K${fp.equity ? ` + ${fp.equity}` : ""}` : "pay TBD";
  return [
    `${fp.roleTitle} at ${fp.company}${fp.setup ? `, ${fp.setup}` : ""}. ${band}.`,
    fp.success ? `Great at 90 days: ${fp.success.trim().replace(/[.!]*$/, ".")}` : "",
    fp.mustHaves.length ? `Must have: ${fp.mustHaves.slice(0, 5).join(", ")}.` : "",
    fp.pitch ? `The honest pitch and catch: ${fp.pitch.trim().replace(/[.!]*$/, ".")}` : "",
  ].filter(Boolean).join(" ");
}
