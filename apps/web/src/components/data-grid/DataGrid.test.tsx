import type { ColumnDef } from "@tanstack/react-table";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { DataGrid, type DataGridProps } from "@/components/data-grid/DataGrid";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

interface Row {
  id: string;
  name: string;
  code: string;
}

const ROWS: Row[] = [
  { id: "1", name: "Cash", code: "1000" },
  { id: "2", name: "Accounts Receivable", code: "1200" },
  { id: "3", name: "Accounts Payable", code: "2000" },
];

const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: "code", header: "Code" },
  { accessorKey: "name", header: "Name" },
];

function renderGrid(overrides: Partial<DataGridProps<Row>> = {}) {
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <DataGrid<Row>
          gridId="test-grid"
          columns={COLUMNS}
          data={ROWS}
          rowCount={ROWS.length}
          getRowId={(row) => row.id}
          enableGlobalFilter
          manualFiltering={false}
          {...overrides}
        />
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("DataGrid global filter", () => {
  it("narrows the visible rows when manualFiltering is false, not just the URL", async () => {
    renderGrid();

    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText("Accounts Receivable")).toBeInTheDocument();
    expect(screen.getByText("Accounts Payable")).toBeInTheDocument();

    const search = screen.getByPlaceholderText("Search...");
    fireEvent.change(search, { target: { value: "Receivable" } });

    await waitFor(() => {
      expect(screen.queryByText("Cash")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Accounts Receivable")).toBeInTheDocument();
    expect(screen.queryByText("Accounts Payable")).not.toBeInTheDocument();
  });

  it("does not filter rows when manualFiltering is true, since the caller owns filtering", async () => {
    renderGrid({ manualFiltering: true });

    const search = screen.getByPlaceholderText("Search...");
    fireEvent.change(search, { target: { value: "Receivable" } });

    await waitFor(() => {
      expect(search).toHaveValue("Receivable");
    });
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText("Accounts Receivable")).toBeInTheDocument();
    expect(screen.getByText("Accounts Payable")).toBeInTheDocument();
  });
});
