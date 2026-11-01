import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, Star, X } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SearchableSelect — a branded, accessible, searchable dropdown that replaces
// native <select> for large option sets (partners, accounts, items, taxes,
// invoices). Built on Radix Popover for correct positioning/z-index/portal.
//
// Features:
//  - Type-to-filter with immediate results
//  - Keyboard: arrows to navigate, Enter to select, Escape to close, Tab closes
//  - Grouped options (optgroup equivalent)
//  - Empty state, no-results state
//  - Works inside modals, table cells, and dense forms
//  - Matches PAKO's h-7, text-[12.5px] dense design system
//  - Light and dark mode via CSS variables
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text shown in muted style (e.g., account code, tax rate) */
  description?: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

type OptionOrGroup = SelectOption | SelectGroup;

function isGroup(item: OptionOrGroup): item is SelectGroup {
  return "options" in item;
}

function flattenOptions(items: OptionOrGroup[]): SelectOption[] {
  const result: SelectOption[] = [];
  for (const item of items) {
    if (isGroup(item)) {
      result.push(...item.options);
    } else {
      result.push(item);
    }
  }
  return result;
}

function filterItems(items: OptionOrGroup[], query: string): OptionOrGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const result: OptionOrGroup[] = [];
  for (const item of items) {
    if (isGroup(item)) {
      const filtered = item.options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.description ?? "").toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q),
      );
      if (filtered.length > 0) {
        result.push({ label: item.label, options: filtered });
      }
    } else {
      if (
        item.label.toLowerCase().includes(q) ||
        (item.description ?? "").toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q)
      ) {
        result.push(item);
      }
    }
  }
  return result;
}

/** Configuration for the favorites feature in SearchableSelect. */
export interface SelectFavoritesConfig {
  /** Set of manually pinned entity IDs. */
  pinnedIds: Set<string>;
  /** Set of automatically suggested entity IDs. */
  autoIds: Set<string>;
  /** Called when the user clicks the star to pin. */
  onPin: (value: string) => void;
  /** Called when the user clicks the star to unpin. */
  onUnpin: (value: string) => void;
  /** Label for the "Pinned" section header. */
  pinnedLabel?: string;
  /** Label for the "Frequently Used" section header. */
  frequentLabel?: string;
}

export interface SearchableSelectProps {
  /** Current selected value */
  value: string;
  /** Called when the user selects an option */
  onChange: (value: string) => void;
  /** Options — flat list or grouped */
  options: OptionOrGroup[];
  /** Placeholder when nothing is selected */
  placeholder?: string;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Text shown when search returns no results */
  noResultsText?: string;
  /** Show a clearable "empty" option at the top */
  emptyOptionLabel?: string;
  /** HTML id for the trigger */
  id?: string;
  /** aria-label */
  "aria-label"?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Additional trigger class names */
  className?: string;
  /** Whether to show the search input (default: true if > 6 options) */
  searchable?: boolean;
  /** Custom render for the selected value display */
  renderValue?: (option: SelectOption | undefined) => ReactNode;
  /** Favorites support — pinned + frequently used sections at top of dropdown. */
  favorites?: SelectFavoritesConfig;
  /**
   * Called with the search text as it is typed (and "" when the list opens), for option sets
   * too large to load at once: the caller searches the server and passes the results as options.
   */
  onSearchChange?: (query: string) => void;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  noResultsText = "No results found",
  emptyOptionLabel,
  id,
  "aria-label": ariaLabel,
  disabled,
  className,
  searchable: searchableProp,
  renderValue,
  favorites,
  onSearchChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const setQuery = (next: string) => {
    setQueryState(next);
    onSearchChange?.(next);
  };
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const allFlat = flattenOptions(options);
  const totalOptions = allFlat.length + (emptyOptionLabel ? 1 : 0);
  // A server-searched list always needs its search box, however few options are loaded yet.
  const searchable = searchableProp ?? (!!onSearchChange || totalOptions > 6);

  const filtered = filterItems(options, query);
  const flatFiltered = flattenOptions(filtered);
  // Build the navigable list: empty option (if any) + filtered options
  const navigableOptions: SelectOption[] = [];
  if (emptyOptionLabel && (!query || emptyOptionLabel.toLowerCase().includes(query.toLowerCase()))) {
    navigableOptions.push({ value: "", label: emptyOptionLabel });
  }
  navigableOptions.push(...flatFiltered);

  const selectedOption = allFlat.find((o) => o.value === value);

