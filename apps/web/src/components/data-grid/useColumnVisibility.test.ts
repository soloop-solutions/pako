import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useColumnVisibility } from "@/components/data-grid/useColumnVisibility";

describe("useColumnVisibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists a visibility change to localStorage and a fresh instance for the same gridId reads it back", () => {
    const { result, unmount } = renderHook(() => useColumnVisibility("items"));

    act(() => result.current[1]({ barcodes: false }));
    expect(result.current[0]).toEqual({ barcodes: false });
    expect(JSON.parse(localStorage.getItem("pako.dataGrid.items.columnVisibility") ?? "{}")).toEqual({
      barcodes: false,
    });
    unmount();

    const { result: second } = renderHook(() => useColumnVisibility("items"));
    expect(second.current[0]).toEqual({ barcodes: false });
  });

  it("scopes storage per gridId", () => {
    const { result: items } = renderHook(() => useColumnVisibility("items"));
    act(() => items.current[1]({ barcodes: false }));

    const { result: invoices } = renderHook(() => useColumnVisibility("invoices"));
    expect(invoices.current[0]).toEqual({});
  });

  it("supports the functional updater form", () => {
    const { result } = renderHook(() => useColumnVisibility("items"));

    act(() => result.current[1]({ code: true, name: true }));
    act(() => result.current[1]((old) => ({ ...old, code: false })));

    expect(result.current[0]).toEqual({ code: false, name: true });
  });
});
