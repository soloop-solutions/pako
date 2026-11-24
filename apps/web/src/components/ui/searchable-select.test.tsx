import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchableSelect } from "@/components/ui/searchable-select";

// UI/UX round 2026-11-24: when nothing matches, offer to create the typed name.
describe("SearchableSelect quick create", () => {
  it("offers Create '<typed>' when nothing matches and passes the text on", async () => {
    const onCreate = vi.fn();
    render(
      <SearchableSelect
        id="customer"
        aria-label="Customer"
        value=""
        searchable
        onChange={() => {}}
        options={[{ value: "c1", label: "Market Viva" }]}
        createAction={{ label: "Add customer", onClick: onCreate }}
      />,
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Customer" }), { key: "ArrowDown" });
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Acme Shpk" } });
    fireEvent.click(await screen.findByRole("button", { name: /Add customer: “Acme Shpk”/ }));
    expect(onCreate).toHaveBeenCalledWith("Acme Shpk");
  });
});
