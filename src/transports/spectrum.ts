import { Spectrum, UnsupportedError, type Message, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import type { InboundEvent } from "../types.js";
import { TransportUnsupported, type Transport } from "./types.js";

/**
 * Photon Spectrum (cloud iMessage). Docs: https://photon.codes/docs/spectrum-ts/introduction
 *
 * Free/Pro projects text from a shared, assigned number and only registered users can reach it.
 * Creating group chats needs a Business dedicated line; elsewhere Spectrum raises UnsupportedError
 * and Wren falls back to a relay intro (each side gets the intro and the other's number by DM).
 */
export class SpectrumTransport implements Transport {
  readonly name = "spectrum";
  private app?: Awaited<ReturnType<typeof Spectrum>>;
  private ready?: Promise<void>;
  private spaces = new Map<string, Space>();
  private messages = new Map<string, Message>();

  constructor(
    private opts: { projectId: string; projectSecret: string; agentNumber?: string; log?: (msg: string) => void },
  ) {
    if (!opts.projectId || !opts.projectSecret) throw new Error("TRANSPORT=spectrum needs PROJECT_ID and PROJECT_SECRET (run: photon projects secret <id>)");
  }

  /** The number people text. On Free/Pro this is the user record's assignedPhoneNumber. */
  get agentHandle() { return this.opts.agentNumber || "spectrum-agent"; }

  private init() {
    this.ready ??= (async () => {
      this.app = await Spectrum({
        projectId: this.opts.projectId,
        projectSecret: this.opts.projectSecret,
        providers: [imessage.config()],
      });
      this.opts.log?.("Spectrum connected (iMessage provider registered)");
    })();
    return this.ready;
  }

  private get im() { return imessage(this.app!); }

  private async space(chatId: string): Promise<Space> {
    const cached = this.spaces.get(chatId);
    if (cached) return cached;
    await this.init();
    const s = await this.im.space.get(chatId);
    this.spaces.set(s.id, s);
    return s;
  }

  async sendDM(to: string, text: string) {
    await this.init();
    const s = await this.im.space.create(to);
    this.spaces.set(s.id, s);
    const m = await s.send(text);
    if (m) this.messages.set(m.id, m);
    return { chatId: s.id, messageId: m?.id };
  }

  async sendToChat(chatId: string, text: string) {
    const s = await this.space(chatId);
    const m = await s.send(text);
    if (m) this.messages.set(m.id, m);
    return { messageId: m?.id };
  }

  async createGroup(handles: string[], opener: string, displayName?: string) {
    await this.init();
    let s: Space;
    try {
      s = await this.im.space.create(handles);
    } catch (err) {
      if (err instanceof UnsupportedError) throw new TransportUnsupported(`Spectrum can't create groups on this project: ${err.message}`);
      throw err;
    }
    this.spaces.set(s.id, s);
    const m = await s.send(opener);
    if (displayName) await s.rename(displayName).catch(() => undefined);
    return { chatId: s.id, messageId: m?.id };
  }

  async react(_chatId: string, messageId: string, reaction: "love" | "like" | "laugh" | "emphasize") {
    await this.messages.get(messageId)?.react(reaction);
  }

  /** Connects, then consumes inbound messages in the background so the HTTP server can start. */
  async start(onInbound: (e: InboundEvent) => Promise<void>) {
    await this.init();
    void (async () => {
      for await (const [space, message] of this.app!.messages) {
        try {
          if (message.direction !== "inbound") continue;
          const text = message.content.type === "text" ? message.content.text.trim() : "";
          const from = message.sender?.id;
          if (!text || !from) continue; // attachments, reactions, etc. are ignored for now
          this.spaces.set(space.id, space);
          this.messages.set(message.id, message);
          const isGroup = imessage(space).type === "group";
          await onInbound({ chatId: space.id, isGroup, from, text, messageId: message.id });
        } catch (err) {
          this.opts.log?.(`Spectrum inbound handler error: ${(err as Error).message}`);
        }
      }
      this.opts.log?.("Spectrum message stream ended");
    })().catch((err) => this.opts.log?.(`Spectrum stream failed: ${(err as Error).message}`));
  }
}
