import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiException } from "@pako/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Leave } from "@/pages/leave/Leave";
import { leaveRequestActions, remainingTone } from "@/pages/leave/leaveShared";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";

const listLeaveRequests = vi.fn();
const listLeaveTypes = vi.fn();
const listEmployees = vi.fn();
const listLeaveBalances = vi.fn();
const approveLeaveRequest = vi.fn();
const createLeaveRequest = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listLeaveRequests: (...args: unknown[]) => listLeaveRequests(...args),
      listLeaveTypes: (...args: unknown[]) => listLeaveTypes(...args),
      listEmployees: (...args: unknown[]) => listEmployees(...args),
      listLeaveBalances: (...args: unknown[]) => listLeaveBalances(...args),
      approveLeaveRequest: (...args: unknown[]) => approveLeaveRequest(...args),
      createLeaveRequest: (...args: unknown[]) => createLeaveRequest(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: COMPANY_ID }),
}));

function request(id: string, employeeName: string, state: string) {
  return {
    id,
    employeeId: `emp-${id}`,
    employeeName,
    leaveTypeId: "type-annual",
    leaveTypeName: "Annual leave",
    startDate: "2026-10-19",
    endDate: "2026-10-23",
    days: 5,
    reason: undefined,
    state,
    decidedAt: state === "Pending" ? undefined : "2026-10-10T09:00:00Z",
    createdAt: "2026-10-01T09:00:00Z",
  };
}

function renderLeave(initialEntry = "/leave") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Leave />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`row for ${text} not found`);
  return row;
}

describe("leaveRequestActions", () => {
  it("offers approve/reject only while pending and cancel while pending or approved", () => {
    expect(leaveRequestActions("Pending")).toEqual({ approve: true, reject: true, cancel: true });
    expect(leaveRequestActions("Approved")).toEqual({ approve: false, reject: false, cancel: true });
    expect(leaveRequestActions("Rejected")).toEqual({ approve: false, reject: false, cancel: false });
    expect(leaveRequestActions("Cancelled")).toEqual({ approve: false, reject: false, cancel: false });
  });

  it("flags negative and low remaining balances", () => {
    expect(remainingTone({ remaining: -1, allocated: 20 })).toBe("negative");
    expect(remainingTone({ remaining: 2, allocated: 20 })).toBe("low");
    expect(remainingTone({ remaining: 12, allocated: 20 })).toBeNull();
  });
});

describe("Leave — requests tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLeaveTypes.mockResolvedValue([
      { id: "type-annual", code: "ANNUAL", name: "Annual leave", defaultAnnualDays: 20, payPercent: 100, isActive: true },
    ]);
    listEmployees.mockResolvedValue({ items: [{ id: "emp-1", name: "Arta Krasniqi" }], total: 1, page: 1, pageSize: 200 });
  });

  it("defaults to the Pending filter", async () => {
    listLeaveRequests.mockResolvedValue({ items: [request("1", "Arta Krasniqi", "Pending")], total: 1, page: 1, pageSize: 50 });
    renderLeave();

    await waitFor(() => expect(screen.getByText("Arta Krasniqi", { selector: "td, td *" })).toBeInTheDocument());
    expect(listLeaveRequests).toHaveBeenCalledWith(COMPANY_ID, 1, 50, "Pending", undefined, undefined, undefined);
  });

  it("shows row actions by state and strikes cancelled requests through", async () => {
    listLeaveRequests.mockResolvedValue({
      items: [
        request("1", "Pending Person", "Pending"),
        request("2", "Approved Person", "Approved"),
        request("3", "Cancelled Person", "Cancelled"),
      ],
      total: 3,
      page: 1,
      pageSize: 50,
    });
    renderLeave("/leave?state=all");

    await waitFor(() => expect(screen.getByText("Pending Person")).toBeInTheDocument());
    expect(listLeaveRequests).toHaveBeenCalledWith(COMPANY_ID, 1, 50, undefined, undefined, undefined, undefined);

    const pending = within(rowOf("Pending Person"));
    expect(pending.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(pending.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(pending.getByRole("button", { name: "Cancel leave" })).toBeInTheDocument();

    const approved = within(rowOf("Approved Person"));
    expect(approved.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(approved.getByRole("button", { name: "Cancel leave" })).toBeInTheDocument();

    const cancelledRow = rowOf("Cancelled Person");
    expect(within(cancelledRow).queryByRole("button")).not.toBeInTheDocument();
    expect(cancelledRow.className).toContain("line-through");
  });

  it("approves a pending request", async () => {
    listLeaveRequests.mockResolvedValue({ items: [request("1", "Pending Person", "Pending")], total: 1, page: 1, pageSize: 50 });
    approveLeaveRequest.mockResolvedValue(request("1", "Pending Person", "Approved"));
    renderLeave();

    await waitFor(() => expect(screen.getByText("Pending Person")).toBeInTheDocument());
    fireEvent.click(within(rowOf("Pending Person")).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveLeaveRequest).toHaveBeenCalledWith(COMPANY_ID, "1"));
  });

  it("shows the server's refusal when a new request exceeds the balance", async () => {
    listLeaveRequests.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const refusal = "Request is 5 working days but only 3 remain.";
    createLeaveRequest.mockRejectedValue(new ApiException("Bad Request", 400, JSON.stringify(refusal), {}, null));
    renderLeave();

    fireEvent.click(await screen.findByRole("button", { name: "New leave request" }));
    // Open the Employee popover-select and pick "Arta Krasniqi"
    fireEvent.click(screen.getByLabelText("Employee", { selector: "#leave-new-employee" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Arta Krasniqi" }));
    // Open the Leave type popover-select and pick "ANNUAL — Annual leave"
    fireEvent.click(screen.getByLabelText("Leave type", { selector: "#leave-new-type" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Annual leave/ }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-19" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-23" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(createLeaveRequest).toHaveBeenCalledWith(COMPANY_ID, {
      employeeId: "emp-1",
      leaveTypeId: "type-annual",
      startDate: "2026-10-19",
      endDate: "2026-10-23",
      reason: undefined,
    });
  });
});

describe("Leave — balances tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLeaveTypes.mockResolvedValue([]);
    listEmployees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
  });

  it("loads the year from the URL and flags a negative remaining balance", async () => {
    listLeaveBalances.mockResolvedValue([
      {
        employeeId: "emp-1",
        employeeName: "Arta Krasniqi",
        leaveTypeId: "type-annual",
        leaveTypeName: "Annual leave",
        year: 2025,
        allocated: 20,
        taken: 18,
        pending: 4,
        remaining: -2,
      },
    ]);
    renderLeave("/leave?tab=balances&year=2025");

    const remaining = await screen.findByText("-2");
    expect(listLeaveBalances).toHaveBeenCalledWith(COMPANY_ID, 2025, undefined);
    expect(remaining.className).toContain("text-destructive");
  });
});
