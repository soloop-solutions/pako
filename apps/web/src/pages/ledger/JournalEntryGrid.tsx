import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, JournalResponse, PartnerResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { fetchCostCenters, type CostCenterOption } from "@/api/cost-centers-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { setCostCentersMockActive, setLineDistribution } from "@/mocks/costCentersMockFlag";
import { ensureAccountsMockWorkerStarted } from "@/mocks/mockInit";
import { autoBalanceLastLine, computeTotals, toCents } from "@/pages/ledger/journal-grid/balance";
import { isMultiCellBlock, parseClipboardBlock } from "@/pages/ledger/journal-grid/clipboard";
import { DistributionEditor } from "@/pages/ledger/journal-grid/DistributionEditor";
import { isDistributionComplete } from "@/pages/ledger/journal-grid/distribution";
import { clampCell, moveArrow, nextForEnter, nextForTab, prevForTab } from "@/pages/ledger/journal-grid/gridNavigation";
import { commitCellValue, getCellText } from "@/pages/ledger/journal-grid/lineFields";
import { PickerCell } from "@/pages/ledger/journal-grid/PickerCell";
import { optionLabel, type PickerOption } from "@/pages/ledger/journal-grid/pickerMatch";
import { emptyLine, GRID_COLUMNS, type CellPosition, type GridColumn, type GridLine } from "@/pages/ledger/journal-grid/types";

type JournalEntryGridProps = {
  companyId: string;
  journals: JournalResponse[];
  accounts: AccountResponse[];
  onCreated: () => void;
};

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

