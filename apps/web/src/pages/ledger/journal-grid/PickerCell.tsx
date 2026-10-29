import { type KeyboardEvent, type RefCallback, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onSelect: (option: PickerOption) => void;
}

// One reusable searchable-picker cell for the account/partner/project/employee columns — not a giant
// <select> (an accountant's chart of accounts can run to ~200 rows once the v2 chart is fully
// seeded, see root CLAUDE.md's Plani Kontabel v2.0 notes). Typing filters the list below the
// input; a suggestion can be picked by mouse (onMouseDown, not onClick — see below) or, in the
// normal keyboard-only flow, by typing enough of the code/name to be unambiguous and pressing
// Enter/Tab, which the grid resolves via resolvePickerCommit. When the dropdown is open,
// ArrowUp/ArrowDown navigate within the dropdown instead of moving cells; Enter on a highlighted
// option selects it. All other keyboard handling (Tab/Escape/horizontal arrows) is owned by the
// grid — see JournalEntryGrid.tsx.
//
// The dropdown renders in a React portal (document.body) with fixed positioning calculated from the
// input's bounding rect. This escapes the grid's overflow-x-auto container which would otherwise
// clip the dropdown — the same portal pattern DistributionEditor.tsx and SearchableSelect use.
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
  onBlur,
  onKeyDown,
  onPaste,
  onSelect,
}: PickerCellProps) {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRefLatest = useRef(inputRef);
  inputRefLatest.current = inputRef;
  const setRef = useCallback((node: HTMLInputElement | null) => {
    localRef.current = node;
    inputRefLatest.current(node);
  }, []);

  // After selecting an option (click or Enter on highlighted), suppress the dropdown until the user
  // types new text — prevents the confusing flash of the dropdown showing the just-selected option
  // as a search result immediately after picking it.
  const [justSelected, setJustSelected] = useState(false);

  // Only show the dropdown when the cell is focused AND the user has typed something (or the cell
  // already had a value) AND we haven't just committed a selection. An empty, freshly focused
  // picker stays closed until the user starts typing.
  const showDropdown = open && value.length > 0 && !justSelected;
  const filtered = showDropdown ? filterOptions(options, value).slice(0, 50) : [];
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Reset justSelected when the cell defocuses.
  useEffect(() => {
    if (!open) setJustSelected(false);
  }, [open]);

  // Reset highlight when the filter list changes (user typed something).
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [value]);

  // Reset highlight when the dropdown closes.
  useEffect(() => {
    if (!open) setHighlightedIndex(-1);
  }, [open]);

  // Scroll the highlighted item into view.
  useEffect(() => {
    if (highlightedIndex < 0) return;
    const el = itemRefs.current.get(highlightedIndex);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setJustSelected(false);
    onChange(event.target.value);
  }

  function handleOptionSelect(option: PickerOption) {
    setJustSelected(true);
    onSelect(option);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (showDropdown && filtered.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setHighlightedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return;
      }
      if (event.key === "Enter" && highlightedIndex >= 0) {
        event.preventDefault();
        event.stopPropagation();
        handleOptionSelect(filtered[highlightedIndex]);
        return;
      }
    }
    // All other keys (Tab, Escape, Enter without highlight, horizontal arrows) go to the grid.
    onKeyDown(event);
  }

  // Position the dropdown using the input's bounding rect — fixed positioning escapes overflow
  // containers. Flips above the input when insufficient space exists below.
  function getDropdownStyle(): React.CSSProperties {
    if (!localRef.current) return { display: "none" };
    const rect = localRef.current.getBoundingClientRect();
    const dropdownWidth = Math.max(rect.width, 288);
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipAbove = spaceBelow < 200 && rect.top > spaceBelow;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8));
    return {
      position: "fixed",
      left,
      width: dropdownWidth,
      ...(flipAbove ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.bottom + 2 }),
    };
  }

  const dropdown = showDropdown
    ? createPortal(
        <div style={getDropdownStyle()} className="z-50 max-h-[400px] overflow-auto rounded-md border bg-popover py-1 text-xs shadow-md">
          {filtered.length === 0 ? (
            <div className="px-2 py-1 text-muted-foreground">{noMatchesText}</div>
          ) : (
            filtered.map((option, index) => (
              <button
                key={option.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el);
                  else itemRefs.current.delete(index);
                }}
                type="button"
                className={cn("block w-full px-2 py-1 text-left hover:bg-accent", index === highlightedIndex && "bg-accent")}
                // onMouseDown (not onClick) fires before the input's blur, so the click registers
                // before the dropdown would otherwise close.
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleOptionSelect(option);
                }}
              >
                {optionLabel(option)}
              </button>
            ))
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <input
        ref={setRef}
        type="text"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={handleInputChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        className={cn(
          "h-6 w-full min-w-0 rounded-[3px] border border-input bg-transparent px-1.5 text-[13px] outline-none",
          open && "border-cell-active ring-2 ring-accent bg-card",
        )}
      />
      {dropdown}
    </>
  );
}
