import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useOpenParam } from "./useOpenParam";

function Harness() {
  const [, setOpen] = useOpenParam("open");
  const [, setEntry] = useOpenParam("entry");
  return (
    <>
      <button onClick={() => { setOpen("a"); setEntry("b"); }}>both</button>
      <button onClick={() => { setOpen("a"); setOpen(null); setEntry("b"); }}>chain</button>
      <span data-testid="search">{useLocation().search}</span>
    </>
  );
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Harness />
    </MemoryRouter>,
  );
}

describe("useOpenParam", () => {
  it("two setters in one tick both land and keep other params", () => {
    renderAt("/x?tab=pnl");
    fireEvent.click(screen.getByText("both"));
    const params = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
    expect(params.get("tab")).toBe("pnl");
    expect(params.get("open")).toBe("a");
    expect(params.get("entry")).toBe("b");
  });

  it("applies setters in order", () => {
    renderAt("/x?open=z");
    fireEvent.click(screen.getByText("chain"));
    const params = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
    expect(params.get("open")).toBeNull();
    expect(params.get("entry")).toBe("b");
  });
});
