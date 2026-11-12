import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.MATCH_DELAY_MS = "5";
process.env.FOLLOWUP_DELAY_MS = "5";
process.env.PERSONA_DELAY_MS = "5";

const { buildApp } = await import("../src/app.js");
const { extractName, extractSkills } = await import("../src/brain/text.js");
import type { Transport } from "../src/transports/types.js";

/** A stand-in for a real network (Spectrum/Linq): records every text that would hit a phone. */
class RecordingTransport implements Transport {
  readonly name = "fake-network";
  readonly agentHandle = "+19995550000";
  sent: { to: string; text: string }[] = [];
  async sendDM(to: string, text: string) { this.sent.push({ to, text }); return { chatId: `real:${to}`, messageId: crypto.randomUUID() }; }
  async sendToChat(chatId: string, text: string) { this.sent.push({ to: chatId, text }); return { messageId: crypto.randomUUID() }; }
  async createGroup(handles: string[], opener: string) { this.sent.push({ to: handles.join(","), text: opener }); return { chatId: "real:group" }; }
  async react() {}
  async start() {}
}

const net = new RecordingTransport();
const built = buildApp({ transport: net, persist: false, llm: false, world: true });
const { agent, store } = built;
after(() => agent.stop());

const ME = "+13415550111";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const send = (text: string) => agent.handle({ chatId: `real:${ME}`, isGroup: false, from: ME, text, messageId: crypto.randomUUID() });
const lastToMe = () => net.sent.filter((s) => s.to === ME).at(-1)?.text ?? "";
const waitFor = async (cond: () => boolean, label: string) => {
  for (let i = 0; i < 400; i++) { if (cond()) return; await sleep(5); }
  assert.fail(`timed out waiting for: ${label}\nlast to me: ${lastToMe()}`);
};

test("helpers: names and skills from plain text", () => {
  assert.deepEqual(extractName("hey it's yushan li!"), { first: "Yushan", name: "Yushan Li" });
  assert.deepEqual(extractName("Yushan"), { first: "Yushan", name: "Yushan" });
  assert.ok(extractSkills("Rebuilt the billing pipeline and cut chargebacks with an ML model").includes("payments"));
  assert.ok(extractSkills("I run user research and redesigned onboarding in Figma").includes("design"));
});

test("the world loads: ~150 fictional people, recruiters have voices", () => {
  const sims = store.people.filter((p) => p.simulated);
  assert.ok(sims.length > 100, `expected a big world, got ${sims.length}`);
  assert.ok(sims.some((p) => p.persona?.kind === "agency_recruiter"));
  assert.ok(sims.every((p) => /^\+1\d{3}55501\d{2}$/.test(p.handle)), "world numbers stay in the 555-01XX fiction range");
});

