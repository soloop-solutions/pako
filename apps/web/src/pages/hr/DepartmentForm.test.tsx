import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { DepartmentForm } from "@/pages/hr/DepartmentForm";

const SALES_DEPARTMENT = {
  id: "dept-1",
  code: "SAL",
  name: "Sales",
  parentId: undefined,
  managerEmployeeId: undefined,
  managerName: undefined,
  costCenterId: undefined,
  permissions: { sales: 2, purchases: 1, partners: 1, accounting: 1, reports: 1, hr: 0 },
  partnerScope: 0,
  isActive: true,
  employeeCount: 2,
};

function renderForm(onSubmit = vi.fn()) {
  render(
    <MemoryRouter>
    <QueryClientProvider client={new QueryClient()}>
    <IntlProviderWrapper>
      <DepartmentForm
        mode="edit"
        initial={SALES_DEPARTMENT}
        departments={[SALES_DEPARTMENT]}
        companyId="c1"
        costCenters={[]}
        readOnly={false}
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </IntlProviderWrapper>
    </QueryClientProvider>
    </MemoryRouter>,
  );
  return onSubmit;
}

describe("DepartmentForm permission matrix", () => {
  it("points to Users & roles for access and sends the stored permissions back unchanged", () => {
    const onSubmit = renderForm();

    expect(screen.queryByRole("radio", { name: "Accounting: Read" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users & roles" })).toHaveAttribute("href", "/admin/users?tab=roles");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const request = onSubmit.mock.calls[0][0];
    expect(request.partnerScope).toBe(0);
    expect(request.permissions).toEqual({ sales: 2, purchases: 1, partners: 1, accounting: 1, reports: 1, hr: 0 });
  });

  it("excludes the department itself from the parent options", async () => {
    renderForm();
    // Open the parent-department dropdown to inspect available options.
    fireEvent.click(screen.getByLabelText("Parent department"));
    // The only department passed in is SALES_DEPARTMENT (the one being edited),
    // so it must be excluded. No role="option" items should appear.
    const options = screen.queryAllByRole("option");
    expect(options).toHaveLength(0);
  });
});
