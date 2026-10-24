import * as Popover from "@radix-ui/react-popover";
import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { sumAllocationUnits } from "@/pages/ledger/journal-grid/distribution";
import { optionLabel, type PickerOption } from "@/pages/ledger/journal-grid/pickerMatch";
import type { CostCenterAllocation } from "@/pages/ledger/journal-grid/types";

interface DistributionEditorProps {
  allocations: CostCenterAllocation[];
  options: PickerOption[];
  onChange: (allocations: CostCenterAllocation[]) => void;
  onAddId: () => string;
  onClose: () => void;
}

// F12 — the analytic-distribution popover opened from the grid's "costCenter" column (see
// JournalEntryGrid.tsx's renderCell). Deliberately NOT wired into the grid's own Excel keyboard
// model (Enter/Tab/arrows on the triggering cell keep behaving exactly as they do for every other
// column — see that file's report notes): everything inside this popover is a separate DOM subtree
// with its own plain form controls, so typing/selecting here never reaches the grid's cell-level
// key handler at all. Escape is the one key this component does own, to close itself; it stops
// propagation so the grid's cell-level Escape handling (which reverts a text draft) never also
// fires for a keypress that was actually meant for the popover.
//
// Renders as a Radix Popover.Content inside a portal so it escapes the grid's overflow-x-auto
// container and benefits from Radix's collision-aware positioning.
export function DistributionEditor({ allocations, options, onChange, onAddId, onClose }: DistributionEditorProps) {
  const intl = useIntl();
  const sumUnits = sumAllocationUnits(allocations);
  const sumDisplay = (sumUnits / 100).toFixed(2);
  const hasIncompleteAllocation = allocations.some((allocation) => !allocation.costCenterId);
  const isComplete = allocations.length === 0 || (!hasIncompleteAllocation && sumUnits === 100_00);

  function update(index: number, patch: Partial<CostCenterAllocation>) {
    onChange(allocations.map((allocation, i) => (i === index ? { ...allocation, ...patch } : allocation)));
  }

  function remove(index: number) {
    onChange(allocations.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...allocations, { id: onAddId(), costCenterId: "", costCenterLabel: "", percentage: "" }]);
  }

  return (
    <Popover.Portal>
      <Popover.Content
        side="bottom"
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="z-50 w-80 max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-3 text-xs shadow-md"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <p className="mb-2 font-medium">{intl.formatMessage({ id: "journalGrid.distributionTitle" })}</p>

        {allocations.length === 0 ? (
          <p className="text-muted-foreground">{intl.formatMessage({ id: "journalGrid.distributionEmpty" })}</p>
        ) : (
          <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
            {allocations.map((allocation, index) => (
              <div key={allocation.id} className="flex items-center gap-1.5">
                <Select
                  aria-label={intl.formatMessage({ id: "journalGrid.distributionCostCenterLabel" })}
                  value={allocation.costCenterId}
                  onValueChange={(v) => {
                    const selected = options.find((option) => option.id === v);
                    update(index, { costCenterId: v, costCenterLabel: selected ? optionLabel(selected) : "" });
                  }}
                  placeholder={intl.formatMessage({ id: "journalGrid.distributionCostCenterPlaceholder" })}
                  className="h-7 min-w-0 flex-1 text-xs"
                  options={options.map((option) => ({
                    value: option.id,
                    label: optionLabel(option),
                  }))}
                />
                <Input
                  aria-label={intl.formatMessage({ id: "journalGrid.distributionPercentageLabel" })}
                  type="text"
                  inputMode="decimal"
                  value={allocation.percentage}
                  onChange={(event) => update(index, { percentage: event.target.value })}
                  className="h-7 w-16 shrink-0 px-1.5 py-0 text-right tabular-nums"
                />
                <span className="shrink-0 text-muted-foreground">%</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-1.5"
                  onClick={() => remove(index)}
                  aria-label={intl.formatMessage({ id: "journalGrid.distributionRemove" })}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={add}>
            {intl.formatMessage({ id: "journalGrid.distributionAdd" })}
          </Button>
          <span className={cn("tabular-nums", isComplete ? "text-muted-foreground" : "text-destructive")}>
            {intl.formatMessage({ id: "journalGrid.distributionSum" })}: {sumDisplay}%
          </span>
        </div>

        {!isComplete && (
          <p className="mt-1 text-destructive">{intl.formatMessage({ id: "journalGrid.distributionMustEqual100" })}</p>
        )}

        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" onClick={onClose}>
            {intl.formatMessage({ id: "journalGrid.distributionDone" })}
          </Button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  );
}
