// crypto.randomUUID exists only in a secure context (https or localhost). A till tablet opening the
// app over plain http on the shop network has crypto.getRandomValues but not randomUUID, so the till
// would crash on its first sale. Fill it in from getRandomValues (RFC 4122 version 4).
export function installRandomUuid(target: Crypto | undefined = globalThis.crypto): void {
  if (!target || typeof target.randomUUID === "function") return;
  Object.defineProperty(target, "randomUUID", {
    configurable: true,
    value: (): `${string}-${string}-${string}-${string}-${string}` => {
      const b = target.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  });
}
