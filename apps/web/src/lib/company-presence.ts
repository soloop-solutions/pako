// One company open at a time, across every tab and window of this browser.
//
// Tabs talk over a BroadcastChannel. Before a tab opens a company it asks the others which company
// they have open ("ping" → "pong"); when it opens one it says so ("opened"), and any other tab of the
// same user that is in a different company closes it and returns to the company list. The same
// company in several tabs is fine. Browsers without BroadcastChannel fall back to no coordination.

type Message =
  | { type: "ping"; userId: string; from: string; requestId: string }
  | { type: "pong"; userId: string; from: string; requestId: string; companyId: string }
  | { type: "opened"; userId: string; from: string; companyId: string };

const CHANNEL = "pako.company-presence";

export class CompanyPresence {
  private channel: BroadcastChannel | null;
  private waiting = new Map<string, Set<string>>();

  constructor(
    private readonly userId: string,
    private readonly tabId: string,
    private readonly getActive: () => string | null,
    private readonly onReplaced: (newCompanyId: string) => void,
  ) {
    this.channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    if (this.channel) this.channel.onmessage = (event: MessageEvent<Message>) => this.receive(event.data);
  }

  private send(message: Message) {
    this.channel?.postMessage(message);
  }

  private receive(message: Message) {
    if (!message || message.userId !== this.userId || message.from === this.tabId) return;
    const active = this.getActive();
    if (message.type === "ping" && active) {
      this.send({ type: "pong", userId: this.userId, from: this.tabId, requestId: message.requestId, companyId: active });
    } else if (message.type === "pong") {
      // Each question has its own id, so overlapping questions never steal each other's answers.
      this.waiting.get(message.requestId)?.add(message.companyId);
    } else if (message.type === "opened" && active && active !== message.companyId) {
      this.onReplaced(message.companyId);
    }
  }

  /** Companies open in this user's other tabs and windows right now. */
  async openElsewhere(timeoutMs = 250): Promise<string[]> {
    if (!this.channel) return [];
    const found = new Set<string>();
    const requestId = newTabId();
    this.waiting.set(requestId, found);
    this.send({ type: "ping", userId: this.userId, from: this.tabId, requestId });
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    this.waiting.delete(requestId);
    return [...found];
  }

  /** Tells the other tabs this one now has the company open; tabs in another company close theirs. */
  announceOpened(companyId: string) {
    this.send({ type: "opened", userId: this.userId, from: this.tabId, companyId });
  }

  close() {
    this.channel?.close();
    this.channel = null;
  }
}

export function newTabId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
