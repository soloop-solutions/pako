import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EntityHistory } from "@/components/shared/EntityHistory";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import auditDetail from "@/mocks/audit-detail.json";
import auditPagedFixture from "@/mocks/audit-paged.json";
import auditVerifyBroken from "@/mocks/audit-verify-broken.json";
import auditVerifyValid from "@/mocks/audit-verify.json";
import { AuditTrail } from "@/pages/audit/AuditTrail";
import { chooseOption } from "@/test/chooseOption";

const companyId = "11111111-1111-1111-1111-111111111111";
const auditPaged = vi.fn();
const auditDetailMock = vi.fn();
const auditVerify = vi.fn();
const auditExport = vi.fn();
const downloadMock = vi.hoisted(() => vi.fn());
let role = 2;

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      membersAll: async () => [
        { membershipId: "m1", userId: "me", email: "me@co.test", role },
        { membershipId: "m2", userId: "9b8a7c6d-3333-4b2b-9c2b-000000000020", email: "alice@acme.test", role: 3 },
      ],
      auditPaged: (...args: unknown[]) => auditPaged(...args),
      auditDetail: (...args: unknown[]) => auditDetailMock(...args),
      auditVerify: (...args: unknown[]) => auditVerify(...args),
      auditExport: (...args: unknown[]) => auditExport(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: companyId }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ auth: { userId: "me" } }) }));
vi.mock("@/lib/download", () => ({ downloadFileResponse: downloadMock }));

function renderWith(node: React.ReactNode, url = "/audit-trail") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  role = 2;
  auditPaged.mockReset().mockResolvedValue(auditPagedFixture);
  auditDetailMock.mockReset().mockResolvedValue(auditDetail);
  auditVerify.mockReset();
  auditExport.mockReset().mockResolvedValue({ data: new Blob(["x"]), fileName: "audit.xlsx", status: 200 });
  downloadMock.mockReset();
});

