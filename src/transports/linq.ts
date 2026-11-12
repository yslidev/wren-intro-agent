import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundEvent } from "../types.js";
import type { Transport } from "./types.js";

/**
 * Linq Partner API v3. Docs: https://docs.linqapp.com/channel/imessage/
 *  - POST /v3/chats                    create a chat (1:1 or group) with a required first message
 *  - POST /v3/chats/{id}/messages      send into a known chat
 *  - PUT  /v3/chats/{id}               display_name / group_chat_icon (groups only)
 *  - POST /v3/messages/{id}/reactions  tapbacks
 * Webhooks: subscribe your /webhooks/linq URL with ?version=2026-02-03 to get the flat MessageEventV2 shape.
 */
export class LinqTransport implements Transport {
  readonly name = "linq";
  constructor(
    private opts: { token: string; from: string; baseUrl: string; groupIcon?: string },
  ) {
    if (!opts.token || !opts.from) throw new Error("TRANSPORT=linq needs LINQ_API_TOKEN and LINQ_FROM_NUMBER");
  }
  get agentHandle() { return this.opts.from; }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Linq ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private parts(text: string) { return { parts: [{ type: "text", value: text }] }; }

  async sendDM(to: string, text: string) {
    // Chats are keyed on from + exact `to` set, so this reuses the existing 1:1 thread.
    const r = await this.call<{ chat: { id: string; message?: { id?: string } } }>("POST", "/v3/chats", {
      from: this.opts.from, to: [to], message: this.parts(text),
    });
    return { chatId: r.chat.id, messageId: r.chat.message?.id };
  }

  async sendToChat(chatId: string, text: string) {
    const r = await this.call<{ id?: string; message?: { id?: string } }>("POST", `/v3/chats/${chatId}/messages`, { message: this.parts(text) });
    return { messageId: r.message?.id ?? r.id };
  }

  async createGroup(handles: string[], opener: string, displayName?: string) {
    if (/https?:\/\//i.test(opener)) throw new Error("Linq rejects links in a new chat's first message (error 1005)");
    const r = await this.call<{ chat: { id: string; message?: { id?: string } } }>("POST", "/v3/chats", {
      from: this.opts.from, to: handles, message: this.parts(opener),
    });
    // Naming the group also stops future POST /v3/chats with the same people from reusing this thread.
    if (displayName || this.opts.groupIcon) {
      await this.call("PUT", `/v3/chats/${r.chat.id}`, {
        ...(displayName ? { display_name: displayName } : {}),
        ...(this.opts.groupIcon ? { group_chat_icon: this.opts.groupIcon } : {}),
      }).catch(() => undefined); // async on Linq's side; failure here shouldn't kill the intro
    }
    return { chatId: r.chat.id, messageId: r.chat.message?.id };
  }

  async react(_chatId: string, messageId: string, reaction: "love" | "like" | "laugh" | "emphasize") {
    await this.call("POST", `/v3/messages/${messageId}/reactions`, { operation: "add", type: reaction });
  }

  async start() {}
}

/** Standard Webhooks verification, as Linq documents it: HMAC-SHA256 over "{id}.{timestamp}.{rawBody}". */
export function verifyLinqSignature(secret: string, rawBody: string, headers: Record<string, string | undefined>, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sig = headers["webhook-signature"];
  if (!id || !ts || !sig) return false;
  if (Math.abs(nowSec - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return sig.split(" ").some((s) => {
    if (!s.startsWith("v1,")) return false;
    const got = Buffer.from(s.slice(3), "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

interface LinqEnvelope {
  event_type: string;
  event_id: string;
  data: {
    id?: string;
    direction?: "inbound" | "outbound";
    chat?: { id: string; is_group?: boolean | null };
    sender_handle?: { handle: string; is_me?: boolean };
    parts?: { type: string; value?: string }[];
  };
}

/** Turn a Linq message.received webhook (version 2026-02-03) into Wren's InboundEvent. Returns null for anything else. */
export function parseLinqWebhook(body: unknown): { eventId: string; event: InboundEvent } | null {
  const env = body as LinqEnvelope;
  if (env?.event_type !== "message.received") return null;
  const d = env.data;
  if (!d?.chat?.id || !d.sender_handle?.handle || d.direction === "outbound" || d.sender_handle.is_me) return null;
  const text = (d.parts ?? []).filter((p) => p.type === "text" && p.value).map((p) => p.value).join("\n").trim();
  if (!text) return null;
  return {
    eventId: env.event_id,
    event: { chatId: d.chat.id, isGroup: Boolean(d.chat.is_group), from: d.sender_handle.handle, text, messageId: d.id },
  };
}
