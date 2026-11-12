import type { InboundEvent } from "../types.js";

export class TransportUnsupported extends Error {}

/**
 * Everything Wren needs from an iMessage provider. Three implementations:
 *  - SimTransport    in-memory phones for the web simulator and tests
 *  - LinqTransport   Linq Partner API v3 (cloud lines, webhooks, real group chats)
 *  - PhotonTransport Photon iMessage Kit on your own Mac (DMs + existing groups)
 */
export interface Transport {
  readonly name: string;
  readonly agentHandle: string;
  /** Send a 1:1 text. Returns the provider's chat id for that DM. */
  sendDM(to: string, text: string): Promise<{ chatId: string; messageId?: string }>;
  sendToChat(chatId: string, text: string): Promise<{ messageId?: string }>;
  /** Start a new group thread. The opener must not contain a link (Linq rejects it). */
  createGroup(handles: string[], opener: string, displayName?: string): Promise<{ chatId: string; messageId?: string }>;
  react(chatId: string, messageId: string, reaction: "love" | "like" | "laugh" | "emphasize"): Promise<void>;
  /** Transports that pull messages (Photon) start their own listener; webhook ones return immediately. */
  start(onInbound: (e: InboundEvent) => Promise<void>): Promise<void>;
}
