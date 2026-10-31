import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { Table, TableBody, TableCell } from "@/components/ui/table";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

import { EntityLink } from "./EntityLink";
import { LinkedRow } from "./LinkedRow";
import { ReportGrid, type ReportRow } from "./ReportGrid";

function Probe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

const rows: ReportRow[] = [
  { key: "a", kind: "line", code: "100", label: "Linked", values: [1] },
  { key: "b", kind: "line", code: "200", label: "Plain", values: [2] },
];

function renderGrid() {
  const client = new QueryClient();
  return render(
    <MemoryRouter initialEntries={["/reports"]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={client}>
          <ReportGrid
            gridId="t"
            rows={rows}
            valueHeaders={["Amount"]}
            rowLink={(row) => (row.key === "a" ? "/bills/1" : null)}
          />
          <Probe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ReportGrid rowLink", () => {
  it("navigates on click", () => {
    renderGrid();
    fireEvent.click(screen.getByText("Linked"));
    expect(screen.getByTestId("location").textContent).toBe("/bills/1");
  });

  it("opens a new tab on ctrl click and middle click without navigating", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderGrid();
    fireEvent.click(screen.getByText("Linked"), { ctrlKey: true });
    fireEvent.click(screen.getByText("Linked"), { metaKey: true });
    fireEvent(screen.getByText("Linked"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenCalledWith("/bills/1", "_blank", "noopener");
    expect(screen.getByTestId("location").textContent).toBe("/reports");
  });

  it("navigates on Enter from the focused row", () => {
    renderGrid();
    const row = screen.getByText("Linked").closest("tr") as HTMLElement;
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByTestId("location").textContent).toBe("/bills/1");
  });

  it("leaves rows with a null link inert", () => {
    renderGrid();
    const row = screen.getByText("Plain").closest("tr") as HTMLElement;
    expect(row.getAttribute("tabindex")).toBeNull();
    expect(row.className).not.toContain("cursor-pointer");
    fireEvent.click(screen.getByText("Plain"));
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByTestId("location").textContent).toBe("/reports");
  });
});

describe("LinkedRow and EntityLink", () => {
  function renderRow(to: string | null) {
    return render(
      <MemoryRouter initialEntries={["/start"]}>
        <Table>
          <TableBody>
            <LinkedRow to={to}>
              <TableCell>
                <EntityLink to="/chart-of-accounts?open=9">Account</EntityLink>
              </TableCell>
              <TableCell>cell</TableCell>
            </LinkedRow>
          </TableBody>
        </Table>
        <Probe />
      </MemoryRouter>,
    );
  }

  it("navigates on row click and Enter", () => {
    renderRow("/invoicing/5");
    fireEvent.click(screen.getByText("cell"));
    expect(screen.getByTestId("location").textContent).toBe("/invoicing/5");
  });

  it("opens a new tab on ctrl click", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderRow("/invoicing/5");
    fireEvent.click(screen.getByText("cell"), { ctrlKey: true });
    expect(open).toHaveBeenCalledWith("/invoicing/5", "_blank", "noopener");
  });

  it("is inert without a link", () => {
    renderRow(null);
    fireEvent.click(screen.getByText("cell"));
    expect(screen.getByTestId("location").textContent).toBe("/start");
  });

  it("EntityLink goes to its own target, not the row link", () => {
    renderRow("/invoicing/5");
    fireEvent.click(screen.getByText("Account"));
    expect(screen.getByTestId("location").textContent).toBe("/chart-of-accounts?open=9");
  });

  it("EntityLink stops propagation to the row", () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={onClick}>
          <EntityLink to="/x">go</EntityLink>
        </div>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(onClick).not.toHaveBeenCalled();
  });
});