  // Reset highlight and query when opening/closing
  useEffect(() => {
    if (open) {
      setQueryState("");
      setHighlightIndex(-1);
      // Focus search input after popover renders
      requestAnimationFrame(() => {
        searchRef.current?.focus();
      });
    }
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0) return;
    const el = itemRefs.current.get(highlightIndex);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  const selectOption = useCallback(
    (opt: SelectOption) => {
      onChange(opt.value);
      setOpen(false);
    },
    [onChange],
  );

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) =>
        prev < navigableOptions.length - 1 ? prev + 1 : prev,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < navigableOptions.length) {
        selectOption(navigableOptions[highlightIndex]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  // Handle trigger keyboard: open on Enter/Space/ArrowDown
  function handleTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      onSearchChange?.("");
    }
  }

  // Track flat index across groups for highlight navigation
  let flatIndex = emptyOptionLabel && (!query || emptyOptionLabel.toLowerCase().includes(query.toLowerCase())) ? 1 : 0;

  // Build favorites sections when no query is active
  const hasFavorites = favorites && (favorites.pinnedIds.size > 0 || favorites.autoIds.size > 0);
  const showFavoritesSection = hasFavorites && !query;

  const pinnedOptions = showFavoritesSection
    ? allFlat.filter((o) => favorites!.pinnedIds.has(o.value))
    : [];
  const autoOptions = showFavoritesSection
    ? allFlat.filter(
        (o) => favorites!.autoIds.has(o.value) && !favorites!.pinnedIds.has(o.value),
      )
    : [];

  // Collect all favorite values to exclude from the main list when favorites are shown
  const favoriteValues = showFavoritesSection
    ? new Set([...pinnedOptions.map((o) => o.value), ...autoOptions.map((o) => o.value)])
    : new Set<string>();

  function renderOptionButton(opt: SelectOption, navIdx: number, showStar?: boolean) {
    const isSelected = opt.value === value;
    const isHighlighted = navIdx === highlightIndex;
    const isPinned = favorites?.pinnedIds.has(opt.value);
    return (
      <button
        key={opt.value || "__empty__"}
        ref={(el) => {
          if (el) itemRefs.current.set(navIdx, el);
          else itemRefs.current.delete(navIdx);
        }}
        type="button"
        role="option"
        aria-selected={isSelected}
        className={cn(
          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors",
          isHighlighted && "bg-accent text-accent-foreground",
          isSelected && !isHighlighted && "bg-accent/50",
          !isHighlighted && !isSelected && "hover:bg-accent/50",
        )}
        onMouseDown={(e) => {
          e.preventDefault();
          selectOption(opt);
        }}
        onMouseEnter={() => setHighlightIndex(navIdx)}
      >
        <Check
          className={cn(
            "size-3.5 shrink-0",
            isSelected ? "opacity-100" : "opacity-0",
          )}
        />
        <span className="flex-1 truncate">{opt.label}</span>
        {opt.description && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {opt.description}
          </span>
        )}
        {showStar && favorites && opt.value && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={isPinned ? "Remove from favorites" : "Add to favorites"}
            className={cn(
              "shrink-0 ml-0.5",
              isPinned ? "text-yellow-500" : "text-muted-foreground/40 hover:text-yellow-500",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isPinned) {
                favorites.onUnpin(opt.value);
              } else {
                favorites.onPin(opt.value);
              }
            }}
          >
            <Star className={cn("size-3", isPinned && "fill-current")} />
          </span>
        )}
      </button>
    );
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onSearchChange?.("");
      }}
    >
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
            "z-50 w-[var(--radix-popover-trigger-width)] min-w-[180px] max-w-[400px] rounded-md border bg-popover text-popover-foreground shadow-md",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b px-2 py-1.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                autoComplete="off"
                className="h-6 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlightIndex(-1);
                }}
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
          )}

          <div
            ref={listRef}
            role="listbox"
            className="max-h-[280px] overflow-auto py-1"
          >
            {/* Empty / clear option */}
            {emptyOptionLabel &&
              (!query ||
                emptyOptionLabel
                  .toLowerCase()
                  .includes(query.toLowerCase())) &&
              renderOptionButton(
                { value: "", label: emptyOptionLabel },
                0,
              )}

            {/* Favorites sections — shown when dropdown opens with no query */}
            {showFavoritesSection && pinnedOptions.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {favorites!.pinnedLabel ?? "Pinned"}
                </div>
                {pinnedOptions.map((opt) => {
                  const idx = flatIndex++;
                  return renderOptionButton(opt, idx, true);
                })}
              </div>
            )}
            {showFavoritesSection && autoOptions.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {favorites!.frequentLabel ?? "Frequently Used"}
                </div>
                {autoOptions.map((opt) => {
                  const idx = flatIndex++;
                  return renderOptionButton(opt, idx, true);
                })}
              </div>
            )}
            {showFavoritesSection && (pinnedOptions.length > 0 || autoOptions.length > 0) && (
              <div className="mx-2 my-1 border-t" />
            )}

            {filtered.length === 0 && (
              <div className="px-2 py-4 text-center text-[12.5px] text-muted-foreground">
                {noResultsText}
              </div>
            )}

            {filtered.map((item) => {
              if (isGroup(item)) {
                // Filter out favorites from main list to avoid duplicates
                const groupOpts = showFavoritesSection
                  ? item.options.filter((o) => !favoriteValues.has(o.value))
                  : item.options;
                if (groupOpts.length === 0) return null;
                const groupItems = groupOpts.map((opt) => {
                  const idx = flatIndex++;
                  return renderOptionButton(opt, idx, !!favorites);
                });
                return (
                  <div key={item.label}>
                    <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                      {item.label}
                    </div>
                    {groupItems}
                  </div>
                );
              }
              if (showFavoritesSection && favoriteValues.has(item.value)) return null;
              const idx = flatIndex++;
              return renderOptionButton(item, idx, !!favorites);
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
