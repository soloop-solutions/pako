import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { GlobalSearch, OPEN_GLOBAL_SEARCH_EVENT } from "@/components/layout/GlobalSearch";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

const searchMock = vi.fn();
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { ...actual.apiClient, search: (...args: unknown[]) => searchMock(...args) } };
});
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompany: { id: "c1", name: "Co" } }) }));

// UI/UX round 2026-11-24: the header button opens the palette; a failed search says so.
describe("GlobalSearch", () => {
  it("opens from the header event as a labelled dialog and reports a failed search", async () => {
    searchMock.mockRejectedValue(new Error("offline"));
    render(
      <MemoryRouter>
        <IntlProviderWrapper>
          <GlobalSearch />
        </IntlProviderWrapper>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event(OPEN_GLOBAL_SEARCH_EVENT));
    });
    const dialog = screen.getByRole("dialog", { name: "Search" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "INV-0042" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Search failed");
    expect(dialog).not.toHaveTextContent("No results found.");
  });
});
