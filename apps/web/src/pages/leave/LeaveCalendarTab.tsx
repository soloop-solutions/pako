import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { LeaveRequestResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatDate, useLeaveTypes } from "@/pages/leave/leaveShared";

// One page at the API's maximum. A month with more approved requests than this shows a warning
// rather than silently dropping rows.
const CALENDAR_PAGE_SIZE = 200;

const pad = (n: number) => String(n).padStart(2, "0");

function parseMonth(raw: string | null): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function shiftMonth(year: number, month: number, delta: number): string {
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

interface CalendarDay {
  iso: string;
  day: number;
  weekend: boolean;
  weekday: number;
}

export function LeaveCalendarTab({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const { year, month } = parseMonth(searchParams.get("month"));
  const monthKey = `${year}-${pad(month)}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${pad(daysInMonth)}`;

  function setMonth(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set("month", value);
        else params.delete("month");
        return params;
      },
      { replace: true },
    );
  }

  const typesQuery = useLeaveTypes(companyId);
  const requestsQuery = useQuery({
    queryKey: ["leave", "calendar", companyId, monthKey],
    queryFn: () => apiClient.listLeaveRequests(companyId, 1, CALENDAR_PAGE_SIZE, "Approved", undefined, from, to),
  });
  const holidaysQuery = useQuery({
    queryKey: ["leave", "holidays", companyId, year],
    queryFn: () => apiClient.listPublicHolidays(companyId, year),
  });

  const days = useMemo<CalendarDay[]>(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => {
        const date = new Date(year, month - 1, i + 1);
        const weekday = date.getDay();
        return { iso: `${monthKey}-${pad(i + 1)}`, day: i + 1, weekday, weekend: weekday === 0 || weekday === 6 };
      }),
    [year, month, monthKey, daysInMonth],
  );

  const holidaysByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidaysQuery.data ?? []) {
      const iso = formatDate(h.date);
      if (iso.startsWith(monthKey)) map.set(iso, h.name);
    }
    return map;
  }, [holidaysQuery.data, monthKey]);

  const typeCodes = useMemo(() => new Map((typesQuery.data ?? []).map((t) => [t.id, t.code])), [typesQuery.data]);

  const employeeRows = useMemo(() => {
    const byEmployee = new Map<string, { name: string; requests: LeaveRequestResponse[] }>();
    for (const r of requestsQuery.data?.items ?? []) {
      const entry = byEmployee.get(r.employeeId) ?? { name: r.employeeName, requests: [] };
      entry.requests.push(r);
      byEmployee.set(r.employeeId, entry);
    }
    return [...byEmployee.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [requestsQuery.data]);

  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(intl.locale, { weekday: "narrow" }), [intl.locale]);
  const monthLabel = new Intl.DateTimeFormat(intl.locale, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));

  const loadError = requestsQuery.isError
    ? getApiErrorMessage(requestsQuery.error, intl.formatMessage({ id: "leave.calendar.loadError" }))
    : holidaysQuery.isError
      ? getApiErrorMessage(holidaysQuery.error, intl.formatMessage({ id: "leave.calendar.loadError" }))
      : null;
  const truncated = (requestsQuery.data?.total ?? 0) > (requestsQuery.data?.items.length ?? 0);
  const gridTemplate = `minmax(160px, 220px) repeat(${daysInMonth}, minmax(24px, 1fr))`;
  const monthHolidays = [...holidaysByDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" size="sm" className="h-7" aria-label={intl.formatMessage({ id: "leave.calendar.prevMonth" })} onClick={() => setMonth(shiftMonth(year, month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex flex-col gap-1">
          <Label htmlFor="leave-calendar-month">{intl.formatMessage({ id: "leave.field.month" })}</Label>
          <Input id="leave-calendar-month" type="month" className="w-40" value={monthKey} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" className="h-7" aria-label={intl.formatMessage({ id: "leave.calendar.nextMonth" })} onClick={() => setMonth(shiftMonth(year, month, 1))}>
          <ChevronRight className="size-4" />
        </Button>
        <span className="ml-2 pb-1 text-sm font-medium capitalize">{monthLabel}</span>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {truncated && (
        <Alert>
          <AlertDescription>
            {intl.formatMessage({ id: "leave.calendar.truncated" }, { shown: requestsQuery.data?.items.length ?? 0, total: requestsQuery.data?.total ?? 0 })}
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-md border">
        <div className="min-w-max text-[12px] [font-variant-numeric:tabular-nums]" style={{ display: "grid", gridTemplateColumns: gridTemplate }}>
          <div className="sticky left-0 z-10 border-b bg-background px-2 py-1 font-medium text-muted-foreground">
            {intl.formatMessage({ id: "leave.field.employee" })}
          </div>
          {days.map((d) => {
            const holiday = holidaysByDate.get(d.iso);
            return (
              <div
                key={d.iso}
                title={holiday}
                className={cn(
                  "flex flex-col items-center border-b border-l py-0.5 leading-tight",
                  d.weekend && "bg-muted text-muted-foreground",
                  holiday && "bg-warning text-warning-foreground font-semibold",
                )}
              >
                <span className="text-[10px]">{weekdayFormatter.format(new Date(year, month - 1, d.day))}</span>
                <span>{d.day}</span>
              </div>
            );
          })}

          {employeeRows.length === 0 && !requestsQuery.isPending && (
            <div className="px-2 py-3 text-muted-foreground" style={{ gridColumn: `1 / span ${daysInMonth + 1}` }}>
              {intl.formatMessage({ id: "leave.calendar.empty" })}
            </div>
          )}
          {requestsQuery.isPending && (
            <div className="px-2 py-3 text-muted-foreground" style={{ gridColumn: `1 / span ${daysInMonth + 1}` }}>
              {intl.formatMessage({ id: "common.loading" })}
            </div>
          )}

          {employeeRows.map((employee) => (
            <div key={employee.id} className="contents" data-testid="leave-calendar-row">
              <div className="sticky left-0 z-10 flex h-[26px] items-center truncate border-b bg-background px-2" title={employee.name}>
                {employee.name}
              </div>
              {days.map((d) => {
                const request = employee.requests.find((r) => formatDate(r.startDate) <= d.iso && formatDate(r.endDate) >= d.iso);
                const holiday = holidaysByDate.get(d.iso);
                const nonWorking = d.weekend || !!holiday;
                return (
                  <div
                    key={d.iso}
                    className={cn(
                      "flex h-[26px] items-center justify-center border-b border-l text-[10px]",
                      d.weekend && "bg-muted",
                      holiday && "bg-warning/60",
                    )}
                    title={
                      request
                        ? `${request.leaveTypeName} · ${formatDate(request.startDate)} → ${formatDate(request.endDate)}${holiday ? ` · ${holiday}` : ""}`
                        : holiday
                    }
                  >
                    {request && (
                      <span
                        className={cn(
                          "flex h-[18px] w-full items-center justify-center font-medium",
                          nonWorking ? "bg-info/50 text-info-foreground/70" : "bg-info text-info-foreground",
                        )}
                      >
                        {nonWorking ? "" : (typeCodes.get(request.leaveTypeId) ?? "•")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-medium">{intl.formatMessage({ id: "leave.calendar.holidaysThisMonth" })}</h3>
        {monthHolidays.length === 0 ? (
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "leave.calendar.noHolidays" })}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-xs">
            {monthHolidays.map(([iso, name]) => (
              <li key={iso} className="rounded-sm border border-warning-border bg-warning px-2 py-0.5 text-warning-foreground">
                <span className="tabular-nums font-semibold">{iso}</span> {name}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "leave.calendar.legend" })}</p>
      </div>
    </div>
  );
}
