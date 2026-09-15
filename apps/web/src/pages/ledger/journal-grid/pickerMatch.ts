// F9 — filtering/resolution logic shared by the account, partner and cost-center picker cells.
// Pure so the "what does committing this free text actually select" rule is unit-testable without
// a real combobox in the DOM.

export interface PickerOption {
  id: string;
  code?: string;
  name: string;
}

export interface PickerSelection {
  id: string;
  label: string;
}

export function optionLabel(option: PickerOption): string {
  return option.code ? `${option.code} · ${option.name}` : option.name;
}

export function filterOptions(options: PickerOption[], query: string): PickerOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((option) => option.name.toLowerCase().includes(q) || (option.code ?? "").toLowerCase().includes(q));
}

// What a picker cell commits to when the user leaves it (Enter/Tab/arrow/blur/paste), given the
// free text they typed:
//  - blank text clears the selection (fine for the optional partner/cost-center columns; for the
//    required account column, an empty commit is left for save-time validation to catch, same as
//    the old plain-<select> form did when nothing was picked);
//  - an exact code match wins outright — the fast keyboard path is "type the full account code,
//    press Enter";
//  - otherwise, if the typed text narrowed the option list to one or more matches, the first match
//    is taken (mirrors "type enough to be unambiguous, then Enter/Tab", the same forgiving
//    resolution most spreadsheet-style comboboxes use);
//  - if the typed text matches nothing at all, the previous selection is kept rather than cleared —
//    a stray keystroke (or garbage from a paste) can never silently erase a value that was already
//    set.
export function resolvePickerCommit(query: string, options: PickerOption[], previous: PickerSelection | null): PickerSelection | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const exactCode = options.find((option) => option.code && option.code.toLowerCase() === trimmed.toLowerCase());
  if (exactCode) return { id: exactCode.id, label: optionLabel(exactCode) };

  const matches = filterOptions(options, trimmed);
  if (matches.length > 0) return { id: matches[0].id, label: optionLabel(matches[0]) };

  return previous;
}
