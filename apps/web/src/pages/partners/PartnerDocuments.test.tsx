import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PartnerDocuments } from "@/pages/partners/PartnerDocuments";

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      paged2: async () => ({
        items: [
          { id: "inv-1", invoiceNumber: "INV-0001", documentType: 0, issueDate: "2026-01-02", totals: { grossAmount: 10 } },
          { id: "ret-1", invoiceNumber: "RET-0001", documentType: 4, issueDate: "2026-01-03", totals: { grossAmount: 5 } },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
      }),
      paged: async () => ({
        items: [
          { id: "bill-1", vendorReference: "B-1", documentType: 0, issueDate: "2026-01-02" },
          { id: "pr-1", vendorReference: "PR-1", documentType: 2, issueDate: "2026-01-03" },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
      }),
    },
  };
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

describe("PartnerDocuments", () => {
  it("links each row to its detail page by document kind", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProviderWrapper>
          <MemoryRouter>
            <PartnerDocuments companyId="c" partnerId="p" showSales showPurchases />
            <Where />
          </MemoryRouter>
        </IntlProviderWrapper>
      </QueryClientProvider>,
    );
    await screen.findByText("INV-0001");
    const expected: [string, string][] = [
      ["INV-0001", "/invoicing/inv-1"],
      ["RET-0001", "/sales-returns/ret-1"],
      ["B-1", "/bills/bill-1"],
      ["PR-1", "/purchase-returns/pr-1"],
    ];
    for (const [text, path] of expected) {
      fireEvent.click(await screen.findByText(text));
      expect(screen.getByTestId("where").textContent).toBe(path);
    }
  });
});
