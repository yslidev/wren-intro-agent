import type { InboundEvent } from "../types.js";
import { TransportUnsupported, type Transport } from "./types.js";

/**
 * Photon iMessage Kit (https://github.com/photon-hq/imessage-kit), running on a Mac signed in to iMessage.
 * Free and self-hosted: it reads ~/Library/Messages/chat.db (needs Full Disk Access) and sends via AppleScript.
 * It can text people and post into existing group chats, but cannot create a new group, so Wren
 * falls back to a "relay intro" (both people get the intro and each other's number) on this transport.
 *
 * Install on the Mac:  npm i @photon-ai/imessage-kit better-sqlite3   (or `bun add @photon-ai/imessage-kit`)
 */
type Sdk = {
  send(o: { to: string; text: string }): Promise<void>;
  startWatching(h: Record<string, (m: PhotonMessage) => void | Promise<void>>): Promise<void>;
};
type PhotonMessage = { chatId: string | null; chatKind: "dm" | "group" | "unknown"; participant: string | null; isFromMe: boolean; text: string | null; id?: string | number };

export class PhotonTransport implements Transport {
  readonly name = "photon";
  private sdk!: Sdk;
  constructor(readonly agentHandle: string) {}

  private async load() {
    if (this.sdk) return this.sdk;
    const mod = "@photon-ai/imessage-kit"; // kept dynamic so non-Mac installs don't need it
    const { IMessageSDK } = (await import(mod)) as { IMessageSDK: new () => Sdk };
    this.sdk = new IMessageSDK();
    return this.sdk;
  }

  async sendDM(to: string, text: string) {
    await (await this.load()).send({ to, text });
    return { chatId: `dm:${to}` };
  }
  async sendToChat(chatId: string, text: string) {
    await (await this.load()).send({ to: chatId.startsWith("dm:") ? chatId.slice(3) : chatId, text });
    return {};
  }
  async createGroup(): Promise<{ chatId: string }> {
    throw new TransportUnsupported("Photon's local kit can't create group chats");
  }
  async react() {}

  async start(onInbound: (e: InboundEvent) => Promise<void>) {
    const sdk = await this.load();
    await sdk.startWatching({
      onIncomingMessage: async (m) => {
        if (m.isFromMe || !m.text || !m.participant) return;
        const isGroup = m.chatKind === "group";
        const chatId = isGroup ? m.chatId : `dm:${m.participant}`;
        if (!chatId) return;
        await onInbound({ chatId, isGroup, from: m.participant, text: m.text, messageId: m.id ? String(m.id) : undefined });
      },
      onError: () => {},
    });
  }
}
