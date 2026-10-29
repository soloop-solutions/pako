import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PayrollRunActions } from "@/pages/payroll/PayrollRunActions";

function renderActions(state: string, onAction = vi.fn()) {
  render(
    <IntlProviderWrapper>
      <PayrollRunActions state={state} busyAction={null} onAction={onAction} />
    </IntlProviderWrapper>,
  );
  return onAction;
}

function buttonNames(): string[] {
  return screen.queryAllByRole("button").map((b) => b.textContent ?? "");
}

describe("PayrollRunActions", () => {
  it("offers recompute, approve, post and delete on a draft run", () => {
    renderActions("Draft");
    expect(buttonNames()).toEqual(["Recompute", "Approve", "Post", "Delete"]);
  });

  it("offers return to draft and post on an approved run", () => {
    renderActions("Approved");
    expect(buttonNames()).toEqual(["Return to draft", "Post"]);
  });

  it("offers only pay on a posted run and reports the action", () => {
    const onAction = renderActions("Posted");
    expect(buttonNames()).toEqual(["Pay"]);
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(onAction).toHaveBeenCalledWith("pay");
  });

  it("offers nothing on a paid run", () => {
    renderActions("Paid");
    expect(buttonNames()).toEqual([]);
  });
});
