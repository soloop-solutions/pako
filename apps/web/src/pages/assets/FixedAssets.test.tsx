import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { FixedAssets } from "@/pages/assets/FixedAssets";

// The tab pages are lazy-rendered grids; on a loaded machine the 1 s default is too tight.
configure({ asyncUtilTimeout: 5000 });

const api = vi.hoisted(() => ({
  listFixedAssets: vi.fn(),
  listAssetCategories: vi.fn(),
  getFixedAsset: vi.fn(),
  createFixedAsset: vi.fn(),
  updateFixedAsset: vi.fn(),
  deleteFixedAsset: vi.fn(),
  disposeFixedAsset: vi.fn(),
  listDepreciationRuns: vi.fn(),
  previewDepreciationRun: vi.fn(),
  postDepreciationRun: vi.fn(),
  reverseDepreciationRun: vi.fn(),
  fixedAssetSchedule: vi.fn(),
  fixedAssetScheduleExport: vi.fn(),
  createDefaultAssetCategories: vi.fn(),
  createAssetCategory: vi.fn(),
  updateAssetCategory: vi.fn(),
  accountsAll: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  const mocked = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]));
  return { ...actual, apiClient: { ...actual.apiClient, ...mocked } };
});
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1" }) }));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/pages/reports/helpers", async (importOriginal) => ({ ...(await importOriginal<object>()), downloadFileResponse: download }));

const MACHINERY = {
  id: "cat1", name: "Machinery", assetAccountId: "a152", assetAccountCode: "152100", isDepreciable: true,
  accumulatedDepreciationAccountId: "a159", accumulatedDepreciationAccountCode: "159200",
  depreciationExpenseAccountId: "a650", depreciationExpenseAccountCode: "650200", defaultUsefulLifeMonths: 120, isActive: true, assetCount: 1,
};
const LATHE = {
  id: "fa1", code: "AS-00001", name: "CNC lathe", categoryId: "cat1", categoryName: "Machinery", isDepreciable: true,
  acquisitionDate: "2026-01-10", inServiceDate: "2026-01-15", cost: 1200, residualValue: 0, usefulLifeMonths: 12,
  openingAccumulatedDepreciation: 0, accumulatedDepreciation: 200, bookValue: 1000, monthlyDepreciation: 100,
  lastDepreciatedPeriod: "2026-03-01", isFullyDepreciated: false, status: "Active", disposedOn: undefined, disposalProceeds: undefined,
  disposalJournalEntryId: undefined, hasDepreciation: true, serialNumber: "SN-1", location: undefined, notes: undefined,
};
const AMOUNTS = (dep: number) => ({
  costOpening: 0, additions: 1200, costDisposed: 0, costClosing: 1200, accumulatedOpening: 0, depreciation: dep,
  accumulatedDisposed: 0, accumulatedClosing: dep, bookValueOpening: 0, bookValueClosing: 1200 - dep,
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <FixedAssets />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.confirm = () => true;
  api.listFixedAssets.mockResolvedValue({ items: [LATHE], total: 1, page: 1, pageSize: 50 });
  api.listAssetCategories.mockResolvedValue([MACHINERY]);
  api.accountsAll.mockResolvedValue([]);
  api.getFixedAsset.mockResolvedValue({
    asset: LATHE,
    schedule: [
      { period: "2026-02-01", amount: 100, accumulated: 100, bookValue: 1100, posted: true },
      { period: "2026-03-01", amount: 100, accumulated: 200, bookValue: 1000, posted: true },
      { period: "2026-04-01", amount: 100, accumulated: 300, bookValue: 900, posted: false },
    ],
  });
  api.listDepreciationRuns.mockResolvedValue([
    { id: "r2", period: "2026-03-01", state: "Posted", total: 100, assetCount: 1, journalEntryId: "je2", reversalJournalEntryId: undefined, postedAt: "2026-04-01T08:00:00Z" },
    { id: "r1", period: "2026-02-01", state: "Posted", total: 100, assetCount: 1, journalEntryId: "je1", reversalJournalEntryId: undefined, postedAt: "2026-03-01T08:00:00Z" },
  ]);
  api.previewDepreciationRun.mockResolvedValue({
    period: "2026-04-01", lastPostedPeriod: "2026-03-01", alreadyPosted: false, total: 100,
    lines: [{ fixedAssetId: "fa1", code: "AS-00001", name: "CNC lathe", categoryName: "Machinery", amount: 100, accumulatedAfter: 300, bookValueAfter: 900 }],
    categories: [{ categoryId: "cat1", categoryName: "Machinery", expenseAccountCode: "650200", accumulatedAccountCode: "159200", amount: 100 }],
  });
});

