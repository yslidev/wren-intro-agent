import { randomUUID } from "node:crypto";
import type { InboundEvent } from "../types.js";
import type { Transport } from "./types.js";

/** In-memory iMessage. The Agent records every message in the Store, which is what the simulator renders. */
export class SimTransport implements Transport {
  readonly name = "sim";
  private groups = 0;
  constructor(readonly agentHandle: string) {}

  async sendDM(to: string) { return { chatId: `dm:${to}`, messageId: randomUUID() }; }
  async sendToChat() { return { messageId: randomUUID() }; }
  async createGroup() { this.groups += 1; return { chatId: `grp:${Date.now().toString(36)}${this.groups}`, messageId: randomUUID() }; }
  async react() {}
  async start(_on: (e: InboundEvent) => Promise<void>) {}
}
