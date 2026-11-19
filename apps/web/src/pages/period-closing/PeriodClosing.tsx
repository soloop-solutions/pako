import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { ChevronLeft, ChevronRight, Lock, LockOpen } from "lucide-react";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { monthLocksClient, type MonthLockResponse, type MonthLockEventResponse } from "@/api/month-locks-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";
import { isCompanyAdminRole } from "@/lib/membership-enums";
import { useConfirm } from "@/components/ui/confirm-context";

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SQ = [
  "Janar", "Shkurt", "Mars", "Prill", "Maj", "Qershor",
  "Korrik", "Gusht", "Shtator", "Tetor", "N\u00ebntor", "Dhjetor",
];

function monthName(month: number, locale: string): string {
  const names = locale.startsWith("sq") ? MONTHS_SQ : MONTHS_EN;
  return names[month - 1] ?? `Month ${month}`;
}

function actionLabel(action: number, intl: ReturnType<typeof useIntl>): string {
  return action === 0
    ? intl.formatMessage({ id: "periodClosing.action.locked" })
    : intl.formatMessage({ id: "periodClosing.action.unlocked" });
}

export function PeriodClosing() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [year, setYear] = useState(currentYear);
  const [error, setError] = useState<string | null>(null);

  // Unlock dialog state
  const [unlockTarget, setUnlockTarget] = useState<{ year: number; month: number } | null>(null);
  const [unlockReason, setUnlockReason] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const companyId = activeCompany?.id ?? "";

  const locksQueryKey = ["month-locks", companyId, year] as const;
  const locksQuery = useQuery({
    queryKey: locksQueryKey,
    queryFn: () => monthLocksClient.getYear(companyId, year),
    enabled: !!companyId,
  });

  const historyQueryKey = ["month-lock-history", companyId, year] as const;
  const historyQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: () => monthLocksClient.history(companyId, year, 1, 50),
    enabled: !!companyId,
  });

  // Check admin permission
  const membersQuery = useQuery({
    queryKey: ["members", "company", companyId],
    queryFn: () => apiClient.membersAll(companyId),
    enabled: !!companyId,
  });
  const currentMembership = (membersQuery.data ?? []).find((m) => m.userId === auth?.userId);
  const isAdmin = currentMembership ? isCompanyAdminRole(currentMembership.role) : false;

  const months: MonthLockResponse[] = locksQuery.data?.months ?? [];

  const lockMutation = useMutation({
    mutationFn: (monthNumbers: number[]) =>
      monthLocksClient.lock(companyId, year, monthNumbers),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: locksQueryKey });
      void queryClient.invalidateQueries({ queryKey: historyQueryKey });
      setError(null);
    },
    onError: (err) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "periodClosing.error" }))),
  });

  const unlockMutation = useMutation({
    mutationFn: (req: { year: number; month: number; reason: string }) =>
      monthLocksClient.unlock(companyId, req.year, req.month, req.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: locksQueryKey });
      void queryClient.invalidateQueries({ queryKey: historyQueryKey });
      setUnlockTarget(null);
      setUnlockReason("");
      setUnlockError(null);
    },
    onError: (err) =>
      setUnlockError(getApiErrorMessage(err, intl.formatMessage({ id: "periodClosing.error" }))),
  });

  function isPast(month: number): boolean {
    if (year < currentYear) return true;
    if (year === currentYear && month < currentMonth) return true;
    return false;
  }

  function isCurrent(month: number): boolean {
    return year === currentYear && month === currentMonth;
  }

  function isFuture(month: number): boolean {
    if (year > currentYear) return true;
    if (year === currentYear && month > currentMonth) return true;
    return false;
  }

  function handleMonthClick(ml: MonthLockResponse) {
    if (!isAdmin) return;
    if (isCurrent(ml.month) || isFuture(ml.month)) return;

    if (ml.isLocked) {
      setUnlockTarget({ year: ml.year, month: ml.month });
      setUnlockReason("");
      setUnlockError(null);
    } else {
      confirm(
        intl.formatMessage(
          { id: "periodClosing.confirmLock.description" },
          { month: monthName(ml.month, intl.locale), year: String(ml.year) },
        ),
        () => lockMutation.mutate([ml.month]),
      );
    }
  }

  function handleLockAllPast() {
    const unlocked = months.filter((m) => isPast(m.month) && !m.isLocked).map((m) => m.month);
    if (unlocked.length === 0) return;

    confirm(
      intl.formatMessage(
        { id: "periodClosing.confirmLockAll.description" },
        { count: String(unlocked.length), year: String(year) },
      ),
      () => lockMutation.mutate(unlocked),
    );
  }

  function handleUnlockSubmit(event: FormEvent) {
    event.preventDefault();
    if (!unlockTarget || !unlockReason.trim()) return;
    unlockMutation.mutate({
      year: unlockTarget.year,
      month: unlockTarget.month,
      reason: unlockReason.trim(),
    });
  }

  const unlockedPastCount = months.filter((m) => isPast(m.month) && !m.isLocked).length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{intl.formatMessage({ id: "periodClosing.title" })}</h1>
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "periodClosing.subtitle" })}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Year selector */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => setYear((y) => y - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[4rem] text-center text-lg font-medium tabular-nums">{year}</span>
        <Button variant="outline" size="icon" onClick={() => setYear((y) => y + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        {isAdmin && unlockedPastCount > 0 && (
          <Button onClick={handleLockAllPast} disabled={lockMutation.isPending}>
            {intl.formatMessage({ id: "periodClosing.lockAllPast" })}
          </Button>
        )}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-4 gap-3">
        {months.map((ml) => {
          const locked = ml.isLocked;
          const past = isPast(ml.month);
          const current = isCurrent(ml.month);
          const future = isFuture(ml.month);
          const clickable = isAdmin && past;

          return (
            <button
              type="button"
              key={ml.month}
              disabled={!clickable}
              onClick={() => handleMonthClick(ml)}
              className={[
                "flex flex-col items-center gap-1.5 rounded-lg border p-4 text-left transition-colors",
                locked
                  ? "border-border bg-muted"
                  : current
                    ? "border-primary/50 bg-primary/5"
                    : future
                      ? "border-border/50 bg-muted/30 opacity-50"
                      : "border-border bg-background",
                clickable ? "cursor-pointer hover:border-primary/60 hover:bg-primary/5" : "",
                !clickable ? "cursor-default" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {locked ? (
                <Lock className="h-5 w-5 text-muted-foreground" />
              ) : past ? (
                <LockOpen className="h-5 w-5 text-muted-foreground/50" />
              ) : (
                <div className="h-5 w-5" />
              )}
              <span className="text-sm font-medium">
                {monthName(ml.month, intl.locale)}
              </span>
              {locked ? (
                <>
                  <Badge variant="secondary" className="text-xs">
                    {intl.formatMessage({ id: "periodClosing.locked" })}
                  </Badge>
                  {ml.lockedAt && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {new Date(ml.lockedAt).toLocaleDateString(intl.locale)}
                    </span>
                  )}
                  {ml.lockedByEmail && (
                    <span className="max-w-full truncate text-[11px] text-muted-foreground">
                      {ml.lockedByEmail}
                    </span>
                  )}
                </>
              ) : current ? (
                <Badge variant="outline" className="text-xs">
                  {intl.formatMessage({ id: "periodClosing.current" })}
                </Badge>
              ) : future ? (
                <span className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: "periodClosing.future" })}
                </span>
              ) : (
                <Badge variant="outline" className="border-success/40 text-success-foreground text-xs">
                  {intl.formatMessage({ id: "periodClosing.open" })}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Unlock dialog (inline card, not a modal — stays on page for context) */}
      {unlockTarget && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">
              {intl.formatMessage(
                { id: "periodClosing.unlock.title" },
                { month: monthName(unlockTarget.month, intl.locale), year: String(unlockTarget.year) },
              )}
            </CardTitle>
            <CardDescription>{intl.formatMessage({ id: "periodClosing.unlock.description" })}</CardDescription>
          </CardHeader>
          <CardContent>
            {unlockError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{unlockError}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={handleUnlockSubmit} className="flex flex-col gap-3">
              <FormField
                label={intl.formatMessage({ id: "periodClosing.unlock.reason" })}
                htmlFor="unlock-reason"
                required
              >
                <Input
                  id="unlock-reason"
                  required
                  autoFocus
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  placeholder={intl.formatMessage({ id: "periodClosing.unlock.reasonPlaceholder" })}
                />
              </FormField>
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={unlockMutation.isPending || !unlockReason.trim()}
                >
                  {unlockMutation.isPending
                    ? intl.formatMessage({ id: "common.saving" })
                    : intl.formatMessage({ id: "periodClosing.unlock.confirm" })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setUnlockTarget(null)}
                  disabled={unlockMutation.isPending}
                >
                  {intl.formatMessage({ id: "common.cancel" })}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "periodClosing.history.title" })}</CardTitle>
        </CardHeader>
        <CardContent>
          {(historyQuery.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: "periodClosing.history.empty" })}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {(historyQuery.data?.items ?? []).map((event: MonthLockEventResponse) => (
                <div key={event.id} className="flex items-start gap-3 text-sm">
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                    {new Date(event.timestamp).toLocaleDateString(intl.locale)}
                  </span>
                  <div className="flex-1">
                    <span className="font-medium">
                      {monthName(event.month, intl.locale)} {event.year}
                    </span>{" "}
                    <span className={event.action === 0 ? "text-muted-foreground" : "text-destructive"}>
                      {actionLabel(event.action, intl)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {intl.formatMessage({ id: "periodClosing.history.by" })} {event.userEmail ?? event.userId}
                    </span>
                    {event.reason && (
                      <p className="mt-0.5 text-xs text-muted-foreground italic">
                        {intl.formatMessage({ id: "periodClosing.history.reason" })}: &ldquo;{event.reason}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!isAdmin && (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: "periodClosing.noPermission" })}
        </p>
      )}
    </div>
  );
}