describe("Fixed assets register", () => {
  it("lists the API's figures and opens the asset with its plan", async () => {
    renderAt("/fixed-assets");
    expect(await screen.findByText("CNC lathe")).toBeInTheDocument();
    expect(screen.getByText("1000.00")).toBeInTheDocument();
    expect(api.listFixedAssets).toHaveBeenCalledWith("c1", 1, 50, undefined, undefined, undefined, undefined);

    fireEvent.click(screen.getByText("CNC lathe"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Depreciation plan")).toBeInTheDocument();
    expect(within(dialog).getByTestId("asset-figures")).toHaveTextContent("03/2026");
    // Depreciation is posted: the plan fields are locked.
    expect(within(dialog).getByLabelText(/^Cost/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/^Asset/)).not.toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("filters by status from the URL", async () => {
    renderAt("/fixed-assets?assetStatus=disposed");
    await waitFor(() => expect(api.listFixedAssets).toHaveBeenCalledWith("c1", 1, 50, undefined, undefined, "disposed", undefined));
  });

  it("creates an asset; an empty code is left to the number series", async () => {
    api.createFixedAsset.mockResolvedValue({ ...LATHE, id: "fa2", code: "AS-00002" });
    renderAt("/fixed-assets");
    fireEvent.click(await screen.findByRole("button", { name: "New asset" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Asset/), { target: { value: "Forklift" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: /^Category/ }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Machinery" }));
    // The category's useful life fills the field.
    expect(within(dialog).getByLabelText(/^Useful life/)).toHaveValue(120);
    fireEvent.change(within(dialog).getByLabelText(/^Cost/), { target: { value: "8000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.createFixedAsset).toHaveBeenCalled());
    expect(api.createFixedAsset.mock.calls[0][1]).toMatchObject({ code: undefined, name: "Forklift", categoryId: "cat1", cost: 8000, usefulLifeMonths: 120 });
  });
});

describe("Depreciation runs", () => {
  it("previews the month after the last posted one and posts it", async () => {
    api.postDepreciationRun.mockResolvedValue({ id: "r3", period: "2026-04-01", state: "Posted", total: 100, assetCount: 1, journalEntryId: "je3", postedAt: "" });
    renderAt("/fixed-assets?tab=depreciation");
    await waitFor(() => expect(api.previewDepreciationRun).toHaveBeenCalledWith("c1", "2026-04-01"));
    expect(await screen.findByTestId("depreciation-total")).toHaveTextContent("100.00");
    expect(screen.getByText("650200")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Post depreciation for 04/2026" }));
    await waitFor(() => expect(api.postDepreciationRun).toHaveBeenCalledWith("c1", { period: "2026-04-01" }));
  });

  it("offers to reverse only the latest posted run", async () => {
    api.reverseDepreciationRun.mockResolvedValue({ id: "r2", period: "2026-03-01", state: "Reversed", total: 100, assetCount: 1, journalEntryId: "je2", postedAt: "" });
    renderAt("/fixed-assets?tab=depreciation");
    fireEvent.click(await screen.findByRole("button", { name: "Reverse 03/2026" }));
    await waitFor(() => expect(api.reverseDepreciationRun).toHaveBeenCalledWith("c1", "r2", undefined));
    expect(screen.queryByRole("button", { name: "Reverse 02/2026" })).not.toBeInTheDocument();
  });
});

describe("Year-end schedule", () => {
  it("shows the API's category subtotal and grand total, and exports", async () => {
    api.fixedAssetSchedule.mockResolvedValue({
      year: 2026,
      lines: [{ fixedAssetId: "fa1", code: "AS-00001", name: "CNC lathe", categoryName: "Machinery", amounts: AMOUNTS(300) }],
      categories: [{ categoryName: "Machinery", amounts: AMOUNTS(300) }],
      total: AMOUNTS(300),
    });
    api.fixedAssetScheduleExport.mockResolvedValue({ data: new Blob(), status: 200, fileName: "x.xlsx" });
    renderAt("/fixed-assets?tab=schedule&year=2026");
    expect(await screen.findByText("Total Machinery")).toBeInTheDocument();
    expect(api.fixedAssetSchedule).toHaveBeenCalledWith("c1", 2026);
    expect(screen.getAllByText("900.00").length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getAllByRole("button", { name: /Export/ })[0]);
    await waitFor(() => expect(api.fixedAssetScheduleExport).toHaveBeenCalledWith("c1", 2026));
    await waitFor(() => expect(download).toHaveBeenCalled());
  });
});

describe("Asset categories", () => {
  it("adds the standard categories from the chart", async () => {
    api.listAssetCategories.mockResolvedValue([]);
    api.createDefaultAssetCategories.mockResolvedValue([MACHINERY]);
    renderAt("/fixed-assets?tab=categories");
    fireEvent.click(await screen.findByRole("button", { name: "Add standard categories" }));
    await waitFor(() => expect(api.createDefaultAssetCategories).toHaveBeenCalledWith("c1"));
  });
});
