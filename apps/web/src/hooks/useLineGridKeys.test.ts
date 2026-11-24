import { describe, expect, it } from "vitest";

import { normalizePastedNumber } from "@/hooks/useLineGridKeys";

describe("normalizePastedNumber", () => {
  it("reads grouped and decimal-comma figures from a spreadsheet", () => {
    expect(normalizePastedNumber("1,234.56")).toBe("1234.56");
    expect(normalizePastedNumber("1.234,56")).toBe("1234.56");
    expect(normalizePastedNumber("12,5")).toBe("12.5");
    expect(normalizePastedNumber("1,234")).toBe("1234");
    expect(normalizePastedNumber(" 7 € ")).toBe("7");
    expect(normalizePastedNumber("3.5")).toBe("3.5");
  });
});
