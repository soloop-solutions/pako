import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanyPresence } from "@/lib/company-presence";

const tabs: CompanyPresence[] = [];
afterEach(() => tabs.splice(0).forEach((t) => t.close()));

function tab(userId: string, tabId: string, active: { id: string | null }) {
  const onReplaced = vi.fn((next: string) => {
    active.id = null;
    return next;
  });
  const presence = new CompanyPresence(userId, tabId, () => active.id, onReplaced);
  tabs.push(presence);
  return { presence, onReplaced };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("company presence across tabs", () => {
  it("finds the company open in another tab of the same user", async () => {
    tab("u1", "A", { id: "c1" });
    tab("u2", "X", { id: "c9" }); // someone else's session is ignored
    const { presence } = tab("u1", "B", { id: null });
    expect(await presence.openElsewhere(100)).toEqual([{ companyId: "c1", unsaved: false }]);
  });

  it("opening a different company closes it in the other tabs; the same company does not", async () => {
    const a = { id: "c1" as string | null };
    const tabA = tab("u1", "A", a);
    const tabB = tab("u1", "B", { id: null });

    tabB.presence.announceOpened("c1");
    await settle();
    expect(tabA.onReplaced).not.toHaveBeenCalled();

    tabB.presence.announceOpened("c2");
    await settle();
    expect(tabA.onReplaced).toHaveBeenCalledWith("c2");
    expect(a.id).toBeNull();
  });

  it("overlapping questions each get their own answers", async () => {
    tab("u1", "A", { id: "c1" });
    const { presence } = tab("u1", "B", { id: null });
    const [first, second] = await Promise.all([presence.openElsewhere(120), presence.openElsewhere(60)]);
    expect(first).toEqual([{ companyId: "c1", unsaved: false }]);
    expect(second).toEqual([{ companyId: "c1", unsaved: false }]);
  });

  it("tells the asking tab when the other tab has unsaved edits", async () => {
    tabs.push(new CompanyPresence("u1", "A", () => "c1", () => undefined, () => true));
    const { presence } = tab("u1", "B", { id: null });
    expect(await presence.openElsewhere(100)).toEqual([{ companyId: "c1", unsaved: true }]);
  });
});
