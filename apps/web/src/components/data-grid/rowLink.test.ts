import type { KeyboardEvent, MouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rowLinkProps } from "./rowLink";

function click(init: Partial<MouseEvent<HTMLElement>> = {}) {
  const target = document.createElement("td");
  return { target, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...init } as unknown as MouseEvent<HTMLElement>;
}

describe("rowLinkProps", () => {
  const navigate = vi.fn();
  const open = vi.fn();
  const selection = vi.fn<() => { toString: () => string } | null>();

  beforeEach(() => {
    navigate.mockReset();
    open.mockReset();
    selection.mockReset().mockReturnValue({ toString: () => "" });
    vi.stubGlobal("open", open);
    vi.spyOn(window, "getSelection").mockImplementation(selection as unknown as typeof window.getSelection);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("navigates on a plain click", () => {
    rowLinkProps("/x", navigate).onClick(click());
    expect(navigate).toHaveBeenCalledWith("/x");
  });

  it("does not navigate when text is selected", () => {
    selection.mockReturnValue({ toString: () => "INV-0001" });
    rowLinkProps("/x", navigate).onClick(click());
    expect(navigate).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("navigates when there is no selection object at all", () => {
    selection.mockReturnValue(null);
    rowLinkProps("/x", navigate).onClick(click());
    expect(navigate).toHaveBeenCalledWith("/x");
  });

  it("opens a new tab on ctrl, meta or shift click, never the same tab", () => {
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      rowLinkProps("/x", navigate).onClick(click(init));
    }
    expect(open).toHaveBeenCalledTimes(3);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("Enter on the row still navigates regardless of a selection", () => {
    selection.mockReturnValue({ toString: () => "text" });
    const row = document.createElement("tr");
    rowLinkProps("/x", navigate).onKeyDown({ key: "Enter", target: row, currentTarget: row, ctrlKey: false, metaKey: false, preventDefault: () => {} } as unknown as KeyboardEvent<HTMLElement>);
    expect(navigate).toHaveBeenCalledWith("/x");
  });
});
