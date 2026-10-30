import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmployeePicker } from "@/components/EmployeePicker";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

const listEmployees = vi.fn();
const getEmployee = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listEmployees: (...args: unknown[]) => listEmployees(...args),
      getEmployee: (...args: unknown[]) => getEmployee(...args),
    },
  };
});

function renderPicker(props: Partial<Parameters<typeof EmployeePicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IntlProviderWrapper>
        <EmployeePicker companyId="c1" aria-label="Employee" value="" onChange={onChange} {...props} />
      </IntlProviderWrapper>
    </QueryClientProvider>,
  );
  return onChange;
}

describe("EmployeePicker", () => {
  beforeEach(() => {
    listEmployees.mockReset().mockImplementation((_c, _p, _s, search?: string) => {
      // A company with 250 employees: the server returns the first 20 matches only.
      const all = Array.from({ length: 250 }, (_, i) => ({ id: `e${i + 1}`, name: `Employee ${i + 1}` }));
      const matches = search ? all.filter((e) => e.name.includes(search)) : all;
      return Promise.resolve({ items: matches.slice(0, 20), total: matches.length, page: 1, pageSize: 20 });
    });
    getEmployee.mockReset();
  });

  it("finds an employee beyond the first page by searching on the server", async () => {
    const onChange = renderPicker();
    const input = screen.getByRole("combobox", { name: "Employee" });
    fireEvent.focus(input);
    expect(await screen.findByText(/Showing 20 of 250/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Employee 201" } });
    const option = await screen.findByRole("option", { name: "Employee 201" });
    expect(listEmployees).toHaveBeenLastCalledWith("c1", 1, 20, "Employee 201", "name", undefined, false, false);

    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("e201", { id: "e201", name: "Employee 201" });
  });

  it("picks with the keyboard and leaves out the excluded employee", async () => {
    const onChange = renderPicker({ excludeId: "e1" });
    const input = screen.getByRole("combobox", { name: "Employee" });
    fireEvent.focus(input);
    await screen.findByRole("option", { name: "Employee 2" });
    expect(screen.queryByRole("option", { name: "Employee 1" })).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("e3", { id: "e3", name: "Employee 3" });
  });

  it("shows the selected employee's name, fetching it when the caller doesn't pass it", async () => {
    getEmployee.mockResolvedValue({ id: "e7", name: "Employee 7" });
    renderPicker({ value: "e7" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Employee" })).toHaveValue("Employee 7"));
    expect(getEmployee).toHaveBeenCalledWith("c1", "e7");
  });

  it("can be cleared when it has an empty label", async () => {
    const onChange = renderPicker({ value: "e7", selectedName: "Employee 7", emptyLabel: "All employees" });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("", undefined);
    expect(getEmployee).not.toHaveBeenCalled();
  });

  it("asks only for employees without a login when told to", async () => {
    renderPicker({ withoutLogin: true });
    fireEvent.focus(screen.getByRole("combobox", { name: "Employee" }));
    await screen.findByRole("option", { name: "Employee 1" });
    expect(listEmployees).toHaveBeenCalledWith("c1", 1, 20, undefined, "name", undefined, false, true);
  });
});
