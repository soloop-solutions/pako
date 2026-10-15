import { fireEvent, render, screen } from "@testing-library/react";
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
    <IntlProviderWrapper>
      <DepartmentForm
        mode="edit"
        initial={SALES_DEPARTMENT}
        departments={[SALES_DEPARTMENT]}
        employees={[]}
        readOnly={false}
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </IntlProviderWrapper>,
  );
  return onSubmit;
}

describe("DepartmentForm permission matrix", () => {
  it("locks Accounting at None once the partner scope is Assigned only, and submits it as None", () => {
    const onSubmit = renderForm();

    const accountingRead = screen.getByRole("radio", { name: "Accounting: Read" });
    expect(accountingRead).toBeChecked();
    expect(accountingRead).toBeEnabled();

    fireEvent.click(screen.getByRole("radio", { name: "Assigned partners only" }));

    expect(screen.getByRole("radio", { name: "Accounting: None" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Accounting: Read" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Accounting: Write" })).toBeDisabled();
    // Other modules stay editable.
    expect(screen.getByRole("radio", { name: "Sales: Read" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const request = onSubmit.mock.calls[0][0];
    expect(request.partnerScope).toBe(1);
    expect(request.permissions).toEqual({ sales: 2, purchases: 1, partners: 1, accounting: 0, reports: 1, hr: 0 });
  });

  it("excludes the department itself from the parent options", () => {
    renderForm();
    const parent = screen.getByLabelText("Parent department");
    expect(parent.querySelectorAll("option")).toHaveLength(1);
  });
});
