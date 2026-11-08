import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Select } from "@/components/ui/select";

const options = [
  { value: "d3b07384-d9a0-4c9b-8a3e-1f2b4c5d6e7f", label: "MAIN · Main" },
  { value: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", label: "PZ · Prizren" },
];

describe("Select search", () => {
  it("matches the label, never the id behind an option", () => {
    render(<Select value="" onValueChange={() => {}} options={options} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "d3b" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "priz" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
