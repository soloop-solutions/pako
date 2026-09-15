import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { MemberResponse } from "@pako/shared";

import {
  getLockDates,
  grantLockException,
  listLockExceptions,
  revokeLockException,
  setHardLockDate,
  updateSoftLockDates,
} from "@/api/lock-dates-client";
import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { isCompanyAdminRole } from "@/lib/membership-enums";
import {
  HARD_LOCK_DATE_KEY,
  SOFT_LOCK_DATE_KEYS,
  lockDateExplanation,
  lockDateLabel,
  type LockDateSettings,
} from "@/lib/lock-dates";
import { ensureAccountsMockWorkerStarted } from "@/mocks/mockInit";
import { setLockDatesMockActive } from "@/mocks/lockDatesMockFlag";

interface LockDatesSettingsProps {
  companyId: string;
}

export function LockDatesSettings({ companyId }: LockDatesSettingsProps) {
  const intl = useIntl();
  const { auth } = useAuth();
  const queryClient = useQueryClient();

  // Mount-scoped mock, same discipline as ChartOfAccounts.tsx's F2 mock (see accountsMockFlag.ts /
  // lockDatesMockFlag.ts) — this mock only answers while this section is actually on screen. The
  // Service Worker registration itself (ensureAccountsMockWorkerStarted) is the one piece shared
  // with the F2 mock: there is only ever one Service Worker per page, so both mocks register
  // through the same call; which handler actually answers a given request is decided entirely by
  // each mock's own flag, read fresh at request-resolution time.
  const [mockReady, setMockReady] = useState(false);
  useEffect(() => {
    setLockDatesMockActive(true);
    let cancelled = false;
    void ensureAccountsMockWorkerStarted().then(() => {
      if (!cancelled) setMockReady(true);
    });
    return () => {
      cancelled = true;
      setMockReady(false);
      setLockDatesMockActive(false);
    };
  }, []);

  const lockDatesQueryKey = ["lockDates", companyId] as const;
  const exceptionsQueryKey = ["lockExceptions", companyId] as const;

  const lockDatesQuery = useQuery({
    queryKey: lockDatesQueryKey,
    queryFn: () => getLockDates(companyId),
    enabled: mockReady,
  });

  const exceptionsQuery = useQuery({
    queryKey: exceptionsQueryKey,
    queryFn: () => listLockExceptions(companyId),
    enabled: mockReady,
  });

  const membersQuery = useQuery({
    queryKey: ["members", "company", companyId],
    queryFn: () => apiClient.membersAll(companyId),
  });

  const members = membersQuery.data ?? [];
  const currentMembership = members.find((m: MemberResponse) => m.userId === auth?.userId);
  const isAdmin = currentMembership ? isCompanyAdminRole(currentMembership.role) : false;

  const settings = lockDatesQuery.data;

  const [softDates, setSoftDates] = useState<Record<(typeof SOFT_LOCK_DATE_KEYS)[number], string>>({
    accountingLockDate: "",
    taxLockDate: "",
    saleLockDate: "",
    purchaseLockDate: "",
  });
  const [softSaving, setSoftSaving] = useState(false);
  const [softError, setSoftError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setSoftDates({
      accountingLockDate: settings.accountingLockDate ?? "",
      taxLockDate: settings.taxLockDate ?? "",
      saleLockDate: settings.saleLockDate ?? "",
      purchaseLockDate: settings.purchaseLockDate ?? "",
    });
  }, [settings]);

  async function handleSaveSoftDates(event: FormEvent) {
    event.preventDefault();
    setSoftSaving(true);
    setSoftError(null);
    try {
      const updated = await updateSoftLockDates(companyId, {
        accountingLockDate: softDates.accountingLockDate || null,
        taxLockDate: softDates.taxLockDate || null,
        saleLockDate: softDates.saleLockDate || null,
        purchaseLockDate: softDates.purchaseLockDate || null,
      });
      queryClient.setQueryData<LockDateSettings>(lockDatesQueryKey, updated);
    } catch (err) {
      setSoftError(getApiErrorMessage(err, intl.formatMessage({ id: "lockDates.saveError" })));
    } finally {
      setSoftSaving(false);
    }
  }

  const [hardLockDraft, setHardLockDraft] = useState("");
  const [confirmingHardLock, setConfirmingHardLock] = useState(false);
  const [hardLockSaving, setHardLockSaving] = useState(false);
  const [hardLockError, setHardLockError] = useState<string | null>(null);

  async function handleConfirmHardLock() {
    if (!hardLockDraft) return;
    setHardLockSaving(true);
    setHardLockError(null);
    try {
      const updated = await setHardLockDate(companyId, hardLockDraft);
      queryClient.setQueryData<LockDateSettings>(lockDatesQueryKey, updated);
      setConfirmingHardLock(false);
    } catch (err) {
      setHardLockError(getApiErrorMessage(err, intl.formatMessage({ id: "lockDates.saveError" })));
    } finally {
      setHardLockSaving(false);
    }
  }

  const [exceptionMemberId, setExceptionMemberId] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionUntil, setExceptionUntil] = useState("");
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    if (!exceptionMemberId && members.length > 0) setExceptionMemberId(members[0].userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.length]);

  async function handleGrantException(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    const member = members.find((m: MemberResponse) => m.userId === exceptionMemberId);
    if (!member) return;
    setGranting(true);
    setGrantError(null);
    try {
      await grantLockException(companyId, {
        memberUserId: member.userId,
        memberEmail: member.email,
        reason: exceptionReason.trim(),
        until: exceptionUntil,
        grantedByEmail: auth.email,
      });
      setExceptionReason("");
      setExceptionUntil("");
      await queryClient.invalidateQueries({ queryKey: exceptionsQueryKey });
    } catch (err) {
      setGrantError(getApiErrorMessage(err, intl.formatMessage({ id: "lockDates.exceptions.grantError" })));
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(exceptionId: string) {
    setRevokingId(exceptionId);
    setRevokeError(null);
    try {
      await revokeLockException(companyId, exceptionId);
      await queryClient.invalidateQueries({ queryKey: exceptionsQueryKey });
    } catch (err) {
      setRevokeError(getApiErrorMessage(err, intl.formatMessage({ id: "lockDates.exceptions.revokeError" })));
    } finally {
      setRevokingId(null);
    }
  }

  if (!mockReady || lockDatesQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "lockDates.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "lockDates.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={handleSaveSoftDates}>
            {softError && (
              <Alert variant="destructive">
                <AlertDescription>{softError}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SOFT_LOCK_DATE_KEYS.map((key) => (
                <div key={key} className="flex flex-col gap-1">
                  <Label htmlFor={`lock-date-${key}`}>{lockDateLabel(key, intl)}</Label>
                  <Input
                    id={`lock-date-${key}`}
                    type="date"
                    value={softDates[key]}
                    onChange={(event) => setSoftDates((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">{lockDateExplanation(key, intl)}</p>
                </div>
              ))}
            </div>
            <div>
              <Button type="submit" disabled={softSaving}>
                {softSaving ? intl.formatMessage({ id: "common.saving" }) : intl.formatMessage({ id: "common.save" })}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{lockDateLabel(HARD_LOCK_DATE_KEY, intl)}</CardTitle>
          <CardDescription>{lockDateExplanation(HARD_LOCK_DATE_KEY, intl)}</CardDescription>
        </CardHeader>
        <CardContent>
          {hardLockError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{hardLockError}</AlertDescription>
            </Alert>
          )}
          {settings?.hardLockDate ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm">
                {intl.formatMessage({ id: "lockDates.hard.setTo" }, { date: settings.hardLockDate })}
              </p>
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "lockDates.hard.permanent" })}</p>
            </div>
          ) : confirmingHardLock ? (
            <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm font-medium text-destructive">{intl.formatMessage({ id: "lockDates.hard.confirmWarning" })}</p>
              <p className="text-sm">{intl.formatMessage({ id: "lockDates.hard.confirmDate" }, { date: hardLockDraft })}</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="destructive" disabled={hardLockSaving} onClick={handleConfirmHardLock}>
                  {hardLockSaving
                    ? intl.formatMessage({ id: "common.saving" })
                    : intl.formatMessage({ id: "lockDates.hard.confirmButton" })}
                </Button>
                <Button type="button" variant="outline" disabled={hardLockSaving} onClick={() => setConfirmingHardLock(false)}>
                  {intl.formatMessage({ id: "common.cancel" })}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="hard-lock-date">{lockDateLabel(HARD_LOCK_DATE_KEY, intl)}</Label>
                <Input
                  id="hard-lock-date"
                  type="date"
                  value={hardLockDraft}
                  onChange={(event) => setHardLockDraft(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="destructive"
                disabled={!hardLockDraft}
                onClick={() => setConfirmingHardLock(true)}
              >
                {intl.formatMessage({ id: "lockDates.hard.setButton" })}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "lockDates.exceptions.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "lockDates.exceptions.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {revokeError && (
              <Alert variant="destructive">
                <AlertDescription>{revokeError}</AlertDescription>
              </Alert>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.member" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.reason" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.until" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.grantedBy" })}</TableHead>
                  {isAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(exceptionsQuery.data ?? []).map((exception) => (
                  <TableRow key={exception.id}>
                    <TableCell>{exception.memberEmail}</TableCell>
                    <TableCell>{exception.reason}</TableCell>
                    <TableCell className="tabular-nums">{exception.until}</TableCell>
                    <TableCell>{exception.grantedByEmail}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs text-destructive"
                          disabled={revokingId === exception.id}
                          onClick={() => void handleRevoke(exception.id)}
                        >
                          {intl.formatMessage({ id: "lockDates.exceptions.revoke" })}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(exceptionsQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "lockDates.exceptions.none" })}</p>
            )}

            {isAdmin && members.length > 0 && (
              <form className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end" onSubmit={handleGrantException}>
                {grantError && (
                  <Alert variant="destructive" className="sm:basis-full">
                    <AlertDescription>{grantError}</AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-col gap-1">
                  <Label htmlFor="exception-member">{intl.formatMessage({ id: "lockDates.exceptions.member" })}</Label>
                  <Select
                    id="exception-member"
                    className="w-56"
                    value={exceptionMemberId}
                    onChange={(event) => setExceptionMemberId(event.target.value)}
                  >
                    {members.map((member: MemberResponse) => (
                      <option key={member.userId} value={member.userId}>
                        {member.email}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="exception-reason">{intl.formatMessage({ id: "lockDates.exceptions.reason" })}</Label>
                  <Input
                    id="exception-reason"
                    required
                    value={exceptionReason}
                    onChange={(event) => setExceptionReason(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="exception-until">{intl.formatMessage({ id: "lockDates.exceptions.until" })}</Label>
                  <Input
                    id="exception-until"
                    type="date"
                    required
                    value={exceptionUntil}
                    onChange={(event) => setExceptionUntil(event.target.value)}
                  />
                </div>
                <Button type="submit" disabled={granting}>
                  {granting
                    ? intl.formatMessage({ id: "common.saving" })
                    : intl.formatMessage({ id: "lockDates.exceptions.grant" })}
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
