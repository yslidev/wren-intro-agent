import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.MATCH_DELAY_MS = "5";
process.env.FOLLOWUP_DELAY_MS = "5";
process.env.TRANSPORT = "sim";

const { buildApp } = await import("../src/app.js");
const { rankFounders } = await import("../src/brain/match.js");
const { agreedSlot, intent } = await import("../src/brain/text.js");
const { parseLinqWebhook, verifyLinqSignature } = await import("../src/transports/linq.js");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ALEX = "+15550100101", SAM = "+15550100201";

const built = buildApp({ persist: false, llm: false });
const { agent, store } = built;
after(() => agent.stop());

const send = async (from: string, text: string, chatId = `dm:${from}`) => {
  await agent.handle({ chatId, isGroup: chatId.startsWith("grp:"), from, text, messageId: crypto.randomUUID(), participants: store.chat(chatId)?.handles });
};
const lastFromWren = (chatId: string) => store.chat(chatId)?.messages.filter((m) => m.from === built.transport.agentHandle).at(-1)?.text ?? "";
const waitFor = async (cond: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) { if (cond()) return; await sleep(5); }
  assert.fail(`timed out waiting for: ${label}`);
};

test("text helpers read yes/no and agreed times", () => {
  assert.equal(intent("Yes, intro me"), "yes");
  assert.equal(intent("nah not for me"), "no");
  assert.equal(intent("who is she?"), "more");
  assert.equal(agreedSlot("Thursday 10 works. Looking forward to it.", ["Thu 10:00 AM PT", "Thu 2:00 PM PT"]), "Thu 10:00 AM PT");
  assert.equal(agreedSlot("Thursday at 10 or 2 PT?", ["Thu 10:00 AM PT"]), undefined);
});

test("full double opt-in intro ends in a group chat, a booked time and follow-ups", async () => {
  await agent.kickoff("c_alex");
  assert.match(lastFromWren(`dm:${ALEX}`), /proudest/);

  await send(ALEX, "Rebuilt dispute handling for 2,000 merchants at Corvid. Cut resolution time from 9 days to 2.");
  assert.match(lastFromWren(`dm:${ALEX}`), /leave/);
  await send(ALEX, "Smaller team, more ownership. I want to own a whole problem, not a slice.");
  await send(ALEX, "$180k base, remote or hybrid in SF");
  const alex = store.person("c_alex")!;
  assert.equal(alex.candidate!.floorK, 180);
  assert.deepEqual(alex.candidate!.setups, ["remote", "hybrid"]);
  assert.equal(alex.stage, "blurb_review");
  assert.match(alex.blurb!, /Maya Chen/);

  await send(ALEX, "Looks right, send it when it makes sense");
  await waitFor(() => /Want an intro\?/.test(lastFromWren(`dm:${ALEX}`)), "match proposal");
  const intro = store.intros[0];
  assert.equal(intro.founderId, "f_sam", "Alex should be matched with Sam first");
  assert.equal(store.dmChatFor(SAM), undefined, "Sam must not hear about Alex before Alex says yes");

  await send(ALEX, "Yes, intro me");
  assert.equal(intro.status, "asked_founder");
  assert.match(lastFromWren(`dm:${SAM}`), /Want the intro\?/);

  await send(SAM, "Yes please, the dispute work is exactly our kind of problem");
  assert.equal(intro.status, "connected");
  const group = store.chat(intro.chatId!)!;
  assert.ok(group.isGroup);
  assert.deepEqual(group.handles.sort(), [ALEX, SAM].sort());
  assert.match(group.messages[0].text, /^Sam, meet Alex/);

  // Humans talking to each other: Wren stays quiet.
  const before = group.messages.length;
  await send(SAM, "Alex, great to meet you! Thursday at 10 or 2 PT?", group.id);
  assert.equal(group.messages.length, before + 1, "gate should ignore human-to-human messages");

  await send(ALEX, "Thursday 10 works. Looking forward to it.", group.id);
  assert.equal(intro.status, "scheduled");
  assert.equal(intro.slot, "Thu 10:00 AM PT");
  assert.match(lastFromWren(group.id), /Stepping out/);

  await send(SAM, "@wren thanks!", group.id);
  assert.equal(group.messages.at(-1)!.reaction, "love", "a thanks gets a tapback, not a text");

  await waitFor(() => intro.status === "followed_up", "follow-up");
  assert.match(lastFromWren(`dm:${ALEX}`), /How did it go with Sam/);
  await send(ALEX, "Really good. Next step is a working session.");
  await send(SAM, "Great call, moving Alex forward.");
  assert.deepEqual(intro.awaiting, []);
  assert.equal(Object.keys(intro.feedback).length, 2);
});

