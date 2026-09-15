import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/?items.page=2&items.q=laptop"]}>{children}</MemoryRouter>;
}

describe("useDataGridUrlState", () => {
  it("parses page, default page size, and global filter from the URL", () => {
    const { result } = renderHook(() => useDataGridUrlState("items", 50), { wrapper });

    expect(result.current.page).toBe(2);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.globalFilter).toBe("laptop");
    expect(result.current.skip).toBe(50);
    expect(result.current.take).toBe(50);
  });

  it("round-trips sort direction through the URL encoding", () => {
    const { result } = renderHook(() => useDataGridUrlState("items", 50), { wrapper });

    act(() => result.current.setSort({ id: "name", desc: false }));
    expect(result.current.sort).toEqual({ id: "name", desc: false });

    act(() => result.current.setSort({ id: "name", desc: true }));
    expect(result.current.sort).toEqual({ id: "name", desc: true });

    act(() => result.current.setSort(null));
    expect(result.current.sort).toBeNull();
  });

  it("resets the page to 1 when the global filter or a column filter changes, but not on an explicit page change", () => {
    const { result } = renderHook(() => useDataGridUrlState("items", 50), { wrapper });

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    act(() => result.current.setGlobalFilter("chair"));
    expect(result.current.page).toBe(1);
    expect(result.current.globalFilter).toBe("chair");

    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);

    act(() => result.current.setColumnFilter("unit", "copë"));
    expect(result.current.page).toBe(1);
    expect(result.current.columnFilters).toEqual({ unit: "copë" });
  });

  it("scopes every param to its gridId, independent of other grids on the same URL", () => {
    const { result } = renderHook(
      () => ({ items: useDataGridUrlState("items", 50), invoices: useDataGridUrlState("invoices", 50) }),
      { wrapper },
    );

    act(() => result.current.items.setSort({ id: "name", desc: false }));
    expect(result.current.items.sort).toEqual({ id: "name", desc: false });
    expect(result.current.invoices.sort).toBeNull();
  });
});
