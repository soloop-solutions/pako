import { createIntl } from "react-intl";
import { describe, expect, it } from "vitest";

import { en, sq } from "@/i18n/messages";
import {
  isHourBasedKind,
  monthBounds,
  nextUnrunMonth,
  PayrollAdjustmentKind,
  payrollRunActions,
  payrollRunStateBadgeVariant,
  payrollWarningMessage,
} from "@/lib/payroll-enums";

describe("payroll run workflow", () => {
  it("maps each state to its workflow actions", () => {
    expect(payrollRunActions("Draft")).toEqual(["recompute", "approve", "post", "delete"]);
    expect(payrollRunActions("Approved")).toEqual(["returnToDraft", "post"]);
    expect(payrollRunActions("Posted")).toEqual(["pay"]);
    expect(payrollRunActions("Paid")).toEqual([]);
    expect(payrollRunActions("Unknown")).toEqual([]);
  });

  it("shows a draft run muted and a paid run as success", () => {
    expect(payrollRunStateBadgeVariant("Draft")).toBe("draft");
    expect(payrollRunStateBadgeVariant("Paid")).toBe("success");
  });
});

describe("payroll adjustment kinds", () => {
  it("treats overtime, night, weekend and holiday work as hour-based only", () => {
    const hourBased = Object.values(PayrollAdjustmentKind).filter(isHourBasedKind);
    expect(hourBased).toEqual([3, 4, 5, 6]);
  });
});

describe("payroll months", () => {
  it("gives the first and last day of a month, leap years included", () => {
    expect(monthBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthBounds("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("suggests the month after the latest run, or the current month when there is none", () => {
    expect(nextUnrunMonth([], new Date(2026, 9, 14))).toBe("2026-10");
    expect(nextUnrunMonth([{ periodStart: "2026-11-01" }, { periodStart: "2026-12-01" }])).toBe("2027-01");
  });
});

describe("payroll warnings", () => {
  it("translates the code prefix and keeps the detail", () => {
    const intl = createIntl({ locale: "en", messages: en });
    expect(payrollWarningMessage("MissingPersonalNumber:Arta Krasniqi", intl)).toContain("Arta Krasniqi");
    expect(payrollWarningMessage("MissingPersonalNumber:Arta Krasniqi", intl)).not.toContain("MissingPersonalNumber");
    expect(payrollWarningMessage("SomethingNew:x", intl)).toBe("SomethingNew:x");
  });

  it("has every payroll key in both EN and SQ", () => {
    const enKeys = Object.keys(en).filter((k) => k.startsWith("payroll."));
    const missing = enKeys.filter((k) => !(k in sq));
    expect(missing).toEqual([]);
  });
});
