import { Calendar, FileText } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";

import { monthName } from "@/pages/accounting-documents/month-names";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function yearOptions(): number[] {
  const current = new Date().getFullYear();
  const result: number[] = [];
  for (let y = current - 5; y <= current + 2; y++) result.push(y);
  return result;
}

export function AccountingDocuments() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const locale = intl.locale;

  const currentYear = new Date().getFullYear();
  const selectedYear = Number(searchParams.get("year")) || currentYear;

  function handleYearChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSearchParams({ year: e.target.value });
  }

  function handleMonthClick(month: number) {
    void navigate(`/accounting-documents/${selectedYear}/${month}`);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 text-white">
          <FileText className="size-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">
            {intl.formatMessage({ id: "accountingDocuments.title" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: "accountingDocuments.subtitle" })}
          </p>
        </div>
      </div>

      {/* Year selector */}
      <div className="flex items-center gap-2">
        <Calendar className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {intl.formatMessage({ id: "accountingDocuments.year" })}:
        </span>
        <select
          value={selectedYear}
          onChange={handleYearChange}
          className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        >
          {yearOptions().map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Month grid */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}
      >
        {MONTHS.map((month) => (
          <button
            key={month}
            type="button"
            onClick={() => handleMonthClick(month)}
            className="flex flex-col items-center gap-2 rounded-lg border bg-card p-6 text-center transition-colors hover:border-primary/50 hover:bg-accent/50"
          >
            <Calendar className="size-8 text-primary" />
            <span className="text-base font-medium">{monthName(month, locale)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
