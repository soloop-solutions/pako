import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import type { EmployeeDetailResponse } from "@pako/shared";

import { apiClient } from "@/api/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Searchable employee picker. Replaces the plain <select> fed by one 200-row page: it asks the
// server for the first PAGE_SIZE matches of what's typed, so it works for any company size.
const PAGE_SIZE = 20;
const DEBOUNCE_MS = 250;

export interface EmployeeOption {
  id: string;
  name: string;
}

export function EmployeePicker({
  companyId,
  id,
  value,
  onChange,
  selectedName,
  emptyLabel,
  excludeId,
  withoutLogin = false,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  companyId: string;
  id?: string;
  value: string;
  onChange: (employeeId: string, employee?: EmployeeOption) => void;
  // Name of the selected employee when the caller already has it; otherwise it is fetched.
  selectedName?: string;
  // When set, the picker can be cleared and shows this text while empty (e.g. "All employees").
  emptyLabel?: string;
  excludeId?: string;
  // Only employees not yet linked to a user login.
  withoutLogin?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const intl = useIntl();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const selectedQuery = useQuery({
    queryKey: ["employees", companyId, "one", value],
    queryFn: () => apiClient.getEmployee(companyId, value),
    enabled: !!value && selectedName === undefined,
    staleTime: 60_000,
  });
  const resultsQuery = useQuery({
    queryKey: ["employees", companyId, "picker-search", search, withoutLogin],
    queryFn: () => apiClient.listEmployees(companyId, 1, PAGE_SIZE, search || undefined, "name", undefined, false, withoutLogin),
    enabled: open,
    staleTime: 30_000,
  });

  const options: EmployeeOption[] = (resultsQuery.data?.items ?? [])
    .filter((e: EmployeeDetailResponse) => e.id !== excludeId)
    .map((e) => ({ id: e.id, name: e.name }));
  const total = resultsQuery.data?.total ?? 0;
  const currentName = value ? selectedName ?? selectedQuery.data?.name ?? "" : "";

  useEffect(() => setActive(0), [search]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setText("");
    setSearch("");
  }

  function choose(option: EmployeeOption | null) {
    onChange(option?.id ?? "", option ?? undefined);
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (options[active]) choose(options[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listboxId}-${options[active].id}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={emptyLabel ?? intl.formatMessage({ id: "hr.picker.placeholder" })}
          value={open ? text : currentName}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {emptyLabel !== undefined && value && !disabled && (
          <button
            type="button"
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => choose(null)}
          >
            {intl.formatMessage({ id: "hr.picker.clear" })}
          </button>
        )}
      </div>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded-md border bg-popover p-1 text-[12.5px] shadow-md"
        >
          {resultsQuery.isPending && <li className="px-2 py-1 text-muted-foreground">{intl.formatMessage({ id: "hr.picker.loading" })}</li>}
          {!resultsQuery.isPending && options.length === 0 && (
            <li className="px-2 py-1 text-muted-foreground">{intl.formatMessage({ id: "hr.picker.noResults" })}</li>
          )}
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listboxId}-${option.id}`}
              role="option"
              aria-selected={option.id === value}
              className={cn(
                "cursor-pointer rounded px-2 py-1",
                index === active && "bg-accent text-accent-foreground",
                option.id === value && "font-medium",
              )}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
              onMouseEnter={() => setActive(index)}
            >
              {option.name}
            </li>
          ))}
          {total > options.length && options.length > 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              {intl.formatMessage({ id: "hr.picker.more" }, { shown: options.length, total })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
