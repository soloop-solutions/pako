import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ListRibbon } from "@/components/list/ListRibbon";
import { PageHeader } from "@/components/list/PageHeader";
import { useListFilters } from "@/components/list/useListFilters";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { useAllSavedListViews } from "@/lib/list-views";

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { userId: "u1" } }),
  useOptionalAuth: () => ({ auth: { userId: "u1" } }),
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1" }) }));

function Search() {
  const location = useLocation();
  return <p data-testid="search">{decodeURIComponent(location.search)}</p>;
}

function SavedViews() {
  const { views } = useAllSavedListViews();
  return <ul>{(views.invoices ?? []).map((v) => <li key={v.id} data-testid="saved-view">{`${v.name}|${v.query}`}</li>)}</ul>;
}

function Ribbon() {
  const controls = useListFilters("invoices", ["from", "to", "partnerId", "state"]);
  return (
    <ListRibbon
      controls={controls}
      dateLabelId="docFilters.issueDate"
      selects={[
        { name: "partnerId", labelId: "docFilters.customer", options: [{ value: "p1", label: "Market Arbeni" }] },
        { name: "state", labelId: "listRibbon.state", options: [{ value: "Draft", label: "Draft" }] },
      ]}
    />
  );
}

function renderRibbon(path = "/invoicing") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <Ribbon />
        <Search />
        <SavedViews />
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());

describe("ListRibbon", () => {
  it("puts a preset period in the URL, shows it as a chip and clears it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 25));
    renderRibbon("/invoicing?invoices.page=3");

    fireEvent.click(screen.getByRole("button", { name: "Last month" }));
    expect(screen.getByTestId("search")).toHaveTextContent("invoices.from=2026-10-01&invoices.to=2026-10-31");
    expect(screen.getByTestId("search")).not.toHaveTextContent("invoices.page");
    expect(screen.getByRole("button", { name: "Last month" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("list-ribbon-chips")).toHaveTextContent("Issue date: Last month");

    fireEvent.click(screen.getByRole("button", { name: "Remove filter Issue date: Last month" }));
    expect(screen.getByTestId("search")).toHaveTextContent(/^$/);
    vi.useRealTimers();
  });

  it("reads filters from the URL, names them in chips and clears them all", () => {
    renderRibbon("/invoicing?invoices.partnerId=p1&invoices.state=Draft&invoices.from=2026-11-02&invoices.to=2026-11-20");
    const chips = screen.getByTestId("list-ribbon-chips");
    expect(chips).toHaveTextContent("Customer: Market Arbeni");
    expect(chips).toHaveTextContent("Issue date: 02.11.2026 – 20.11.2026");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters (3)" }));
    expect(screen.getByTestId("search")).toHaveTextContent(/^$/);
    expect(screen.queryByTestId("list-ribbon-chips")).not.toBeInTheDocument();
  });

  it("saves the current filters as a named view", () => {
    renderRibbon("/invoicing?invoices.partnerId=p1&other=x");
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Arbeni" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("saved-view")).toHaveTextContent("Arbeni|invoices.partnerId=p1");
  });
});

describe("PageHeader and shortcuts", () => {
  it("N runs the New action, but not while typing in a field", () => {
    const onNew = vi.fn();
    render(
      <IntlProviderWrapper>
        <PageHeader title="Invoices" newAction={{ label: "New invoice", onClick: onNew }} />
        <input aria-label="field" />
      </IntlProviderWrapper>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "field" }), { key: "n" });
    expect(onNew).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(onNew).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
