import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, DayFlag, SelectionState, UI, type DayPickerProps } from "react-day-picker";
import { enUS, sq } from "react-day-picker/locale";

import { useLocale } from "@/i18n/useLocale";
import { cn } from "@/lib/utils";

const dayButton =
  "inline-flex size-8 items-center justify-center rounded-md text-[12.5px] tabular-nums outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Calendar({ className, classNames, ...props }: DayPickerProps) {
  const { locale } = useLocale();

  return (
    <DayPicker
      locale={locale === "sq" ? sq : enUS}
      weekStartsOn={1}
      showOutsideDays
      captionLayout="dropdown"
      startMonth={new Date(1990, 0)}
      endMonth={new Date(2100, 11)}
      className={cn("p-3", className)}
      classNames={{
        [UI.Months]: "relative flex flex-col gap-3",
        [UI.Month]: "flex flex-col gap-2",
        [UI.MonthCaption]: "flex h-8 items-center justify-center px-9",
        [UI.Dropdowns]: "flex items-center gap-1 text-[12.5px] font-medium",
        [UI.DropdownRoot]: "relative inline-flex items-center",
        [UI.Dropdown]:
          "absolute inset-0 z-10 w-full cursor-pointer appearance-none opacity-0",
        [UI.CaptionLabel]:
          "inline-flex h-7 items-center rounded-md px-2 text-[12.5px] font-medium hover:bg-accent",
        [UI.Nav]: "absolute inset-x-0 top-0 flex items-center justify-between",
        [UI.PreviousMonthButton]: cn(dayButton, "text-muted-foreground"),
        [UI.NextMonthButton]: cn(dayButton, "text-muted-foreground"),
        [UI.MonthGrid]: "w-full border-collapse",
        [UI.Weekdays]: "flex",
        [UI.Weekday]: "w-8 text-center text-[11px] font-medium text-muted-foreground",
        [UI.Week]: "mt-1 flex",
        [UI.Day]: "size-8 p-0 text-center",
        [UI.DayButton]: dayButton,
        [SelectionState.selected]:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        [SelectionState.range_start]: "rounded-l-md bg-accent",
        [SelectionState.range_middle]: "bg-accent [&>button]:rounded-none [&>button]:bg-transparent",
        [SelectionState.range_end]: "rounded-r-md bg-accent",
        [DayFlag.today]: "[&>button]:font-semibold [&>button]:ring-1 [&>button]:ring-primary/50",
        [DayFlag.outside]: "[&>button]:text-muted-foreground [&>button]:opacity-50",
        [DayFlag.disabled]: "[&>button]:pointer-events-none [&>button]:opacity-30",
        [DayFlag.hidden]: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-4", chevronClass)} />
          ) : orientation === "right" ? (
            <ChevronRight className={cn("size-4", chevronClass)} />
          ) : (
            <ChevronRight className={cn("size-3 rotate-90", chevronClass)} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