describe("AuditTrail", () => {
  it("renders entries from the fixture with a record link", async () => {
    renderWith(<AuditTrail />);
    expect(await screen.findAllByText(/Alice Berisha/)).not.toHaveLength(0);
    expect(screen.getAllByText("203.0.113.7")).toHaveLength(2);
    expect(screen.getAllByText("System")[0]).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Open record" });
    expect(links.some((l) => l.getAttribute("href") === "/partners?open=4c3d2e1f-2222-4b2b-9c2b-000000000010")).toBe(true);
    expect(auditPaged).toHaveBeenCalledWith(companyId, 1, 50, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
  });

  it("passes the chosen filters to the API", async () => {
    renderWith(<AuditTrail />);
    await screen.findAllByText(/Alice Berisha/);
    await chooseOption(screen.getByRole("combobox", { name: "Action" }), "Updated");
    await waitFor(() =>
      expect(auditPaged).toHaveBeenLastCalledWith(companyId, 1, 50, undefined, undefined, undefined, "Updated", undefined, undefined, undefined),
    );
    await chooseOption(screen.getByRole("combobox", { name: "Record type" }), "Partner");
    await chooseOption(screen.getByRole("combobox", { name: "User" }), "alice@acme.test");
    await waitFor(() =>
      expect(auditPaged).toHaveBeenLastCalledWith(
        companyId, 1, 50, "Partner", undefined, "9b8a7c6d-3333-4b2b-9c2b-000000000020", "Updated", undefined, undefined, undefined,
      ),
    );
  });

  it("sends the search text", async () => {
    renderWith(<AuditTrail />);
    await screen.findAllByText(/Alice Berisha/);
    fireEvent.change(screen.getByPlaceholderText("Search entity, field values, IP or user"), { target: { value: "203.0.113" } });
    await waitFor(() =>
      expect(auditPaged).toHaveBeenLastCalledWith(companyId, 1, 50, undefined, undefined, undefined, undefined, undefined, undefined, "203.0.113"),
    );
  });

  it("exports with the active filters", async () => {
    renderWith(<AuditTrail />, "/audit-trail?audit-trail.f.action=Created");
    await screen.findAllByText(/Alice Berisha/);
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalled());
    expect(auditExport).toHaveBeenCalledWith(companyId, undefined, undefined, undefined, "Created", undefined, undefined, undefined);
  });

  it("shows the before/after diff with humanized fields", async () => {
    renderWith(<AuditTrail />);
    await screen.findAllByText(/Alice Berisha/);
    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Tax number")).toBeInTheDocument();
    expect(within(dialog).getByText("Acme Sh.p.k.")).toBeInTheDocument();
    expect(within(dialog).getByText("811234567")).toBeInTheDocument();
    expect(within(dialog).getAllByText("(empty)")).not.toHaveLength(0);
    expect(within(dialog).getByText(auditDetail.prevHash)).toBeInTheDocument();
    expect(within(dialog).getByText(auditDetail.entry.entryHash)).toBeInTheDocument();
    expect(within(dialog).getByText(auditDetail.entry.requestId)).toBeInTheDocument();
    expect(auditDetailMock).toHaveBeenCalledWith(companyId, auditDetail.entry.id);
  });

  it("links the source document when its kind is known", async () => {
    const sourceId = "6f1c2f6e-0000-4000-8000-000000000001";
    auditDetailMock.mockResolvedValueOnce({
      ...auditDetail,
      entry: { ...auditDetail.entry, sourceDocumentId: sourceId, sourceKind: "Invoice" },
    });
    renderWith(<AuditTrail />);
    await screen.findAllByText(/Alice Berisha/);
    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    const dialog = await screen.findByRole("dialog");
    const link = await within(dialog).findByRole("link", { name: /^Open Invoice/ });
    expect(link).toHaveAttribute("href", `/invoicing/${sourceId}`);
  });

  it("reports an intact chain", async () => {
    auditVerify.mockResolvedValue(auditVerifyValid);
    renderWith(<AuditTrail />);
    fireEvent.click(await screen.findByRole("button", { name: "Verify chain" }));
    expect(await screen.findByText("Chain intact")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${auditVerifyValid.checkedCount} entries checked`))).toBeInTheDocument();
  });

  it("reports a broken chain with a translated reason", async () => {
    auditVerify.mockResolvedValue(auditVerifyBroken);
    renderWith(<AuditTrail />);
    fireEvent.click(await screen.findByRole("button", { name: "Verify chain" }));
    expect(await screen.findByText("Chain broken")).toBeInTheDocument();
    expect(screen.getByText(/first break is at sequence 18/)).toBeInTheDocument();
    expect(screen.getByText(/content no longer matches its hash/)).toBeInTheDocument();
  });

  it("shows an error when the list cannot load", async () => {
    auditPaged.mockRejectedValue(new Error("boom"));
    renderWith(<AuditTrail />);
    expect(await screen.findByText(/boom|could not be loaded/i)).toBeInTheDocument();
  });

  it("hides the trail from non-admins and never calls the API", async () => {
    role = 3;
    renderWith(<AuditTrail />);
    expect(await screen.findByText("Only company administrators can view the audit trail.")).toBeInTheDocument();
    expect(auditPaged).not.toHaveBeenCalled();
  });
});

describe("EntityHistory", () => {
  it("loads the history of one record for admins", async () => {
    renderWith(<EntityHistory entityType="Partner" entityId="p-1" />, "/partners");
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    expect(await screen.findAllByText("Alice Berisha")).toHaveLength(2);
    expect(auditPaged).toHaveBeenCalledWith(companyId, 1, 20, "Partner", "p-1", undefined, undefined, undefined, undefined, undefined);
  });

  it("renders nothing for non-admins", async () => {
    role = 3;
    renderWith(<EntityHistory entityType="Partner" entityId="p-1" />, "/partners");
    await waitFor(() => expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument());
    expect(auditPaged).not.toHaveBeenCalled();
  });
});
