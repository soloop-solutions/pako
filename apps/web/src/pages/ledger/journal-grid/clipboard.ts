// F9 — parses a block of clipboard text (tab-separated columns, newline-separated rows, the shape
// every spreadsheet puts on the clipboard on copy) into a 2D string array. Pure/no DOM so the
// parsing itself is unit-testable independent of a real ClipboardEvent.

export function parseClipboardBlock(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = normalized.split("\n");
  // A copy from a spreadsheet ends in a trailing newline — drop the resulting empty trailing row
  // so it doesn't paste as one extra blank line, but keep a genuinely blank pasted row in the middle.
  while (rows.length > 1 && rows[rows.length - 1] === "") {
    rows.pop();
  }
  return rows.map((row) => row.split("\t"));
}

export function isMultiCellBlock(block: string[][]): boolean {
  return block.length > 1 || (block[0]?.length ?? 0) > 1;
}
