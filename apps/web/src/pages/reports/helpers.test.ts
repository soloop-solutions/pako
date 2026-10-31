import { afterEach, describe, expect, it, vi } from "vitest";

import { startOfMonth, today } from "./helpers";

describe("local date helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("startOfMonth is the 1st of the local month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31, 12, 0, 0));
    expect(startOfMonth()).toBe("2026-10-01");
  });

  it("startOfMonth is the 1st even when local midnight is the previous day in UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 0, 30, 0));
    expect(startOfMonth()).toBe("2026-01-01");
  });

  it("today uses the local calendar date just after local midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31, 0, 5, 0));
    expect(today()).toBe("2026-10-31");
  });

  it("today uses the local calendar date just before local midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31, 23, 55, 0));
    expect(today()).toBe("2026-10-31");
  });
});
