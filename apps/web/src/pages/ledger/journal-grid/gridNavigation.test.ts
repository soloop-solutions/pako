import { describe, expect, it } from "vitest";

import { clampCell, moveArrow, nextForEnter, nextForTab, prevForTab } from "@/pages/ledger/journal-grid/gridNavigation";

describe("gridNavigation", () => {
  describe("nextForEnter", () => {
    it("moves down one row in the same column when a row below exists", () => {
      expect(nextForEnter({ row: 0, col: 2 }, 3)).toEqual({ row: 1, col: 2, grow: false });
    });

    it("grows the grid and moves into the new row when on the last row", () => {
      expect(nextForEnter({ row: 2, col: 3 }, 3)).toEqual({ row: 3, col: 3, grow: true });
    });
  });

  describe("nextForTab", () => {
    it("moves right one column within the row", () => {
      expect(nextForTab({ row: 0, col: 0 }, 2)).toEqual({ row: 0, col: 1, grow: false });
    });

    it("wraps to the first column of the next row at the last column", () => {
      expect(nextForTab({ row: 0, col: 5 }, 2)).toEqual({ row: 1, col: 0, grow: false });
    });

    it("wraps and grows the grid when the last column of the last row is reached", () => {
      expect(nextForTab({ row: 1, col: 5 }, 2)).toEqual({ row: 2, col: 0, grow: true });
    });
  });

  describe("prevForTab", () => {
    it("moves left one column", () => {
      expect(prevForTab({ row: 1, col: 3 })).toEqual({ row: 1, col: 2 });
    });

    it("wraps to the last column of the previous row at the first column", () => {
      expect(prevForTab({ row: 1, col: 0 })).toEqual({ row: 0, col: 5 });
    });

    it("clamps at the very first cell", () => {
      expect(prevForTab({ row: 0, col: 0 })).toEqual({ row: 0, col: 0 });
    });
  });

  describe("moveArrow", () => {
    it("moves up and clamps at row 0", () => {
      expect(moveArrow({ row: 0, col: 1 }, "up", 3)).toEqual({ row: 0, col: 1 });
      expect(moveArrow({ row: 2, col: 1 }, "up", 3)).toEqual({ row: 1, col: 1 });
    });

    it("moves down and clamps at the last row without growing", () => {
      expect(moveArrow({ row: 2, col: 1 }, "down", 3)).toEqual({ row: 2, col: 1 });
      expect(moveArrow({ row: 0, col: 1 }, "down", 3)).toEqual({ row: 1, col: 1 });
    });

    it("moves left/right and clamps without wrapping rows", () => {
      expect(moveArrow({ row: 1, col: 0 }, "left", 3)).toEqual({ row: 1, col: 0 });
      expect(moveArrow({ row: 1, col: 5 }, "right", 3)).toEqual({ row: 1, col: 5 });
      expect(moveArrow({ row: 1, col: 2 }, "left", 3)).toEqual({ row: 1, col: 1 });
      expect(moveArrow({ row: 1, col: 2 }, "right", 3)).toEqual({ row: 1, col: 3 });
    });
  });

  describe("clampCell", () => {
    it("clamps row and column into range", () => {
      expect(clampCell({ row: 10, col: 10 }, 3)).toEqual({ row: 2, col: 5 });
      expect(clampCell({ row: -1, col: -1 }, 3)).toEqual({ row: 0, col: 0 });
    });

    it("clamps to row 0 when there are no rows left", () => {
      expect(clampCell({ row: 5, col: 0 }, 0)).toEqual({ row: 0, col: 0 });
    });
  });
});
