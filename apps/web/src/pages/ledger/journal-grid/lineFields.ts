// F9 — per-column read/write for a GridLine. `commitCellValue` is the single place that turns a
// cell's free-typed text into the line's actual field(s); it is used identically by the
// Enter/Tab/arrow commit path and by paste-fill, so the two can never resolve a cell differently.

import { optionLabel, resolvePickerCommit, type PickerOption } from "@/pages/ledger/journal-grid/pickerMatch";
import type { GridColumn, GridLine } from "@/pages/ledger/journal-grid/types";

export function getCellText(line: GridLine, column: GridColumn): string {
  switch (column) {
    case "description":
      return line.description;
    case "debit":
      return line.debit;
    case "credit":
      return line.credit;
    case "account":
      return line.accountLabel;
    case "partner":
      return line.partnerLabel;
    case "project":
      return line.projectLabel;
    case "employee":
      return line.employeeLabel;
    case "costCenter":
      // F12: the distribution cell is a button that opens DistributionEditor, not a free-text
      // picker — there is no single string to type/commit into it, so it has no draft text.
      return "";
  }
}

// Accepts a comma decimal separator (accountants read server error messages formatted that way —
// see root CLAUDE.md's ledger notes) in addition to a dot. An unparsable, non-blank value is
// discarded in favor of whatever was already committed, rather than corrupting the line — the same
// "don't let a stray keystroke erase a good value" discipline resolvePickerCommit uses.
export function sanitizeAmount(raw: string, previous: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const normalized = trimmed.replace(",", ".");
  const parsed = parseFloat(normalized);
  if (!Number.isFinite(parsed)) return previous;
  // Reject negative amounts — corrections use the appropriate side (debit/credit), not signed values.
  if (parsed < 0) return previous;
  return normalized;
}

export function commitCellValue(
  line: GridLine,
  column: GridColumn,
  raw: string,
  options: { account: PickerOption[]; partner: PickerOption[]; project: PickerOption[]; employee: PickerOption[] },
): GridLine {
  switch (column) {
    case "description":
      return { ...line, description: raw };
    case "debit":
      return { ...line, debit: sanitizeAmount(raw, line.debit) };
    case "credit":
      return { ...line, credit: sanitizeAmount(raw, line.credit) };
    case "account": {
      const previous = line.accountId ? { id: line.accountId, label: line.accountLabel } : null;
      const resolved = resolvePickerCommit(raw, options.account, previous);
      return resolved ? { ...line, accountId: resolved.id, accountLabel: resolved.label } : { ...line, accountId: "", accountLabel: "" };
    }
    case "partner": {
      const previous = line.partnerId ? { id: line.partnerId, label: line.partnerLabel } : null;
      const resolved = resolvePickerCommit(raw, options.partner, previous);
      return resolved ? { ...line, partnerId: resolved.id, partnerLabel: resolved.label } : { ...line, partnerId: "", partnerLabel: "" };
    }
    case "project": {
      const previous = line.projectId ? { id: line.projectId, label: line.projectLabel } : null;
      const resolved = resolvePickerCommit(raw, options.project, previous);
      return resolved ? { ...line, projectId: resolved.id, projectLabel: resolved.label } : { ...line, projectId: "", projectLabel: "" };
    }
    case "employee": {
      const previous = line.employeeId ? { id: line.employeeId, label: line.employeeLabel } : null;
      const resolved = resolvePickerCommit(raw, options.employee, previous);
      return resolved ? { ...line, employeeId: resolved.id, employeeLabel: resolved.label } : { ...line, employeeId: "", employeeLabel: "" };
    }
    case "costCenter":
      // F12: no free-text commit for the distribution cell — edits go through
      // DistributionEditor's own onChange, wired directly in JournalEntryGrid.tsx. Committing
      // whatever's in `draft` (always "", see getCellText above) when Tab/Enter moves off this
      // cell is therefore a deliberate no-op, not a missing case.
      return line;
  }
}

export { optionLabel };
