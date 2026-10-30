import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CompanyRoleResponse, InviteUserRequest, SaveCompanyRoleRequest } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { RolesTab } from "@/pages/admin/RolesTab";
import { UsersTab } from "@/pages/admin/UsersTab";
import { AcceptInvitation } from "@/pages/AcceptInvitation";
import { ForgotPassword } from "@/pages/PasswordReset";

const companyId = "11111111-1111-1111-1111-111111111111";
const none = { sales: 0, purchases: 0, partners: 0, accounting: 0, reports: 0, hr: 0, items: 0, payroll: 0, settings: 0, users: 0 };
const roles: CompanyRoleResponse[] = [
  { id: "r-sales", name: "Shitje", description: "Drafts sales invoices", builtInKey: "sales", levels: { ...none, sales: 2, partners: 2, items: 1, reports: 1 }, partnerScope: 0, userCount: 1 },
  { id: "r-emp", name: "Punonjës", description: "Only My HR", builtInKey: "employee", levels: none, partnerScope: 0, userCount: 0 },
];

const inviteMock = vi.fn(async (_c: string, body: InviteUserRequest) => ({
  user: { email: body.email, access: "Role", status: "Invited", isFirmMember: false, isYou: false },
  inviteUrl: "https://app.test/accept-invite?token=abc",
  expiresAt: "2026-11-06T10:00:00Z",
}));
const updateRoleMock = vi.fn(async (_c: string, id: string, body: SaveCompanyRoleRequest) => ({ ...roles[0], id, ...body }));
const acceptMock = vi.fn(async () => undefined);
const forgotMock = vi.fn(async () => undefined);

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listCompanyRoles: async () => roles,
      listCompanyUsers: async () => [
        { membershipId: "m1", userId: "u1", email: "admin@co.test", fullName: "Ada Admin", access: "Administrator", status: "Active", isFirmMember: false, isYou: true },
        { membershipId: "m2", userId: "u2", email: "clerk@co.test", fullName: "Cleo Clerk", access: "Role", roleId: "r-sales", roleName: "Shitje", status: "Active", isFirmMember: false, isYou: false },
      ],
      inviteCompanyUser: (c: string, body: InviteUserRequest) => inviteMock(c, body),
      updateCompanyRole: (c: string, id: string, body: SaveCompanyRoleRequest) => updateRoleMock(c, id, body),
      getInvitation: async () => ({ companyName: "Test Co", email: "new@co.test", fullName: "New Person", accountExists: false, isValid: true }),
      forgotPassword: () => forgotMock(),
      listEmployees: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    },
  };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: null, acceptInvitation: (...args: unknown[]) => acceptMock(...(args as [])) }),
}));

function renderAt(node: React.ReactNode, url = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="*" element={node} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Users tab", () => {
  it("lists users with their access and invites someone with a role, showing the link", async () => {
    renderAt(<UsersTab companyId={companyId} canManage />);
    expect(await screen.findByText("Cleo Clerk")).toBeInTheDocument();
    expect(screen.getByText("Shitje")).toBeInTheDocument();
    // An admin can't deactivate or remove themself.
    expect(screen.getAllByRole("button", { name: "Deactivate" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Invite user" }));
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "new@co.test" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "r-sales" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => expect(inviteMock).toHaveBeenCalled());
    expect(inviteMock.mock.calls[0][1]).toMatchObject({ email: "new@co.test", administrator: false, roleId: "r-sales" });
    expect(await screen.findByDisplayValue("https://app.test/accept-invite?token=abc")).toBeInTheDocument();
  });

  it("is read-only without user management rights", async () => {
    renderAt(<UsersTab companyId={companyId} canManage={false} />);
    expect(await screen.findByText("Cleo Clerk")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite user" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
  });
});

describe("Roles tab", () => {
  it("edits a role's levels and previews the pages it opens", async () => {
    renderAt(<RolesTab companyId={companyId} canManage />);
    fireEvent.click(await screen.findByRole("button", { name: /Shitje/ }));

    expect(screen.getByRole("radio", { name: "Sales: Edit" })).toBeChecked();
    expect(screen.getByText(/Sales invoices · Edit/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Sales: Approve" }));
    fireEvent.click(screen.getByRole("radio", { name: "Payroll: View" }));
    expect(screen.getByText(/Payroll · View/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateRoleMock).toHaveBeenCalled());
    expect(updateRoleMock.mock.calls[0][2].levels).toMatchObject({ sales: 3, payroll: 1, partners: 2 });
  });
});

describe("Account pages", () => {
  it("accepting an invitation for a new account asks for a confirmed password", async () => {
    renderAt(<AcceptInvitation />, "/accept-invite?token=abc");
    expect(await screen.findByText("You've been invited to Test Co as new@co.test.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Str0ng-Pass!" } });
    fireEvent.change(screen.getByLabelText("Repeat the password"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept and sign in" }));
    expect(await screen.findByText("The two passwords are different.")).toBeInTheDocument();
    expect(acceptMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Repeat the password"), { target: { value: "Str0ng-Pass!" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept and sign in" }));
    await waitFor(() => expect(acceptMock).toHaveBeenCalled());
  });

  it("forgot password always confirms without saying whether the account exists", async () => {
    renderAt(<ForgotPassword />, "/forgot-password");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anyone@co.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(/If anyone@co.test has a PAKO account/)).toBeInTheDocument();
  });
});
