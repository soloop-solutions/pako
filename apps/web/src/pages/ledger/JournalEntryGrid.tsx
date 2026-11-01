import * as RadixPopover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, EmployeeDetailResponse, JournalResponse, PartnerResponse, ProjectResponse } from "@pako/shared";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { fetchCostCenters, type CostCenterOption } from "@/api/cost-centers-client";
import { ActionPasswordDialog } from "@/components/layout/ActionPasswordDialog";
import { useCompany } from "@/context/CompanyContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { cn } from "@/lib/utils";
import { setCostCentersMockActive } from "@/mocks/costCentersMockFlag";
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
import { useMyAccess } from "@/hooks/useMyAccess";

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
  // Without Accounting: Approve the entry is saved as a draft for someone else to post.
  const { canApprove } = useMyAccess();
  const [journalId, setJournalId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const { activeCompany } = useCompany();

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

  // Guard against double-committing: commitAndMove (Enter/Tab/arrows) sets this to true before
  // committing, so the subsequent onBlur (which fires when focus moves) knows to skip. Reset on
  // every fresh focus so the next blur is live again.
  const blurGuardRef = useRef(false);

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [employees, setEmployees] = useState<EmployeeDetailResponse[]>([]);
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
    let cancelled = false;
    apiClient
      .projectsAll(companyId)
      .then((result) => {
        if (!cancelled) setProjects(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listEmployees(companyId, undefined, undefined, undefined, undefined, undefined, undefined, undefined)
      .then((result) => {
        if (!cancelled) setEmployees(result.items ?? []);
      })
      .catch(() => {});
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
  const projectOptions = useMemo<PickerOption[]>(() => projects.map((p) => ({ id: p.id, code: p.code, name: p.name })), [projects]);
  const employeeOptions = useMemo<PickerOption[]>(() => employees.map((e) => ({ id: e.id, name: e.name })), [employees]);
  const costCenterOptions = useMemo<PickerOption[]>(
    () => costCenters.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    [costCenters],
  );
  const optionsByColumn = useMemo(
    () => ({ account: accountOptions, partner: partnerOptions, project: projectOptions, employee: employeeOptions }),
    [accountOptions, partnerOptions, projectOptions, employeeOptions],
  );

  const effectiveJournalId = journalId || journals.find((j) => j.code === "GEN")?.id || journals[0]?.id || "";

  // Totals/diff must reflect exactly what Save would submit, not every typed cell — a line with an
  // amount but no account selected is excluded from the real create request (see handleSave's
  // validLines below), so it must be excluded here too, or the Diferenca chip can show 0.00 for a
  // set of lines that isn't actually what gets posted.
  const totals = useMemo(() => computeTotals(lines.filter((line) => line.accountId)), [lines]);

  // Protect unsaved journal entry lines from accidental navigation
  const hasContent = lines.some((line) => line.accountId || line.debit || line.credit || line.description.trim());
  useUnsavedChanges(hasContent && !submitting);

  // Re-seed the draft (and move real DOM focus) only when the focused CELL changes — deliberately
  // not on every `lines` mutation, so an unrelated update elsewhere (auto-balance touching the
  // last line, a paste landing on other cells) never clobbers whatever the user is mid-typing in
  // the cell they're actually on. See the report for why this is a deliberate omission.
  useEffect(() => {
    // Reset the blur guard so the newly focused cell's future blur will commit if needed.
    blurGuardRef.current = false;
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
    blurGuardRef.current = true;
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

  function handleBlur(row: number, col: number) {
    // If Enter/Tab/arrow already committed via commitAndMove, skip to avoid double-committing.
    if (blurGuardRef.current) return;
    setLines((prev) => commitDraftAt(row, col, draft, prev));
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

  function handleSaveClick() {
    setError(null);

    const focusedLine = lines[focus.row];
    const finalLines = focusedLine ? commitDraftAt(focus.row, focus.col, draft, lines) : lines;
    setLines(finalLines);

    const orphanAmountIndex = finalLines.findIndex(
      (line) => !line.accountId && (toCents(line.debit) !== 0 || toCents(line.credit) !== 0),
    );
    if (orphanAmountIndex !== -1) {
      setError(intl.formatMessage({ id: "journalGrid.lineHasAmountWithoutAccount" }, { line: orphanAmountIndex + 1 }));
      return;
    }

    const invalidDistributionIndex = finalLines.findIndex(
      (line) => line.accountId && !isDistributionComplete(line.costCenterAllocations),
    );
    if (invalidDistributionIndex !== -1) {
      setError(intl.formatMessage({ id: "journalGrid.lineDistributionNotComplete" }, { line: invalidDistributionIndex + 1 }));
      return;
    }

    const validLines = finalLines.filter((line) => line.accountId);

    const dualAmountIndex = validLines.findIndex(
      (line) => toCents(line.debit) > 0 && toCents(line.credit) > 0,
    );
    if (dualAmountIndex !== -1) {
      setError(intl.formatMessage({ id: "journalGrid.lineBothDebitAndCredit" }, { line: dualAmountIndex + 1 }));
      return;
    }

    if (validLines.length < 2) {
      setError(intl.formatMessage({ id: "journalGrid.atLeastTwoLines" }));
      return;
    }
    if (!effectiveJournalId) {
      setError(intl.formatMessage({ id: "journalGrid.noJournal" }));
      return;
    }
    const finalTotals = computeTotals(validLines);
    if (finalTotals.diffCents !== 0) {
      setError(intl.formatMessage({ id: "journalGrid.unbalancedError" }, { amount: formatCents(finalTotals.diffCents) }));
      return;
    }

    // Validation passed — show password dialog
    setShowPasswordDialog(true);
  }

  async function handlePasswordConfirm(token: string) {
    setShowPasswordDialog(false);

    const focusedLine = lines[focus.row];
    const finalLines = focusedLine ? commitDraftAt(focus.row, focus.col, draft, lines) : lines;
    const validLines = finalLines.filter((line) => line.accountId);

    setSubmitting(true);
    try {
      const draftEntry = await apiClient.journalEntries(companyId, token, {
        journalId: effectiveJournalId,
        date,
        description: description || undefined,
        reference: reference || undefined,
        remarks: remarks || undefined,
        lines: validLines.map((line) => {
          let analyticDistribution: { [key: string]: number } | undefined;
          if (line.costCenterAllocations.length > 0) {
            analyticDistribution = {};
            for (const alloc of line.costCenterAllocations) {
              if (alloc.costCenterId) {
                analyticDistribution[alloc.costCenterId] = parseFloat(alloc.percentage) || 0;
              }
            }
          }
          return {
            accountId: line.accountId,
            partnerId: line.partnerId || undefined,
            debit: parseFloat(line.debit) || 0,
            credit: parseFloat(line.credit) || 0,
            description: line.description || undefined,
            projectId: line.projectId || undefined,
            employeeId: line.employeeId || undefined,
            analyticDistribution,
          };
        }),
      });

      if (!canApprove("accounting")) {
        toast.success(intl.formatMessage({ id: "journalGrid.savedAsDraft" }));
        setLines([emptyLine(nextId()), emptyLine(nextId())]);
        setFocus({ row: 0, col: 0 });
        setDescription("");
        setReference("");
        setRemarks("");
        onCreated();
        return;
      }

      try {
        await apiClient.post3(companyId, draftEntry.id);
      } catch (postErr) {
        setError(getApiErrorMessage(postErr, intl.formatMessage({ id: "journalGrid.postError" })));
        onCreated();
        return;
      }

      toast.success(intl.formatMessage({ id: "toast.journalSaved" }));
      setLines([emptyLine(nextId()), emptyLine(nextId())]);
      setFocus({ row: 0, col: 0 });
      setOpenDistributionRow(null);
      setDescription("");
      setReference("");
      setRemarks("");
      onCreated();
    } catch (err) {
      const msg = getApiErrorMessage(err, intl.formatMessage({ id: "journalGrid.saveError" }));
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Per-line dual-amount detection — drives the inline warning on debit/credit cells so
  // the user sees the problem immediately, not only after clicking Save.
  const dualAmountRows = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (toCents(lines[i].debit) > 0 && toCents(lines[i].credit) > 0) set.add(i);
    }
    return set;
  }, [lines]);

  const isUnbalanced = totals.diffCents !== 0;
  const hasDualAmountLines = dualAmountRows.size > 0;
  const canSave = !isUnbalanced && !hasDualAmountLines && !submitting;

  const columnHeaderKeys: Record<GridColumn, string> = {
    account: "journalGrid.colAccount",
    description: "journalGrid.colDescription",
    debit: "journalGrid.colDebit",
    credit: "journalGrid.colCredit",
    partner: "journalGrid.colPartner",
    project: "journalGrid.colProject",
    employee: "journalGrid.colEmployee",
    costCenter: "journalGrid.colDistribution",
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
      const isPopoverOpen = openDistributionRow === row;
      return (
        <RadixPopover.Root open={isPopoverOpen} onOpenChange={(open) => setOpenDistributionRow(open ? row : null)}>
          <RadixPopover.Trigger asChild>
            <button
              ref={registerRef}
              type="button"
              aria-label={intl.formatMessage({ id: columnHeaderKeys[column] })}
              onFocus={() => setFocus({ row, col })}
              onKeyDown={(event) => handleKeyDown(event, row, col)}
              className={cn(
                "h-6 w-full truncate rounded-[3px] border border-input bg-transparent px-1.5 text-left text-[13px] outline-none",
                isFocused && "border-cell-active ring-2 ring-accent bg-card",
                !complete && "border-destructive text-destructive",
              )}
            >
              {summary}
            </button>
          </RadixPopover.Trigger>
          {isPopoverOpen && (
            <DistributionEditor
              allocations={allocations}
              options={costCenterOptions}
              onAddId={nextAllocId}
              onChange={(next) => setLines((prev) => prev.map((l, i) => (i === row ? { ...l, costCenterAllocations: next } : l)))}
              onClose={() => setOpenDistributionRow(null)}
            />
          )}
        </RadixPopover.Root>
      );
    }

    if (column === "account" || column === "partner" || column === "project" || column === "employee") {
      const optionsMap: Record<string, PickerOption[]> = { account: accountOptions, partner: partnerOptions, project: projectOptions, employee: employeeOptions };
      const options = optionsMap[column] ?? [];
      const placeholderKeys: Record<string, string> = { account: "journalGrid.accountPlaceholder", partner: "journalGrid.partnerPlaceholder", project: "journalGrid.projectPlaceholder", employee: "journalGrid.employeePlaceholder" };
      const placeholderKey = placeholderKeys[column] ?? "journalGrid.partnerPlaceholder";
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
          onBlur={() => handleBlur(row, col)}
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

    const isDualAmountCell = (column === "debit" || column === "credit") && dualAmountRows.has(row);

    return (
      <input
        ref={registerRef}
        type="text"
        inputMode={column === "debit" || column === "credit" ? "decimal" : undefined}
        aria-label={intl.formatMessage({ id: columnHeaderKeys[column] })}
        value={displayValue}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setFocus({ row, col })}
        onBlur={() => handleBlur(row, col)}
        onKeyDown={(event) => handleKeyDown(event, row, col)}
        onPaste={(event) => handlePaste(event, row, col)}
        className={cn(
          "h-6 w-full min-w-0 rounded-[3px] border border-input bg-transparent px-1.5 text-[13px] outline-none",
          isFocused && "border-cell-active ring-2 ring-accent bg-card",
          (column === "debit" || column === "credit") && "text-right tabular-nums",
          isDualAmountCell && "border-destructive",
        )}
        title={isDualAmountCell ? intl.formatMessage({ id: "journalGrid.dualAmountWarning" }) : undefined}
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

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label>{intl.formatMessage({ id: "journalGrid.number" })}</Label>
          <Input value={intl.formatMessage({ id: "journalGrid.numberAuto" })} disabled className="text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="journal-grid-journal">{intl.formatMessage({ id: "journalGrid.journal" })}</Label>
          <SearchableSelect
            id="journal-grid-journal"
            value={effectiveJournalId}
            onChange={setJournalId}
            placeholder={intl.formatMessage({ id: "journalGrid.journal" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            options={journals.map((journal) => ({
              value: journal.id,
              label: `${journal.name} (${journal.code})`,
            }))}
            searchable={false}
          />
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="journal-grid-description">{intl.formatMessage({ id: "journalGrid.entryDescription" })}</Label>
          <Input id="journal-grid-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={intl.formatMessage({ id: "journalGrid.entryDescriptionPlaceholder" })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="journal-grid-remarks">{intl.formatMessage({ id: "journalGrid.remarks" })}</Label>
          <Input id="journal-grid-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder={intl.formatMessage({ id: "journalGrid.remarksPlaceholder" })} />
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
              <TableRow
                key={line.id}
                className={cn("h-[30px]", row === focus.row && "bg-row-selected shadow-[inset_3px_0_0_var(--primary)]")}
              >
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
            <tr className="h-[34px] border-t border-t-grid-header-border bg-totals text-totals-foreground font-bold">
              <td className="h-[34px] px-2 py-1" colSpan={2}>
                {intl.formatMessage({ id: "journalGrid.totalDebit" })} / {intl.formatMessage({ id: "journalGrid.totalCredit" })}
              </td>
              <td className="h-[34px] px-2 py-1 text-right tabular-nums">{totals.debit.toFixed(2)}</td>
              <td className="h-[34px] px-2 py-1 text-right tabular-nums">{totals.credit.toFixed(2)}</td>
              <td className="h-[34px] px-2 py-1" colSpan={5}>
                <span className="inline-flex items-center gap-1.5">
                  {intl.formatMessage({ id: "journalGrid.difference" })}
                  <Badge variant={isUnbalanced ? "warning" : "success"}>{formatCents(totals.diffCents)}</Badge>
                </span>
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
        <Button type="button" size="sm" onClick={handleSaveClick} disabled={!canSave}>
          {submitting ? intl.formatMessage({ id: "journalGrid.saving" }) : intl.formatMessage({ id: "journalGrid.save" })}
        </Button>
        {isUnbalanced && (
          <span className="text-xs text-destructive">
            {intl.formatMessage({ id: "journalGrid.saveDisabledUnbalanced" }, { amount: formatCents(totals.diffCents) })}
          </span>
        )}
        {hasDualAmountLines && (
          <span className="text-xs text-destructive">
            {intl.formatMessage({ id: "journalGrid.dualAmountWarning" })}
          </span>
        )}
      </div>

      {showPasswordDialog && (
        <ActionPasswordDialog
          companyName={activeCompany?.name ?? ""}
          companyId={companyId}
          action="create-journal-entry"
          actionLabelId="actionPassword.action.createJournalEntry"
          onConfirm={(token) => void handlePasswordConfirm(token)}
          onCancel={() => setShowPasswordDialog(false)}
        />
      )}
    </div>
  );
}