function formatCents(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function JournalEntryGrid({ companyId, journals, accounts, onCreated }: JournalEntryGridProps) {
  const intl = useIntl();
  const [journalId, setJournalId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const idCounter = useRef(0);
  function nextId(): string {
    idCounter.current += 1;
    return `journal-grid-line-${idCounter.current}`;
  }

  const allocIdCounter = useRef(0);
  function nextAllocId(): string {
    allocIdCounter.current += 1;
    return `journal-grid-alloc-${allocIdCounter.current}`;
  }

  const [lines, setLines] = useState<GridLine[]>(() => [emptyLine("journal-grid-line-seed-1"), emptyLine("journal-grid-line-seed-2")]);
  const [focus, setFocus] = useState<CellPosition>({ row: 0, col: 0 });
  const [draft, setDraft] = useState("");
  // F12 — which line's analytic-distribution popover is open, if any. Deliberately independent of
  // `focus`: interacting with the popover's own selects/inputs never touches grid `focus` state
  // (see DistributionEditor.tsx's header), so this only needs to close itself when the grid's
  // logical focus moves to a DIFFERENT cell (see the [focus]-keyed effect below).
  const [openDistributionRow, setOpenDistributionRow] = useState<number | null>(null);

  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLButtonElement>>(new Map());

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);

  // F9's cost-center picker is entirely mocked (see src/mocks/costCentersMockFlag.ts) — this
  // screen owns the mock's activation lifecycle the same synchronous mount/unmount way F2/F3/F5/F6
  // do (see accountsMockFlag.ts's header for the race this closes).
  const [mockReady, setMockReady] = useState(false);
  useEffect(() => {
    setCostCentersMockActive(true);
    let cancelled = false;
    void ensureAccountsMockWorkerStarted().then(() => {
      if (!cancelled) setMockReady(true);
    });
    return () => {
      cancelled = true;
      setCostCentersMockActive(false);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .partnersAll(companyId)
      .then((result) => {
        if (!cancelled) setPartners(result);
      })
      .catch(() => {
        // Partner is an optional line field — a failed fetch just leaves the picker empty rather
        // than blocking the whole grid.
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!mockReady) return;
    let cancelled = false;
    fetchCostCenters(companyId)
      .then((result) => {
        if (!cancelled) setCostCenters(result);
      })
      .catch(() => {
        // Same reasoning as partners above — this can also legitimately 404/refuse mid-flight if
        // the screen unmounts and the cost-center mock deactivates before the request resolves.
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, mockReady]);

  const accountOptions = useMemo<PickerOption[]>(() => accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })), [accounts]);
  const partnerOptions = useMemo<PickerOption[]>(() => partners.map((p) => ({ id: p.id, name: p.name })), [partners]);
  const costCenterOptions = useMemo<PickerOption[]>(
    () => costCenters.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    [costCenters],
  );
  const optionsByColumn = useMemo(() => ({ account: accountOptions, partner: partnerOptions }), [accountOptions, partnerOptions]);

  const effectiveJournalId = journalId || journals.find((j) => j.code === "GEN")?.id || journals[0]?.id || "";

  // Totals/diff must reflect exactly what Save would submit, not every typed cell — a line with an
  // amount but no account selected is excluded from the real create request (see handleSave's
  // validLines below), so it must be excluded here too, or the footer can show "Balanced" for a set
  // of lines that isn't actually what gets posted.
  const totals = useMemo(() => computeTotals(lines.filter((line) => line.accountId)), [lines]);

  // Re-seed the draft (and move real DOM focus) only when the focused CELL changes — deliberately
  // not on every `lines` mutation, so an unrelated update elsewhere (auto-balance touching the
  // last line, a paste landing on other cells) never clobbers whatever the user is mid-typing in
  // the cell they're actually on. See the report for why this is a deliberate omission.
  useEffect(() => {
    const line = lines[focus.row];
    const column = GRID_COLUMNS[focus.col];
    if (line) setDraft(getCellText(line, column));
    const node = inputRefs.current.get(cellKey(focus.row, focus.col));
    node?.focus();
    if (node && "select" in node) node.select();
    // Close a distribution popover left open on some other cell — see openDistributionRow's own
    // comment above for why interacting with the popover itself never re-triggers this.
    const costCenterColIndex = GRID_COLUMNS.indexOf("costCenter");
    setOpenDistributionRow((current) => (current !== null && !(focus.row === current && focus.col === costCenterColIndex) ? null : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  function commitDraftAt(row: number, col: number, text: string, currentLines: GridLine[]): GridLine[] {
    const column = GRID_COLUMNS[col];
    const updated = commitCellValue(currentLines[row], column, text, optionsByColumn);
    return currentLines.map((line, index) => (index === row ? updated : line));
  }

  function commitAndMove(row: number, col: number, target: { row: number; col: number; grow: boolean }) {
    setLines((prev) => {
      let next = commitDraftAt(row, col, draft, prev);
      if (target.grow) {
        const previousDescription = next[next.length - 1]?.description ?? "";
        // Description autofill decision (F9's open question) — a new line defaults to the
        // PREVIOUS line's description. See this file's bottom comment / the task report for the
        // reasoning (manual entries very often repeat one narrative across every line).
        next = [...next, emptyLine(nextId(), previousDescription)];
      }
      return next;
    });
    setFocus({ row: target.row, col: target.col });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLButtonElement>, row: number, col: number) {
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        commitAndMove(row, col, nextForEnter({ row, col }, lines.length));
        break;
      }
      case "Tab": {
        event.preventDefault();
        if (event.shiftKey) {
          commitAndMove(row, col, { ...prevForTab({ row, col }), grow: false });
        } else {
          commitAndMove(row, col, nextForTab({ row, col }, lines.length));
        }
        break;
      }
      case "Escape": {
        event.preventDefault();
        setDraft(getCellText(lines[row], GRID_COLUMNS[col]));
        break;
      }
      case "ArrowUp":
        event.preventDefault();
        commitAndMove(row, col, { ...moveArrow({ row, col }, "up", lines.length), grow: false });
        break;
      case "ArrowDown":
        event.preventDefault();
        commitAndMove(row, col, { ...moveArrow({ row, col }, "down", lines.length), grow: false });
        break;
      case "ArrowLeft":
        event.preventDefault();
        commitAndMove(row, col, { ...moveArrow({ row, col }, "left", lines.length), grow: false });
        break;
      case "ArrowRight":
        event.preventDefault();
        commitAndMove(row, col, { ...moveArrow({ row, col }, "right", lines.length), grow: false });
        break;
      default:
        break;
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>, row: number, col: number) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    const block = parseClipboardBlock(text);
    if (!isMultiCellBlock(block)) return; // single cell: let the browser's normal paste-into-input happen
    event.preventDefault();

    setLines((prev) => {
      const next = [...prev];
      const neededRows = row + block.length;
      while (next.length < neededRows) {
        next.push(emptyLine(nextId(), next[next.length - 1]?.description ?? ""));
      }
      block.forEach((rowValues, rowOffset) => {
        const targetRow = row + rowOffset;
        let line = next[targetRow];
        rowValues.forEach((cellValue, colOffset) => {
          const targetCol = col + colOffset;
          if (targetCol >= GRID_COLUMNS.length) return; // clip columns past the last one, no column growth
          line = commitCellValue(line, GRID_COLUMNS[targetCol], cellValue, optionsByColumn);
        });
        next[targetRow] = line;
      });
      // Keep the anchor cell (where the paste started) focused, same as a spreadsheet — but its
      // displayed text needs a manual refresh since the [focus]-effect only fires on focus change.
      setDraft(getCellText(next[row], GRID_COLUMNS[col]));
      return next;
    });
  }

  function handleAutoBalance() {
    setLines((prev) => autoBalanceLastLine(prev));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(nextId(), prev[prev.length - 1]?.description ?? "")]);
  }

  function removeLine(index: number) {
    setOpenDistributionRow(null);
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setFocus((current) => clampCell(current, next.length));
      return next;
    });
  }

  async function handleSave() {
    setError(null);

    // Whatever is currently mid-typed in the focused cell has not been committed yet (no
    // Enter/Tab/blur has fired) — capture it directly from render-time state rather than relying
    // on the Save button's click to have already triggered the input's onBlur, since blur/click
    // event ordering vs. React's own batching is not something to depend on for correctness here.
    const focusedLine = lines[focus.row];
    const finalLines = focusedLine ? commitDraftAt(focus.row, focus.col, draft, lines) : lines;
    setLines(finalLines);

    // A line with a nonzero debit/credit but no account selected (easy to produce from a fast
    // paste that fills the amount columns without filling the account column) would otherwise be
    // silently dropped by the validLines filter below — counted toward nothing, submitted to
    // nobody. Block it explicitly, with the exact line, rather than letting it vanish into an
    // "unbalanced" surprise from the server after a draft has already been created.
    const orphanAmountIndex = finalLines.findIndex(
      (line) => !line.accountId && (toCents(line.debit) !== 0 || toCents(line.credit) !== 0),
    );
    if (orphanAmountIndex !== -1) {
      setError(intl.formatMessage({ id: "journalGrid.lineHasAmountWithoutAccount" }, { line: orphanAmountIndex + 1 }));
      return;
    }

    // F12: a line's analytic distribution must be either empty (unassigned, valid) or sum to
    // exactly 100% across its allocations — same "name the exact line" discipline as the
    // orphan-amount check above, and the same numbering (1-based over the full grid, not the
    // filtered set Save actually submits).
    const invalidDistributionIndex = finalLines.findIndex(
      (line) => line.accountId && !isDistributionComplete(line.costCenterAllocations),
    );
    if (invalidDistributionIndex !== -1) {
      setError(intl.formatMessage({ id: "journalGrid.lineDistributionNotComplete" }, { line: invalidDistributionIndex + 1 }));
      return;
    }

    const validLines = finalLines.filter((line) => line.accountId);
    if (validLines.length < 2) {
      setError(intl.formatMessage({ id: "journalGrid.atLeastTwoLines" }));
      return;
    }
    if (!effectiveJournalId) {
      setError(intl.formatMessage({ id: "journalGrid.noJournal" }));
      return;
    }
    // Same reasoning as the live footer totals above — validate exactly the line set Save is
    // about to submit, not every line currently in the grid.
    const finalTotals = computeTotals(validLines);
    if (finalTotals.diffCents !== 0) {
      setError(intl.formatMessage({ id: "journalGrid.unbalancedError" }, { amount: formatCents(finalTotals.diffCents) }));
      return;
    }

    setSubmitting(true);
    try {
      const draftEntry = await apiClient.journalEntries(companyId, {
        journalId: effectiveJournalId,
        date,
        reference: reference || undefined,
        lines: validLines.map((line) => ({
          accountId: line.accountId,
          partnerId: line.partnerId || undefined,
          debit: parseFloat(line.debit) || 0,
          credit: parseFloat(line.credit) || 0,
          description: line.description || undefined,
        })),
      });

      // Stash the mocked distribution against the newly created lines' real ids — request and
      // response lines are in the same order (see src/mocks/costCentersMockFlag.ts).
      validLines.forEach((line, index) => {
        const createdLine = draftEntry.lines[index];
        if (createdLine && line.costCenterAllocations.length > 0) {
          setLineDistribution(
            createdLine.id,
            line.costCenterAllocations.map((allocation) => ({
              costCenterId: allocation.costCenterId,
              percentage: parseFloat(allocation.percentage) || 0,
            })),
          );
        }
      });

      try {
        await apiClient.post3(companyId, draftEntry.id);
      } catch (postErr) {
        setError(getApiErrorMessage(postErr, intl.formatMessage({ id: "journalGrid.postError" })));
        onCreated();
        return;
      }

      setLines([emptyLine(nextId()), emptyLine(nextId())]);
      setFocus({ row: 0, col: 0 });
      setOpenDistributionRow(null);
      setReference("");
      onCreated();
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "journalGrid.saveError" })));
    } finally {
      setSubmitting(false);
    }
  }

  const isUnbalanced = totals.diffCents !== 0;
  const canSave = !isUnbalanced && !submitting;

  const columnHeaderKeys: Record<GridColumn, string> = {
    account: "journalGrid.colAccount",
    description: "journalGrid.colDescription",
    debit: "journalGrid.colDebit",
    credit: "journalGrid.colCredit",
    partner: "journalGrid.colPartner",
    costCenter: "journalGrid.colDistributionMocked",
  };

  function renderCell(line: GridLine, row: number, col: number) {
    const column = GRID_COLUMNS[col];
    const isFocused = focus.row === row && focus.col === col;
    const displayValue = isFocused ? draft : getCellText(line, column);
    const registerRef = (node: HTMLInputElement | HTMLButtonElement | null) => {
      const key = cellKey(row, col);
      if (node) inputRefs.current.set(key, node);
      else inputRefs.current.delete(key);
    };

    if (column === "costCenter") {
      const allocations = line.costCenterAllocations;
      const complete = isDistributionComplete(allocations);
      const summary =
        allocations.length === 0
          ? intl.formatMessage({ id: "journalGrid.distributionUnassigned" })
          : allocations.map((allocation) => `${allocation.percentage || 0}% ${allocation.costCenterLabel || "?"}`).join(", ");
      return (
        <div className="relative">
          <button
            ref={registerRef}
            type="button"
            aria-label={intl.formatMessage({ id: columnHeaderKeys[column] })}
            onFocus={() => setFocus({ row, col })}
            onKeyDown={(event) => handleKeyDown(event, row, col)}
            onClick={() => setOpenDistributionRow((current) => (current === row ? null : row))}
            className={cn(
              "h-[26px] w-full truncate rounded border border-input bg-transparent px-1.5 text-left text-[13px] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]",
              !complete && "border-destructive text-destructive",
            )}
          >
            {summary}
          </button>
          {openDistributionRow === row && (
            <DistributionEditor
              allocations={allocations}
              options={costCenterOptions}
              onAddId={nextAllocId}
              onChange={(next) => setLines((prev) => prev.map((l, i) => (i === row ? { ...l, costCenterAllocations: next } : l)))}
              onClose={() => setOpenDistributionRow(null)}
            />
          )}
        </div>
      );
    }

    if (column === "account" || column === "partner") {
      const options = column === "account" ? accountOptions : partnerOptions;
      const placeholderKey = column === "account" ? "journalGrid.accountPlaceholder" : "journalGrid.partnerPlaceholder";
      return (
        <PickerCell
          value={displayValue}
          options={options}
          open={isFocused}
          ariaLabel={intl.formatMessage({ id: columnHeaderKeys[column] })}
          placeholder={intl.formatMessage({ id: placeholderKey })}
          noMatchesText={intl.formatMessage({ id: "journalGrid.noMatches" })}
          inputRef={registerRef}
          onChange={setDraft}
          onFocus={() => setFocus({ row, col })}
          onKeyDown={(event) => handleKeyDown(event, row, col)}
          onPaste={(event) => handlePaste(event, row, col)}
          onSelect={(option) => {
            const raw = option.code ?? option.name;
            setLines((prev) => prev.map((l, i) => (i === row ? commitCellValue(l, column, raw, optionsByColumn) : l)));
            setDraft(optionLabel(option));
          }}
        />
      );
    }

    return (
      <input
        ref={registerRef}
        type="text"
        inputMode={column === "debit" || column === "credit" ? "decimal" : undefined}
        aria-label={intl.formatMessage({ id: columnHeaderKeys[column] })}
        value={displayValue}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setFocus({ row, col })}
        onKeyDown={(event) => handleKeyDown(event, row, col)}
        onPaste={(event) => handlePaste(event, row, col)}
        className={cn(
          "h-[26px] w-full min-w-0 rounded border border-input bg-transparent px-1.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]",
          (column === "debit" || column === "credit") && "text-right tabular-nums",
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "journalGrid.description" })}</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="journal-grid-journal">{intl.formatMessage({ id: "journalGrid.journal" })}</Label>
          <Select id="journal-grid-journal" value={effectiveJournalId} onChange={(event) => setJournalId(event.target.value)}>
            {journals.map((journal) => (
              <option key={journal.id} value={journal.id}>
                {journal.name} ({journal.code})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="journal-grid-date">{intl.formatMessage({ id: "journalGrid.date" })}</Label>
          <Input id="journal-grid-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="journal-grid-reference">{intl.formatMessage({ id: "journalGrid.reference" })}</Label>
          <Input id="journal-grid-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table className="text-[13px] [font-variant-numeric:tabular-nums]">
          <TableHeader>
            <TableRow className="h-[30px] hover:bg-transparent">
              {GRID_COLUMNS.map((column) => (
                <TableHead
                  key={column}
                  className={cn("h-[30px] py-1", (column === "debit" || column === "credit") && "text-right")}
                >
                  {intl.formatMessage({ id: columnHeaderKeys[column] })}
                </TableHead>
              ))}
              <TableHead className="h-[30px] w-9 py-1" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, row) => (
              <TableRow key={line.id} className="h-[30px]">
                {GRID_COLUMNS.map((column, col) => (
                  <TableCell key={column} className="h-[30px] py-1">
                    {renderCell(line, row, col)}
                  </TableCell>
                ))}
                <TableCell className="h-[30px] py-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(row)} disabled={lines.length <= 2}>
                    {intl.formatMessage({ id: "journalGrid.removeLine" })}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <tfoot>
            <tr className="h-[30px] border-t bg-muted/30 font-medium">
              <td className="h-[30px] px-2 py-1" colSpan={2}>
                {intl.formatMessage({ id: "journalGrid.totalDebit" })} / {intl.formatMessage({ id: "journalGrid.totalCredit" })}
              </td>
              <td className="h-[30px] px-2 py-1 text-right tabular-nums">{totals.debit.toFixed(2)}</td>
              <td className="h-[30px] px-2 py-1 text-right tabular-nums">{totals.credit.toFixed(2)}</td>
              <td className={cn("h-[30px] px-2 py-1", isUnbalanced ? "text-destructive" : "text-muted-foreground")} colSpan={3}>
                {isUnbalanced
                  ? `${intl.formatMessage({ id: "journalGrid.difference" })}: ${formatCents(totals.diffCents)}`
                  : intl.formatMessage({ id: "journalGrid.balanced" })}
              </td>
            </tr>
          </tfoot>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          {intl.formatMessage({ id: "journalGrid.addLine" })}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleAutoBalance} disabled={!isUnbalanced}>
          {intl.formatMessage({ id: "journalGrid.autoBalance" })}
        </Button>
        <Button type="button" size="sm" onClick={() => void handleSave()} disabled={!canSave}>
          {submitting ? intl.formatMessage({ id: "journalGrid.saving" }) : intl.formatMessage({ id: "journalGrid.save" })}
        </Button>
        {isUnbalanced && (
          <span className="text-xs text-destructive">
            {intl.formatMessage({ id: "journalGrid.saveDisabledUnbalanced" }, { amount: formatCents(totals.diffCents) })}
          </span>
        )}
      </div>
    </div>
  );
}
