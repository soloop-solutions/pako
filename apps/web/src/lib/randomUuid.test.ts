import { installRandomUuid } from "./randomUuid";

describe("installRandomUuid", () => {
  it("adds a v4 randomUUID when the browser lacks one (plain http on a LAN)", () => {
    const fake = { getRandomValues: (a: Uint8Array) => globalThis.crypto.getRandomValues(a) } as unknown as Crypto;
    installRandomUuid(fake);
    const id = fake.randomUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fake.randomUUID()).not.toBe(id);
  });

  it("leaves a native randomUUID alone", () => {
    const native = () => "native" as `${string}-${string}-${string}-${string}-${string}`;
    const fake = { randomUUID: native } as unknown as Crypto;
    installRandomUuid(fake);
    expect(fake.randomUUID).toBe(native);
  });
});
