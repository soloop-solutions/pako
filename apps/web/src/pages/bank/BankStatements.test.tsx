import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { BankStatementDetailResponse, BankStatementImportResponse, UpdateBankStatementLineRequest } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { BankStatementDetail } from "@/pages/bank/BankStatementDetail";
import { BankStatements } from "@/pages/bank/BankStatements";

const companyId = "11111111-1111-1111-1111-111111111111";

const summary = {
  id: "s1", bankAccountId: "a1", bankAccountName: "1100 Raiffeisen", fileName: "nov.xlsx",
  periodFrom: "2026-11-01", periodTo: "2026-11-30", openingBalance: 500, closingBalance: 128.14,
  totalIn: 830.64, totalOut: 1202.5, state: "Draft", lineCount: 3, matchedCount: 0, openCount: 3,
  createdAt: "2026-11-19T10:00:00Z", confirmedAt: undefined,
};

const line = (over: Partial<BankStatementDetailResponse["lines"][number]>) => ({
  id: "l1", rowNumber: 11, date: "2026-11-03", description: "Pagese", partnerText: undefined, reference: undefined,
  amountIn: 0, amountOut: 0, state: "Open", matchStatus: "None", isDuplicate: false, partnerId: undefined,
  partnerName: undefined, invoiceId: undefined, billId: undefined, documentNumber: undefined,
  documentOutstanding: undefined, matchAmount: undefined, journalEntryId: undefined, ...over,
});

const detail: BankStatementDetailResponse = {
  summary,
  balanceDifference: 0,
  ledgerOpeningBalance: 500,
  lines: [
    line({ id: "l1", rowNumber: 11, amountIn: 830.64, matchStatus: "Ready", invoiceId: "i1", documentNumber: "01/2026", matchAmount: 830.64, partnerName: "Market Viva" }),
    line({ id: "l2", rowNumber: 12, amountOut: 1200, matchStatus: "Choose", partnerName: "Furnitori X" }),
    line({ id: "l3", rowNumber: 13, amountOut: 2.5, description: "Komision bankar" }),
  ],
};

const importMock = vi.fn(async (): Promise<BankStatementImportResponse> => ({
  statement: undefined,
  errors: [
    { row: 12, message: "Fill in Money in or Money out, not both." },
    { row: 0, message: "The statement has no lines." },
  ],
}));
const confirmMock = vi.fn(async (): Promise<BankStatementDetailResponse> => ({
  ...detail,
  summary: { ...summary, state: "Confirmed" },
  lines: detail.lines.map((l) => (l.matchStatus === "Ready" ? { ...l, state: "Matched", matchStatus: "Matched" } : l)),
}));
const updateMock = vi.fn(async (_c: string, _s: string, _l: string, body: UpdateBankStatementLineRequest): Promise<BankStatementDetailResponse> => {
  void body;
  return { ...detail, lines: detail.lines.map((l) => (l.id === "l3" ? { ...l, state: "Ignored", matchStatus: "Ignored" } : l)) };
});

const listMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [summary];
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listBankStatementAccounts: async () => [{ id: "a1", code: "1100", name: "Raiffeisen" }],
      listBankStatements: (...args: unknown[]) => listMock(...args),
      bankStatementListTotals: async () => ({ count: 1, totalIn: 830.64, totalOut: 1202.5 }),
      importBankStatement: () => importMock(),
      getBankStatement: async () => detail,
      confirmBankStatement: () => confirmMock(),
      updateBankStatementLine: (c: string, s: string, l: string, body: UpdateBankStatementLineRequest) => updateMock(c, s, l, body),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: companyId, activeCompany: { id: companyId, name: "Test Co" } }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isAdmin: true }, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/bank-statements" element={<BankStatements />} />
            <Route path="/bank-statements/:id" element={<BankStatementDetail />} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Bank statements", () => {
  it("lists imported statements and shows every row error of a refused upload", async () => {
    renderAt("/bank-statements");
    expect(await screen.findByText("nov.xlsx")).toBeInTheDocument();
    expect(screen.getByText("0 paid · 3 open · 3 lines")).toBeInTheDocument();

    const file = new File(["x"], "nov.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await waitFor(() => expect(screen.getByTestId("bank-statement-file")).not.toBeDisabled());
    fireEvent.change(screen.getByTestId("bank-statement-file"), { target: { files: [file] } });

    const errors = await screen.findByTestId("bank-statement-import-errors");
    expect(errors).toHaveTextContent("Row 12: Fill in Money in or Money out, not both.");
    expect(errors).toHaveTextContent("The statement has no lines.");
    expect(importMock).toHaveBeenCalled();
  });

  it("shows each line's match, ignores a line and confirms after asking", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAt("/bank-statements/s1");

    expect(await screen.findByText("01/2026")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Choose")).toBeInTheDocument();
    expect(screen.getByText("No match")).toBeInTheDocument();
    expect(screen.getByTestId("bank-statement-balance")).toHaveTextContent("equals the closing balance");

    fireEvent.click(screen.getAllByRole("button", { name: "Ignore" })[2]);
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][2]).toBe("l3");
    expect(updateMock.mock.calls[0][3]).toEqual({ ignore: true });

    fireEvent.click(screen.getByRole("button", { name: "Confirm and record payments" }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith("Record 1 payments from this statement? Lines without an invoice or bill stay open.");
    expect(await screen.findByText("Paid")).toBeInTheDocument();
  });
});

// Client request 2026-11-24: the list ribbon filters on the server and the totals are the server's.
describe("Bank statements list ribbon", () => {
  it("sends the URL filters to the server and shows its totals", async () => {
    listMock.mockClear();
    renderAt("/bank-statements?bank-statements.state=Confirmed&bank-statements.bankAccountId=a1&bank-statements.from=2026-11-01&bank-statements.to=2026-11-30");
    expect(await screen.findByText("nov.xlsx")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith(companyId, "a1", 1, "2026-11-01", "2026-11-30");
    const bar = await screen.findByTestId("list-totals");
    expect(bar).toHaveTextContent("Money out1,202.50");
    expect(bar).toHaveTextContent("Money in830.64");
  });
});