test("a stranger texts in, gets onboarded, and a persona recruiter answers on its own", async () => {
  await send("Yo");
  assert.match(lastToMe(), /What should I call you|what's your name/i);
  await send("it's Yushan");
  assert.match(lastToMe(), /hiring/);
  await send("open to something new");
  assert.match(lastToMe(), /Who (sent|pointed)/);
  await send("Maya Chen");
  assert.match(lastToMe(), /resume/i);
  await send("Senior Product Manager at Corvid, 6 years. Led merchant onboarding and payments risk. B2B SaaS.");
  assert.match(lastToMe(), /proudest/);
  assert.equal(store.byHandle(ME)!.candidate!.years, 6);
  await send("Rebuilt merchant onboarding and payments risk checks, cut activation time from 6 days to 1");
  await send("Untangling messy workflows with customers on the phone. Drained by politics.");
  await send("Smaller team, more ownership, closer to customers");
  await send("$175k, remote or hybrid");
  assert.match(lastToMe(), /Anything you'd change\?/);
  const me = store.byHandle(ME)!;
  assert.ok(me.candidate!.skills.includes("payments") && me.candidate!.skills.includes("onboarding"), `skills: ${me.candidate!.skills}`);

  await send("looks good");
  await waitFor(() => /Want an intro\?/.test(lastToMe()), "match proposal from the world");
  const intro = store.intros.at(-1)!;
  const founder = store.person(intro.founderId)!;
  assert.ok(founder.fictional, "matched with a fictional person, played by the persona engine");

  await send("yes");
  // The persona replies by itself; it may ask for more first, in which case Wren answers and it decides.
  await waitFor(() => ["connected", "followed_up", "declined_founder"].includes(intro.status), "persona decision");
  if (intro.status !== "declined_founder") {
    await waitFor(() => /How did it go with/.test(lastToMe()), "follow-up");
    await send("really good, next round");
    await waitFor(() => (intro.awaiting ?? []).length === 0, "persona feedback");
  }

  const fictional = new Set(store.people.filter((p) => p.fictional).map((p) => p.handle));
  assert.ok(!net.sent.some((s) => s.to.split(",").some((h) => fictional.has(h))), "never texts a fictional number over the network");
  const personaChat = store.chat(`persona:${founder.handle}`);
  assert.ok(personaChat && personaChat.messages.some((m) => m.from === founder.handle), "persona texted back in its own thread");
});

test("a hiring manager texts in with a JD, gets a role card, and Wren finds and pitches a candidate", async () => {
  const HR = "+13415550122";
  const hr = (text: string) => agent.handle({ chatId: `real:${HR}`, isGroup: false, from: HR, text, messageId: crypto.randomUUID() });
  const lastToHR = () => net.sent.filter((s) => s.to === HR).at(-1)?.text ?? "";
  await hr("hi! a friend said you help with hiring?");
  await hr("I'm Morgan, hiring for my startup");
  assert.match(lastToHR(), /company/i);
  await hr("Fieldstone Labs");
  assert.match(lastToHR(), /JD/);
  await hr("Founding ML Engineer. Applied AI startup building evals for agents. Python, LLMs, evals, infra. $190-230k + 1% equity, remote.");
  assert.match(lastToHR(), /90 days/);
  await hr("Our eval harness runs on every model release and catches regressions before customers do.");
  await hr("Our last hire was a brilliant researcher who never shipped to production. We need someone who ships.");
  await hr("Pitch: you own evals end to end. Catch: it's early, things break, some on-call.");
  await hr("190-230k, 1% equity, remote");
  assert.match(lastToHR(), /Anything you'd change\?/);
  const f = store.byHandle(HR)!;
  assert.equal(f.role, "founder");
  assert.equal(f.founder!.roleTitle, "Founding ML Engineer");
  assert.deepEqual(f.founder!.bandK, [190, 230]);
  assert.ok(f.founder!.mustHaves.includes("evals"));

  await hr("looks good");
  await waitFor(() => /interested\?/.test(lastToHR()), "candidate pitch to the hiring manager");
  const intro = store.intros.find((i) => i.founderId === f.id)!;
  assert.equal(intro.initiatedBy, "founder");
  await hr("yes please");
  // The candidate is a persona: it answers on its own, then Wren makes the (demo) intro.
  await waitFor(() => /it's official/.test(net.sent.filter((s) => s.to === HR).map((s) => s.text).join("\n")), "intro card sent to the hiring manager");
  assert.equal(intro.status === "connected" || intro.status === "followed_up", true);
});

test("employer-first pitches keep the candidate anonymous until they opt in", () => {
  const intro = store.intros.find((i) => i.initiatedBy === "founder")!;
  const c = store.person(intro.candidateId)!;
  const f = store.person(intro.founderId)!;
  const toHR = net.sent.filter((s) => s.to === f.handle);
  const yes = toHR.findIndex((s) => /said yes/.test(s.text));
  const before = (yes < 0 ? toHR : toHR.slice(0, yes)).map((s) => s.text).join("\n");
  assert.ok(!before.includes(c.first), `candidate name leaked before their yes:\n${before}`);
});

test("iPhone smart punctuation is understood (I’m, don’t)", async () => {
  const P = "+13415550133";
  const t = (text: string) => agent.handle({ chatId: `real:${P}`, isGroup: false, from: P, text, messageId: crypto.randomUUID() });
  await t("hey");
  await t("I’m Yushan");
  assert.equal(store.byHandle(P)!.first, "Yushan");
});

test("first contact replays the live transcript: greetings aren't names, late corrections work", async () => {
  const P = "+13415550144";
  const t = (text: string) => agent.handle({ chatId: `real:${P}`, isGroup: false, from: P, text, messageId: crypto.randomUUID() });
  const last = () => net.sent.filter((s) => s.to === P).at(-1)?.text ?? "";
  await t("Yo");
  await t("Yo");
  assert.match(last(), /call you|your name/i, "a greeting is not a name");
  await t("I’m Yushan");
  assert.match(last(), /Yushan.*hiring/);
  await t("My name is Yushan");
  assert.equal(store.byHandle(P)!.first, "Yushan");
  await t("I’m open to sth new!");
  assert.match(last(), /Who (sent|pointed)/);
  await t("I’m open to sth new!");
  assert.match(last(), /Just their name/, "a sentence is not a voucher");
  await t("Aiden Bai");
  assert.equal(store.byHandle(P)!.vouch!.name, "Aiden Bai");
  assert.match(last(), /resume/i);
});
