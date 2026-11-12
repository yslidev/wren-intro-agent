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
export interface Seed { people: Partial<Person>[] }

function seedState(seed?: Seed): State {
  const raw = seed ?? (JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed);
  const people = structuredClone(raw.people).map((p) => ({ asked: 0, notes: [], ...p }) as Person);
  return { people, intros: [], chats: [], log: [], seenEvents: [] };
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

  constructor(opts: { persist?: boolean; seed?: Seed } = {}) {
    super();
    this.persist = opts.persist ?? true;
    this.seed = opts.seed;
    this.file = join(config.dataDir, "state.json");
    this.s = this.persist && existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : seedState(this.seed);
  }

  reset() {
    this.s = seedState(this.seed);
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

export const normalize = (h: string) => {
  const t = h.trim();
  if (t.includes("@")) return t.toLowerCase();
  const digits = t.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
};
