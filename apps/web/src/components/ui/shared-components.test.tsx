import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { useConfirm } from "@/components/ui/confirm-context";
import { DatePicker } from "@/components/ui/date-picker";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { dateToIso, formatDisplayDate, isoToDate, parseTypedDate } from "@/lib/dates";

function Harness({ initial = "", min, max, required }: { initial?: string; min?: string; max?: string; required?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <IntlProviderWrapper>
      <DatePicker id="d" value={value} onValueChange={setValue} min={min} max={max} required={required} aria-label="Date" />
      <output data-testid="value">{value}</output>
    </IntlProviderWrapper>
  );
}

describe("date helpers", () => {
  it("round-trips ISO and the Kosovo display format and rejects impossible dates", () => {
    expect(formatDisplayDate("2026-03-05")).toBe("05.03.2026");
    expect(parseTypedDate("05.03.2026")).toBe("2026-03-05");
    expect(parseTypedDate("2026-3-5")).toBe("2026-03-05");
    expect(parseTypedDate("31.02.2026")).toBeNull();
    expect(parseTypedDate("garbage")).toBeNull();
    expect(dateToIso(isoToDate("2026-12-31")!)).toBe("2026-12-31");
  });
});

describe("DatePicker", () => {
  it("shows the value as dd.mm.yyyy and accepts a typed date", () => {
    render(<Harness initial="2026-03-05" />);
    const input = screen.getByLabelText("Date");
    expect(input).toHaveValue("05.03.2026");
    fireEvent.change(input, { target: { value: "17.04.2026" } });
    expect(screen.getByTestId("value")).toHaveTextContent("2026-04-17");
  });

  it("reverts a half-typed or out-of-range date on blur", () => {
    render(<Harness initial="2026-03-05" min="2026-03-01" max="2026-03-31" />);
    const input = screen.getByLabelText("Date");
    fireEvent.change(input, { target: { value: "17.04.2026" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("05.03.2026");
    expect(screen.getByTestId("value")).toHaveTextContent("2026-03-05");
  });

  it("clears with the clear button unless required", () => {
    const { unmount } = render(<Harness initial="2026-03-05" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
    expect(screen.getByTestId("value")).toHaveTextContent("");
    unmount();
    render(<Harness initial="2026-03-05" required />);
    expect(screen.queryByRole("button", { name: "Clear date" })).not.toBeInTheDocument();
  });

  it("picks a day from the calendar", async () => {
    render(<Harness initial="2026-03-05" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    fireEvent.click(await screen.findByRole("button", { name: /March 17th, 2026/ }));
    expect(screen.getByTestId("value")).toHaveTextContent("2026-03-17");
  });
});

function ConfirmHarness({ onConfirm }: { onConfirm: () => void }) {
  const confirm = useConfirm();
  return <button onClick={() => confirm("Delete it?", onConfirm, { destructive: true })}>ask</button>;
}

describe("ConfirmProvider", () => {
  it("asks in a dialog and only runs the action on confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <IntlProviderWrapper>
        <ConfirmProvider>
          <ConfirmHarness onConfirm={onConfirm} />
        </ConfirmProvider>
      </IntlProviderWrapper>,
    );
    fireEvent.click(screen.getByText("ask"));
    expect(await screen.findByText("Delete it?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("ask"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
