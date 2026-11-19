import { describe, expect, it } from "vitest";

import { paymentStatus } from "@/lib/document-types";

const today = "2026-11-19";

describe("paymentStatus", () => {
  it("is undefined until the balance has loaded", () => {
    expect(paymentStatus(undefined, "2026-12-01", today)).toBeUndefined();
  });

  it("is paid when nothing is outstanding, even if the due date has passed", () => {
    expect(paymentStatus({ reconciled: 100, outstanding: 0 }, "2026-01-01", today)).toBe("paid");
  });

  it("is overdue when something is outstanding after the due date", () => {
    expect(paymentStatus({ reconciled: 40, outstanding: 60 }, "2026-11-18", today)).toBe("overdue");
  });

  it("is partial or unpaid before the due date, and due today is not yet overdue", () => {
    expect(paymentStatus({ reconciled: 40, outstanding: 60 }, "2026-12-01", today)).toBe("partial");
    expect(paymentStatus({ reconciled: 0, outstanding: 100 }, "2026-11-19", today)).toBe("unpaid");
  });
});
