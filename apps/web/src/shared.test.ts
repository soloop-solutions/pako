import { describe, expect, it } from "vitest";

import { AccountSchema } from "@pako/shared";

describe("@pako/shared workspace import", () => {
  it("resolves and validates a ledger Account", () => {
    const result = AccountSchema.safeParse({
      id: "acc_1",
      companyId: "co_1",
      code: "1000",
      name: "Cash",
      accountType: "cash",
      parentId: null,
      reconcilable: false,
    });

    expect(result.success).toBe(true);
  });
});
