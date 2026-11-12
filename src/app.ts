import { readFileSync } from "node:fs";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { Agent } from "./brain/agent.js";
import { Brain } from "./brain/llm.js";
import { config } from "./config.js";
import { normalize, Store } from "./store.js";
import type { FounderProfile, Person } from "./types.js";

const NewPerson = z.object({
  id: z.string().optional(),
  role: z.enum(["candidate", "founder"]),
  name: z.string().min(1),
  handle: z.string().min(7).describe("E.164 phone number or iMessage email"),
  vouch: z.object({ name: z.string(), relation: z.string(), quote: z.string() }).optional(),
  candidate: z.object({
    title: z.string(), years: z.number(), skills: z.array(z.string()),
    floorK: z.number().optional(), setups: z.array(z.string()).optional(), stages: z.array(z.string()).optional(),
  }).partial().optional(),
  founder: z.object({
    company: z.string(), stage: z.string(), sector: z.string(), roleTitle: z.string(),
    bandK: z.tuple([z.number(), z.number()]), equity: z.string(), setup: z.string(),
    mustHaves: z.array(z.string()), problem: z.string(), slots: z.array(z.string()),
  }).optional(),
}).refine((p) => p.role !== "founder" || p.founder, { message: "founders need a founder profile", path: ["founder"] });
import { LinqTransport, parseLinqWebhook, verifyLinqSignature } from "./transports/linq.js";
import { PhotonTransport } from "./transports/photon.js";
import { SimTransport } from "./transports/sim.js";
import { SpectrumTransport } from "./transports/spectrum.js";
import type { Transport } from "./transports/types.js";

export interface Built { app: Hono; agent: Agent; store: Store; transport: Transport; brain: Brain }

export function makeTransport(): Transport {
  if (config.transport === "linq") {
    if (config.linq.token && config.linq.from) return new LinqTransport(config.linq);
    console.warn("TRANSPORT=linq but LINQ_API_TOKEN / LINQ_FROM_NUMBER are missing. Running the simulator until they're set.");
  }
  if (config.transport === "photon") return new PhotonTransport(process.env.PHOTON_HANDLE ?? "me");
  if (config.transport === "spectrum") {
    return new SpectrumTransport({ ...config.spectrum, log: (m) => console.log(`[spectrum] ${m}`) });
  }
  return new SimTransport(config.simAgentHandle);
}