test("a founder pass is softened for the candidate and Wren keeps looking", async () => {
  const priya = store.person("c_priya")!;
  await agent.proposeNext(priya);
  const intro = store.intros.at(-1)!;
  assert.equal(intro.founderId, "f_ravi");
  await send(priya.handle, "yes!");
  await send("+15550100203", "not right now, sorry");
  assert.equal(intro.status, "declined_founder");
  assert.match(lastFromWren(`dm:${priya.handle}`), /pass this time/);
});

test("STOP silences Wren until the person writes again", async () => {
  const nina = store.person("c_nina")!;
  await send(nina.handle, "STOP");
  assert.equal(nina.optedOut, true);
  const before = store.dmChatFor(nina.handle)?.messages.length ?? 0;
  await agent.proposeNext(nina);
  assert.equal(store.dmChatFor(nina.handle)?.messages.length ?? 0, before, "no texts after STOP");
  await send(nina.handle, "hey, any updates?");
  assert.equal(nina.optedOut, false);
});

test("POST /api/people adds a real person who can then be matched", async () => {
  const res = await built.app.request("/api/people", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      role: "founder", name: "Test Founder", handle: "(555) 010-0299",
      founder: { company: "Testco", stage: "seed", sector: "fintech", roleTitle: "First PM", bandK: [170, 190], equity: "1%", setup: "remote",
        mustHaves: ["payments"], problem: "no PM yet", slots: ["Fri 9:00 AM PT"] },
    }),
  });
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: string };
  assert.equal(store.person(id)?.handle, "+15550100299");
  const bad = await built.app.request("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "founder", name: "x", handle: "+15550100298" }) });
  assert.equal(bad.status, 400, "founders need a founder profile");
});

test("matching respects pay floors and setup", () => {
  const c = { ...store.person("c_jordan")!, candidate: { ...store.person("c_jordan")!.candidate!, floorK: 190 } };
  const ranked = rankFounders(c, store.people, []);
  assert.ok(ranked.every((r) => r.founder.founder!.bandK[1] >= 190));
});

test("Linq webhook signature and payload parsing", () => {
  const secret = "whsec_" + Buffer.from("test-secret-key-bytes").toString("base64");
  const body = JSON.stringify({
    event_type: "message.received", event_id: "evt_1",
    data: { id: "m1", direction: "inbound", chat: { id: "chat_1", is_group: true }, sender_handle: { handle: SAM }, parts: [{ type: "text", value: "hi all" }] },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from("test-secret-key-bytes")).update(`msg_1.${ts}.${body}`).digest("base64");
  assert.ok(verifyLinqSignature(secret, body, { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` }));
  assert.ok(!verifyLinqSignature(secret, body + " ", { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` }));
  const parsed = parseLinqWebhook(JSON.parse(body));
  assert.deepEqual(parsed?.event, { chatId: "chat_1", isGroup: true, from: SAM, text: "hi all", messageId: "m1" });
  assert.equal(parseLinqWebhook({ event_type: "message.delivered", event_id: "x", data: {} }), null);
});
