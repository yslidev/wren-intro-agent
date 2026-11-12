/**
 * The whole agent running in the browser, for the static GitHub Pages demo.
 * Same Agent, Brain (rules mode), matching and SimTransport as the server; only the HTTP layer is replaced.
 */
import seed from "../../data/seed.json" with { type: "json" };
import { Agent } from "../brain/agent.js";
import { Brain } from "../brain/llm.js";
import { config } from "../config.js";
import { Store, type Seed } from "../store.js";
import { SimTransport } from "../transports/sim.js";

const store = new Store({ persist: false, seed: seed as unknown as Seed });
const transport = new SimTransport(config.simAgentHandle);
const brain = new Brain(false, config.model);
const agent = new Agent(store, transport, brain, { matchDelayMs: 2500, followupDelayMs: 6000 });

const ok = { ok: true };

(globalThis as unknown as { WREN_API: unknown }).WREN_API = {
  mode: "browser",
  async state() {
    return {
      transport: "sim, running in your browser",
      llm: null,
      agentHandle: transport.agentHandle,
      people: store.people.map(({ id, name, first, role, stage, handle, vouch, blurb }) => ({ id, name, first, role, stage, handle, vouch, blurb })),
      intros: store.intros,
      chats: store.chats,
      log: store.log.slice(-200),
    };
  },
  async post(url: string, body: { from?: string; chatId?: string; text?: string } = {}) {
    let m: RegExpMatchArray | null;
    if ((m = url.match(/^\/api\/kickoff\/(.+)$/))) { void agent.kickoff(m[1]); return ok; }
    if ((m = url.match(/^\/api\/match\/(.+)$/))) { const p = store.person(m[1]); if (p) void agent.proposeNext(p); return ok; }
    if (url === "/api/reset") { agent.stop(); store.reset(); return ok; }
    if (url === "/api/sim/send" && body.from && body.text) {
      const chatId = body.chatId || `dm:${body.from}`;
      const isGroup = chatId.startsWith("grp:");
      void agent.handle({ chatId, isGroup, from: body.from, text: body.text, participants: isGroup ? store.chat(chatId)?.handles : undefined, messageId: crypto.randomUUID() });
      return ok;
    }
    return { error: "unknown route" };
  },
  subscribe(cb: () => void) { store.on("change", cb); },
};
