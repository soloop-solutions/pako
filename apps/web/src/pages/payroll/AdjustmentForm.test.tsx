import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PayrollAdjustmentKind } from "@/lib/payroll-enums";
import { AdjustmentForm } from "@/pages/payroll/AdjustmentForm";

const employees = [{ id: "e1", name: "Arta Krasniqi" }];

function renderForm(onSubmit = vi.fn()) {
  render(
    <IntlProviderWrapper>
      <AdjustmentForm employees={employees} period="2026-10-01" onSubmit={onSubmit} />
    </IntlProviderWrapper>,
  );
  return onSubmit;
}

/** Open a Select (Radix popover) by its label text and pick an option by visible label. */
async function pickSelect(labelText: string, optionLabel: string) {
  fireEvent.click(screen.getByLabelText(labelText));
  const option = await screen.findByRole("option", { name: optionLabel });
  fireEvent.mouseDown(option);
}

describe("AdjustmentForm", () => {
  it("asks for an amount on a bonus and sends it as typed", async () => {
    const onSubmit = renderForm();
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hours")).not.toBeInTheDocument();

    await pickSelect("Employee", "Arta Krasniqi");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "e1", period: "2026-10-01", kind: PayrollAdjustmentKind.Bonus, amount: 150, hours: undefined }),
    );
  });

  it("switches to hours and multiplier for overtime and sends no amount", async () => {
    const onSubmit = renderForm();
    await pickSelect("Kind", "Overtime");

    expect(screen.getByLabelText("Hours")).toBeInTheDocument();
    expect(screen.getByLabelText("Multiplier")).toHaveAttribute("placeholder", "1.3");
    expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();

    await pickSelect("Employee", "Arta Krasniqi");
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PayrollAdjustmentKind.Overtime, hours: 8, rateMultiplier: undefined, amount: undefined }),
    );
  });

  it("refuses an hour-based item without hours", async () => {
    const onSubmit = renderForm();
    await pickSelect("Kind", "Night work");
    await pickSelect("Employee", "Arta Krasniqi");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/number of hours/)).toBeInTheDocument();
  });
});
