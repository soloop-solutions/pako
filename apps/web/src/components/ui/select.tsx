import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Select — a branded, accessible, searchable dropdown for fixed option sets.
//
// Built on Radix Popover for correct positioning, z-index, and portal behavior
// (works inside modals, table cells, and dense forms). Matches PAKO's h-7,
// text-[12.5px] dense design system and the SearchableSelect visual language.
//
// Every dropdown in PAKO is searchable — the search input filters options by
// label as the user types.
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
  /** Whether this option is disabled */
  disabled?: boolean;
}

export interface SelectProps {
  /** Current selected value */
  value: string;
  /** Called when the user selects an option */
  onValueChange: (value: string) => void;
  /** Options list */
  options: SelectOption[];
  /** Placeholder when nothing is selected */
  placeholder?: string;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Text shown when search returns no results */
  noResultsText?: string;
  /** HTML id for the trigger */
  id?: string;
  /** aria-label */
  "aria-label"?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Additional trigger class names */
  className?: string;
  /** Custom render for the selected value display */
  renderValue?: (option: SelectOption | undefined) => ReactNode;
}

function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  noResultsText = "No results",
  id,
  "aria-label": ariaLabel,
  disabled,
  className,
  renderValue,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const selectedOption = options.find((o) => o.value === value);
  const filtered = filterOptions(options, query);

  // Reset highlight and query when opening/closing
  useEffect(() => {
    if (open) {
      setQuery("");
      // Highlight the currently selected option in the full list
      const idx = options.findIndex((o) => o.value === value);
      setHighlightIndex(idx >= 0 ? idx : -1);
      // Focus search input after popover renders
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        if (idx >= 0) {
          const el = itemRefs.current.get(idx);
          if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest" });
        }
      });
    }
  }, [open, options, value]);

  // When query changes, reset highlight to first match
  useEffect(() => {
    if (!open) return;
    if (query) {
      setHighlightIndex(filtered.length > 0 ? 0 : -1);
    }
  }, [query, open, filtered.length]);

  const selectOption = useCallback(
    (opt: SelectOption) => {
      onValueChange(opt.value);
      setOpen(false);
    },
    [onValueChange],
  );

  function handleKeyDown(event: KeyboardEvent) {
    const enabledIndices = filtered
      .map((o, i) => (o.disabled ? -1 : i))
      .filter((i) => i >= 0);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) => {
        const currentPos = enabledIndices.indexOf(prev);
        const nextPos = currentPos < enabledIndices.length - 1 ? currentPos + 1 : currentPos;
        return enabledIndices[nextPos] ?? (enabledIndices[0] ?? prev);
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => {
        const currentPos = enabledIndices.indexOf(prev);
        const nextPos = currentPos > 0 ? currentPos - 1 : 0;
        return enabledIndices[nextPos] ?? prev;
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filtered.length && !filtered[highlightIndex].disabled) {
        selectOption(filtered[highlightIndex]);
      }
    } else if (event.key === " " && !query) {
      // Space selects only when not typing in search
      event.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filtered.length && !filtered[highlightIndex].disabled) {
        selectOption(filtered[highlightIndex]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (enabledIndices.length > 0) setHighlightIndex(enabledIndices[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      if (enabledIndices.length > 0) setHighlightIndex(enabledIndices[enabledIndices.length - 1]);
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0) return;
    const el = itemRefs.current.get(highlightIndex);
    if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  function handleTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          id={id}
          disabled={disabled}
          className={cn(
            "flex h-7 w-full items-center justify-between rounded-md border border-input bg-transparent px-2.5 text-[12.5px] outline-none transition-colors",
            "hover:border-ring/60",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
            !value && "text-muted-foreground",
            className,
          )}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {renderValue
              ? renderValue(selectedOption)
              : selectedOption
                ? selectedOption.label
                : placeholder}
          </span>
          <ChevronDown
            className={cn(
              "ml-1 size-3.5 shrink-0 opacity-50 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cn(
            "z-50 w-[var(--radix-popover-trigger-width)] min-w-[140px] rounded-md border bg-popover text-popover-foreground shadow-md",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              autoComplete="off"
              className="h-6 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery("");
                  searchRef.current?.focus();
                }}
                tabIndex={-1}
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <div
            ref={listRef}
            role="listbox"
            className="max-h-[280px] overflow-auto py-1"
          >
            {filtered.length === 0 && (
              <div className="px-2 py-4 text-center text-[12.5px] text-muted-foreground">
                {noResultsText}
              </div>
            )}

            {filtered.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightIndex;
              return (
                <button
                  key={opt.value}
                  ref={(el) => {
                    if (el) itemRefs.current.set(idx, el);
                    else itemRefs.current.delete(idx);
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  disabled={opt.disabled}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors",
                    isHighlighted && "bg-accent text-accent-foreground",
                    isSelected && !isHighlighted && "bg-accent/50",
                    !isHighlighted && !isSelected && "hover:bg-accent/50",
                    opt.disabled && "pointer-events-none opacity-50",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!opt.disabled) selectOption(opt);
                  }}
                  onMouseEnter={() => setHighlightIndex(idx)}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1 truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
