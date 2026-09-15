import { type KeyboardEvent, type RefCallback } from "react";

import { cn } from "@/lib/utils";
import { filterOptions, optionLabel, type PickerOption } from "@/pages/ledger/journal-grid/pickerMatch";

interface PickerCellProps {
  value: string;
  options: PickerOption[];
  open: boolean;
  ariaLabel: string;
  placeholder?: string;
  noMatchesText: string;
  inputRef: RefCallback<HTMLInputElement>;
  onChange: (value: string) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onSelect: (option: PickerOption) => void;
}

// One reusable searchable-picker cell for the account/partner/cost-center columns — not a giant
// <select> (an accountant's chart of accounts can run to ~200 rows once the v2 chart is fully
// seeded, see root CLAUDE.md's Plani Kontabel v2.0 notes). Typing filters the list below the
// input; a suggestion can be picked by mouse (onMouseDown, not onClick — see below) or, in the
// normal keyboard-only flow, by typing enough of the code/name to be unambiguous and pressing
// Enter/Tab, which the grid resolves via resolvePickerCommit. All actual keyboard handling
// (Enter/Tab/Escape/arrows) is owned by the grid, not this component — see JournalEntryGrid.tsx.
export function PickerCell({
  value,
  options,
  open,
  ariaLabel,
  placeholder,
  noMatchesText,
  inputRef,
  onChange,
  onFocus,
  onKeyDown,
  onPaste,
  onSelect,
}: PickerCellProps) {
  const filtered = open ? filterOptions(options, value).slice(0, 20) : [];

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className="h-[26px] w-full min-w-0 rounded border border-input bg-transparent px-1.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]"
      />
      {open && (
        <div className="absolute left-0 top-full z-20 mt-0.5 max-h-48 w-56 overflow-auto rounded-md border bg-popover py-1 text-xs shadow-md">
          {filtered.length === 0 ? (
            <div className="px-2 py-1 text-muted-foreground">{noMatchesText}</div>
          ) : (
            filtered.map((option) => (
              <button
                key={option.id}
                type="button"
                className={cn("block w-full px-2 py-1 text-left hover:bg-accent")}
                // onMouseDown (not onClick) fires before the input's blur, so the click registers
                // before the dropdown would otherwise close.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(option);
                }}
              >
                {optionLabel(option)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
