import { beforeEach, describe, expect, it, vi } from "vitest";

const itemsGET = vi.fn();

vi.mock("@/api/client", () => ({ apiClient: { itemsGET: (...args: unknown[]) => itemsGET(...args) } }));

import { fetchAllItems } from "./fetchAllItems";

const item = (id: string) => ({ id });

describe("fetchAllItems", () => {
  beforeEach(() => itemsGET.mockReset());

  it("returns a single page without further requests", async () => {
    itemsGET.mockResolvedValueOnce({ items: [item("a")], total: 1 });
    const result = await fetchAllItems("c1");
    expect(result.items).toEqual([item("a")]);
    expect(itemsGET).toHaveBeenCalledTimes(1);
  });

  it("loads every page when there are more than 200 items", async () => {
    itemsGET
      .mockResolvedValueOnce({ items: [item("a")], total: 450 })
      .mockResolvedValueOnce({ items: [item("b")], total: 450 })
      .mockResolvedValueOnce({ items: [item("c")], total: 450 });
    const result = await fetchAllItems("c1");
    expect(result.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(itemsGET).toHaveBeenCalledTimes(3);
    expect(itemsGET).toHaveBeenNthCalledWith(3, "c1", 3, 200, undefined, undefined);
  });
});