export function buildApp(opts: { transport?: Transport; persist?: boolean; llm?: boolean } = {}): Built {
  const store = new Store({ persist: opts.persist ?? true });
  const transport = opts.transport ?? makeTransport();
  const brain = new Brain(opts.llm ?? config.llmEnabled, config.model, (m) => store.addLog("llm", m));
  const agent = new Agent(store, transport, brain, { matchDelayMs: config.matchDelayMs, followupDelayMs: config.followupDelayMs });
  const app = new Hono();
  const isSim = transport.name === "sim";

  // With real phone numbers in play, every admin and read endpoint needs ADMIN_TOKEN; there is no open mode.
  const admin = (c: Context) =>
    config.adminToken ? c.req.header("x-admin-token") === config.adminToken : isSim;

  app.get("/", (c) => c.redirect("/sim"));
  app.get("/healthz", (c) => c.json({ ok: true, transport: transport.name, llm: brain.enabled ? config.model : "rules" }));

  app.get("/sim", (c) => c.html(readFileSync("public/sim.html", "utf8")));

  app.get("/api/state", (c) => {
    if (!isSim && !admin(c)) return c.json({ error: "admin token required" }, 401);
    return c.json({
      transport: transport.name,
      llm: brain.enabled ? config.model : null,
      agentHandle: transport.agentHandle,
      people: store.people.map(({ id, name, first, role, stage, handle, vouch, blurb }) => ({ id, name, first, role, stage, handle, vouch, blurb })),
      intros: store.intros,
      chats: isSim ? store.chats : [],
      log: store.log.slice(-200),
    });
  });

  // Add or update a real person (e.g. yourself and a founder friend who agreed to test).
  app.post("/api/people", async (c) => {
    if (!admin(c)) return c.json({ error: "admin token required" }, 401);
    const parsed = NewPerson.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    const b = parsed.data;
    const handle = normalize(b.handle);
    const existing = store.people.find((p) => p.id === b.id || p.handle === handle);
    const person: Person = {
      ...(existing ?? { asked: 0, notes: [] }),
      id: b.id ?? existing?.id ?? `${b.role === "founder" ? "f" : "c"}_${crypto.randomUUID().slice(0, 8)}`,
      handle, name: b.name, first: b.name.split(" ")[0], role: b.role,
      stage: b.role === "founder" ? "ready" : existing?.stage ?? "new",
      vouch: b.vouch ?? existing?.vouch,
      candidate: b.role === "candidate" ? { title: "", years: 0, skills: [], ...existing?.candidate, ...b.candidate } : undefined,
      founder: b.role === "founder" ? (b.founder as FounderProfile) : undefined,
    } as Person;
    if (existing) Object.assign(existing, person);
    else store.addPerson(person);
    store.save();
    store.emit("change", { type: "person" });
    return c.json({ ok: true, id: person.id });
  });

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      let n = 0;
      const on = () => { n += 1; };
      store.on("change", on);
      try {
        let last = 0;
        while (!stream.aborted) {
          if (n !== last) { last = n; await stream.writeSSE({ event: "change", data: String(n) }); }
          await stream.sleep(250);
        }
      } finally {
        store.off("change", on);
      }
    }),
  );

  // Simulated inbound text from one of the demo phones.
  app.post("/api/sim/send", async (c) => {
    if (!isSim) return c.json({ error: "only available with TRANSPORT=sim" }, 400);
    const { from, chatId, text } = await c.req.json<{ from: string; chatId?: string; text: string }>();
    if (!from || !text?.trim()) return c.json({ error: "from and text are required" }, 400);
    const id = chatId || `dm:${from}`;
    const isGroup = id.startsWith("grp:");
    const participants = isGroup ? store.chat(id)?.handles : undefined;
    void agent.handle({ chatId: id, isGroup, from, text: text.trim(), participants, messageId: crypto.randomUUID() });
    return c.json({ ok: true, chatId: id });
  });

  app.post("/api/kickoff/:id", async (c) => {
    if (!admin(c)) return c.json({ error: "admin token required" }, 401);
    void agent.kickoff(c.req.param("id")).catch((e) => store.addLog("error", String(e)));
    return c.json({ ok: true });
  });

  app.post("/api/match/:id", async (c) => {
    if (!admin(c)) return c.json({ error: "admin token required" }, 401);
    const p = store.person(c.req.param("id"));
    if (!p || p.role !== "candidate") return c.json({ error: "unknown candidate" }, 404);
    void agent.proposeNext(p).catch((e) => store.addLog("error", String(e)));
    return c.json({ ok: true });
  });

  app.post("/api/reset", (c) => {
    if (!admin(c)) return c.json({ error: "admin token required" }, 401);
    agent.stop();
    store.reset();
    return c.json({ ok: true });
  });

  // Linq inbound webhook. Subscribe it with ?version=2026-02-03 for the flat message payload.
  app.post("/webhooks/linq", async (c) => {
    const raw = await c.req.text();
    if (config.linq.webhookSecret) {
      const h = (k: string) => c.req.header(k);
      const ok = verifyLinqSignature(config.linq.webhookSecret, raw, {
        "webhook-id": h("webhook-id"), "webhook-timestamp": h("webhook-timestamp"), "webhook-signature": h("webhook-signature"),
      });
      if (!ok) return c.json({ error: "bad signature" }, 401);
    }
    const parsed = parseLinqWebhook(JSON.parse(raw));
    if (!parsed || store.seen(parsed.eventId)) return c.json({ ok: true, ignored: true });
    void agent.handle(parsed.event); // ack fast; Linq retries slow endpoints
    return c.json({ ok: true });
  });

  return { app, agent, store, transport, brain };
}
