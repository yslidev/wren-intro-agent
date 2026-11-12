import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import type { Chat, ChatMessage, Intro, LogEntry, Person } from "./types.js";

interface State {
  people: Person[];
  intros: Intro[];
  chats: Chat[];
  log: LogEntry[];
  seenEvents: string[];
}

const SEED_PATH = "data/seed.json";
const WORLD_PATH = "data/world.json";
export interface Seed { people: Partial<Person>[] }

/** The hand-written demo cast, plus (when world is on) the generated synthetic world. */
function loadSeedPeople(seed?: Seed, world = false): Person[] {
  const raw = seed ?? (JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed);
  const extra = world && existsSync(WORLD_PATH) ? (JSON.parse(readFileSync(WORLD_PATH, "utf8")) as Seed).people : [];
  // Everyone in seed/world data is made up, whatever the file says.
  return structuredClone([...raw.people, ...extra]).map((p) => ({ asked: 0, notes: [], ...p, fictional: true }) as Person);
}

function seedState(seed?: Seed, world = false): State {
  return { people: loadSeedPeople(seed, world), intros: [], chats: [], log: [], seenEvents: [] };
}

/**
 * A tiny JSON-file store. Good enough for a demo and a single instance;
 * swap for Postgres/SQLite before running more than one replica.
 */
export class Store extends EventEmitter {
  private s: State;
  private file: string;
  private persist: boolean;
  private seed?: Seed;
  private world: boolean;

  constructor(opts: { persist?: boolean; seed?: Seed; world?: boolean } = {}) {
    super();
    this.persist = opts.persist ?? true;
    this.seed = opts.seed;
    this.world = opts.world ?? false;
    this.file = join(config.dataDir, "state.json");
    if (this.persist && existsSync(this.file)) {
      this.s = JSON.parse(readFileSync(this.file, "utf8"));
      // Pick up seed/world people added since this state file was written, without touching existing ones.
      const have = new Set(this.s.people.map((p) => p.id));
      for (const p of loadSeedPeople(this.seed, this.world)) if (!have.has(p.id)) this.s.people.push(p);
    } else {
      this.s = seedState(this.seed, this.world);
    }
  }

  reset() {
    this.s = seedState(this.seed, this.world);
    this.save();
    this.emit("change", { type: "reset" });
  }

  save() {
    if (!this.persist) return;
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.s, null, 2));
  }

  // ---- people
  get people() { return this.s.people; }
  person(id: string) { return this.s.people.find((p) => p.id === id); }
  byHandle(handle: string) { return this.s.people.find((p) => p.handle === normalize(handle)); }
  addPerson(p: Person) { this.s.people.push(p); this.save(); return p; }

  // ---- intros
  get intros() { return this.s.intros; }
  intro(id: string) { return this.s.intros.find((i) => i.id === id); }
  addIntro(i: Intro) { this.s.intros.push(i); this.save(); return i; }
  openIntroFor(personId: string, statuses: Intro["status"][]) {
    return [...this.s.intros].reverse().find((i) => (i.candidateId === personId || i.founderId === personId) && statuses.includes(i.status));
  }

  // ---- chats
  get chats() { return this.s.chats; }
  chat(id: string) { return this.s.chats.find((c) => c.id === id); }
  ensureChat(id: string, init: Omit<Chat, "id" | "messages">): Chat {
    let c = this.chat(id);
    if (!c) {
      c = { id, messages: [], ...init };
      this.s.chats.push(c);
    }
    return c;
  }
  dmChatFor(handle: string) { return this.s.chats.find((c) => !c.isGroup && c.handles.includes(normalize(handle))); }
  pushMessage(chatId: string, m: ChatMessage) {
    const c = this.chat(chatId);
    if (!c) return;
    c.messages.push(m);
    this.save();
    this.emit("change", { type: "message", chatId, message: m });
  }

  // ---- dedupe + log
  seen(eventId: string) {
    if (this.s.seenEvents.includes(eventId)) return true;
    this.s.seenEvents.push(eventId);
    if (this.s.seenEvents.length > 2000) this.s.seenEvents.splice(0, 1000);
    return false;
  }
  get log() { return this.s.log; }
  addLog(kind: LogEntry["kind"], text: string) {
    const e = { at: new Date().toISOString(), kind, text };
    this.s.log.push(e);
    if (this.s.log.length > 500) this.s.log.splice(0, 100);
    this.save();
    this.emit("change", { type: "log", entry: e });
    if (process.env.NODE_ENV !== "test") console.log(`[${kind}] ${text}`);
  }
}

/** What the simulator UI needs about a person (no private notes). */
export const publicPerson = (p: Person) => ({
  id: p.id, name: p.name, first: p.first, role: p.role, stage: p.stage, handle: p.handle, vouch: p.vouch, blurb: p.blurb,
  fictional: p.fictional, simulated: p.simulated, persona: p.persona,
  company: p.founder?.company, roleTitle: p.founder?.roleTitle, slots: p.founder?.slots, title: p.candidate?.title,
});

export const normalize = (h: string) => {
  const t = h.trim();
  if (t.includes("@")) return t.toLowerCase();
  const digits = t.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
};
