import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useIntl } from "react-intl";
import type { DateRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { useLocale } from "@/i18n/useLocale";
import { dateToIso, formatDisplayDate, isoToDate, isoWithin, parseTypedDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

const fieldClass =
  "group flex h-7 w-full min-w-0 items-center rounded-md border border-input bg-transparent text-[12.5px] transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 has-[input[aria-invalid=true]]:border-destructive";

const iconButtonClass =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none";

const popoverClass =
  "z-50 rounded-md border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none";

export interface DatePickerProps {
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  id?: string;
  name?: string;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export function DatePicker({
  value,
  onValueChange,
  min,
  max,
  disabled,
  required,
  clearable,
  id,
  name,
  className,
  placeholder,
  autoFocus,
  ...aria
}: DatePickerProps) {
  const intl = useIntl();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(() => formatDisplayDate(value));
  const inputRef = React.useRef<HTMLInputElement>(null);
  const showClear = (clearable ?? !required) && !!value && !disabled;

  React.useEffect(() => {
    setDraft(formatDisplayDate(value));
  }, [value]);

  function commit(text: string) {
    if (text.trim() === "") {
      if (value !== "") onValueChange("");
      return;
    }
    const iso = parseTypedDate(text);
    if (iso && isoWithin(iso, min, max)) {
      if (iso !== value) onValueChange(iso);
      setDraft(formatDisplayDate(iso));
    } else {
      setDraft(formatDisplayDate(value));
    }
  }

  function handleChange(text: string) {
    setDraft(text);
    const iso = parseTypedDate(text);
    if (iso && isoWithin(iso, min, max) && iso !== value) onValueChange(iso);
    else if (text.trim() === "" && value !== "") onValueChange("");
  }

  const minDate = isoToDate(min);
  const maxDate = isoToDate(max);
  const selected = isoToDate(value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={cn(fieldClass, className)} data-slot="date-picker">
          <input
            ref={inputRef}
            id={id}
            name={name}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            data-slot="input"
            value={draft}
            disabled={disabled}
            required={required}
            autoFocus={autoFocus}
            placeholder={placeholder ?? intl.formatMessage({ id: "date.placeholder" })}
            onChange={(event) => handleChange(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(event.currentTarget.value);
              if (event.key === "ArrowDown" && event.altKey) {
                event.preventDefault();
                setOpen(true);
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent px-2.5 tabular-nums outline-none placeholder:text-muted-foreground"
            {...aria}
          />
          {showClear && (
            <button
              type="button"
              className={iconButtonClass}
              aria-label={intl.formatMessage({ id: "date.clear" })}
              onClick={() => {
                onValueChange("");
                inputRef.current?.focus();
              }}
            >
              <X className="size-3.5" />
            </button>
          )}
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(iconButtonClass, "mr-0.5")}
              aria-label={intl.formatMessage({ id: "date.open" })}
            >
              <CalendarDays className="size-3.5" />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={popoverClass}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Calendar
            mode="single"
            required
            selected={selected}
            defaultMonth={selected ?? maxDate ?? undefined}
            disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
            onSelect={(date) => {
              if (!date) return;
              onValueChange(dateToIso(date));
              setOpen(false);
            }}
          />
          <div className="flex items-center justify-between border-t px-3 py-2">
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => {
                const today = dateToIso(new Date());
                if (isoWithin(today, min, max)) {
                  onValueChange(today);
                  setOpen(false);
                }
              }}
            >
              {intl.formatMessage({ id: "date.today" })}
            </button>
            {!required && value && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => {
                  onValueChange("");
                  setOpen(false);
                }}
              >
                {intl.formatMessage({ id: "date.clear" })}
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface DateRangeValue {
  from: string;
  to: string;
}

export interface DateRangePickerProps {
  value: DateRangeValue;
  onValueChange: (value: DateRangeValue) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

export function DateRangePicker({ value, onValueChange, min, max, disabled, clearable = true, id, className, ...aria }: DateRangePickerProps) {
  const intl = useIntl();
  const [open, setOpen] = React.useState(false);
  const from = isoToDate(value.from);
  const to = isoToDate(value.to);
  const minDate = isoToDate(min);
  const maxDate = isoToDate(max);
  const label =
    value.from || value.to
      ? `${formatDisplayDate(value.from) || "..."} - ${formatDisplayDate(value.to) || "..."}`
      : intl.formatMessage({ id: "date.rangePlaceholder" });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={cn(fieldClass, "w-auto", className)} data-slot="date-range-picker">
          <Popover.Trigger asChild>
            <button
              type="button"
              id={id}
              disabled={disabled}
              className={cn(
                "flex h-full min-w-0 flex-1 items-center gap-2 px-2.5 text-left tabular-nums outline-none",
                !value.from && !value.to && "text-muted-foreground",
              )}
              {...aria}
            >
              <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{label}</span>
            </button>
          </Popover.Trigger>
          {clearable && (value.from || value.to) && !disabled && (
            <button
              type="button"
              className={cn(iconButtonClass, "mr-0.5")}
              aria-label={intl.formatMessage({ id: "date.clear" })}
              onClick={() => onValueChange({ from: "", to: "" })}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className={popoverClass}>
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={from || to ? ({ from, to } as DateRange) : undefined}
            defaultMonth={from ?? undefined}
            disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
            onSelect={(range) => {
              onValueChange({ from: range?.from ? dateToIso(range.from) : "", to: range?.to ? dateToIso(range.to) : "" });
              if (range?.from && range?.to) setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface MonthPickerProps {
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

export function MonthPicker({ value, onValueChange, min, max, disabled, required, id, className, ...aria }: MonthPickerProps) {
  const intl = useIntl();
  const { locale } = useLocale();
  const [open, setOpen] = React.useState(false);
  const parsed = /^(\d{4})-(\d{2})$/.exec(value);
  const selectedYear = parsed ? Number(parsed[1]) : undefined;
  const selectedMonth = parsed ? Number(parsed[2]) : undefined;
  const [year, setYear] = React.useState(selectedYear ?? new Date().getFullYear());
  const monthNames = React.useMemo(
    () => Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale === "sq" ? "sq" : "en", { month: "short" }).format(new Date(2000, i, 1))),
    [locale],
  );
  const label = parsed
    ? new Intl.DateTimeFormat(locale === "sq" ? "sq" : "en", { month: "long", year: "numeric" }).format(new Date(selectedYear!, selectedMonth! - 1, 1))
    : intl.formatMessage({ id: "date.monthPlaceholder" });

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setYear(selectedYear ?? new Date().getFullYear());
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          data-slot="month-picker"
          data-required={required ? "true" : undefined}
          className={cn(fieldClass, "gap-2 px-2.5 text-left outline-none", !parsed && "text-muted-foreground", className)}
          {...aria}
        >
          <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate capitalize">{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className={cn(popoverClass, "w-56 p-3")}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className={iconButtonClass} aria-label={intl.formatMessage({ id: "date.previousYear" })} onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-[12.5px] font-medium tabular-nums">{year}</span>
            <button type="button" className={iconButtonClass} aria-label={intl.formatMessage({ id: "date.nextYear" })} onClick={() => setYear((y) => y + 1)}>
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {monthNames.map((name, index) => {
              const key = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
              const outOfRange = (min && key < min.slice(0, 7)) || (max && key > max.slice(0, 7));
              const isSelected = key === value;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!!outOfRange}
                  aria-pressed={isSelected}
                  onClick={() => {
                    onValueChange(key);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-8 rounded-md text-[12.5px] capitalize outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-30",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
