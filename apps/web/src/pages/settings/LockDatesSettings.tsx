import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { MemberResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { isCompanyAdminRole } from "@/lib/membership-enums";
import {
  HARD_LOCK_DATE_KEY,
  LOCK_DATE_FIELD_VALUES,
  SOFT_LOCK_DATE_KEYS,
  lockDateExplanation,
  lockDateLabel,
  type SoftLockDateKey,
} from "@/lib/lock-dates";

interface LockDatesSettingsProps {
  companyId: string;
}

function endOfDayIso(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

export function LockDatesSettings({ companyId }: LockDatesSettingsProps) {
  const intl = useIntl();
  const { auth } = useAuth();
  const { companies, refresh: refreshCompanies } = useCompany();
  const queryClient = useQueryClient();

  const company = companies.find((c) => c.id === companyId) ?? null;

  const exceptionsQueryKey = ["lockExceptions", companyId] as const;
  const exceptionsQuery = useQuery({
    queryKey: exceptionsQueryKey,
    queryFn: () => apiClient.exceptionsAll(companyId),
  });

  const membersQuery = useQuery({
    queryKey: ["members", "company", companyId],
    queryFn: () => apiClient.membersAll(companyId),
  });

  const members = membersQuery.data ?? [];
  const currentMembership = members.find((m: MemberResponse) => m.userId === auth?.userId);
  const isAdmin = currentMembership ? isCompanyAdminRole(currentMembership.role) : false;

  function memberEmail(userId: string): string {
    return members.find((m: MemberResponse) => m.userId === userId)?.email ?? userId;
  }

  const [softDates, setSoftDates] = useState<Record<SoftLockDateKey, string>>({
    accountingLockDate: "",
    taxLockDate: "",
    saleLockDate: "",
    purchaseLockDate: "",
  });
  const [softSaving, setSoftSaving] = useState(false);
  const [softError, setSoftError] = useState<string | null>(null);

  useEffect(() => {
    if (!company) return;
    setSoftDates({
      accountingLockDate: company.accountingLockDate ?? "",
      taxLockDate: company.taxLockDate ?? "",
      saleLockDate: company.saleLockDate ?? "",
      purchaseLockDate: company.purchaseLockDate ?? "",
    });
  }, [company]);

  async function handleSaveSoftDates(event: FormEvent) {
    event.preventDefault();
    if (!company) return;
    setSoftSaving(true);
    setSoftError(null);
    try {
      // The real endpoint (PUT .../locks/soft) sets exactly one field per call — send only the
      // fields the accountant actually changed, in order, so a mid-save failure leaves the fields
      // that did succeed saved rather than silently reverted by an unsent request.
      for (const key of SOFT_LOCK_DATE_KEYS) {
        const original = company[key] ?? "";
        const next = softDates[key];
        if (next === original) continue;
        await apiClient.soft(companyId, { lockDateField: LOCK_DATE_FIELD_VALUES[key], lockDate: next || undefined });
      }
      await refreshCompanies();
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
      await apiClient.hard(companyId, { lockDate: hardLockDraft });
      await refreshCompanies();
      setConfirmingHardLock(false);
    } catch (err) {
      setHardLockError(getApiErrorMessage(err, intl.formatMessage({ id: "lockDates.saveError" })));
    } finally {
      setHardLockSaving(false);
    }
  }

  const [exceptionMemberId, setExceptionMemberId] = useState("");
  const [exceptionField, setExceptionField] = useState<SoftLockDateKey>(SOFT_LOCK_DATE_KEYS[0]);
  const [exceptionLockDate, setExceptionLockDate] = useState("");
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
    const member = members.find((m: MemberResponse) => m.userId === exceptionMemberId);
    if (!member || !exceptionLockDate || !exceptionUntil) return;
    setGranting(true);
    setGrantError(null);
    try {
      await apiClient.exceptions(companyId, {
        userId: member.userId,
        lockDateField: LOCK_DATE_FIELD_VALUES[exceptionField],
        lockDate: exceptionLockDate,
        reason: exceptionReason.trim(),
        endsAt: endOfDayIso(exceptionUntil),
      });
      setExceptionLockDate("");
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
      await apiClient.revoke(companyId, exceptionId);
      await queryClient.invalidateQueries({ queryKey: exceptionsQueryKey });
    } catch (err) {
      setRevokeError(getApiErrorMessage(err, intl.formatMessage({ id: "lockDates.exceptions.revokeError" })));
    } finally {
      setRevokingId(null);
    }
  }

  if (!company) {
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
          {company.hardLockDate ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm">
                {intl.formatMessage({ id: "lockDates.hard.setTo" }, { date: company.hardLockDate })}
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
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.lock" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.effectiveDate" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.reason" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.until" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.grantedBy" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "lockDates.exceptions.status" })}</TableHead>
                  {isAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(exceptionsQuery.data ?? []).map((exception) => {
                  const fieldKey = SOFT_LOCK_DATE_KEYS[exception.lockDateField] ?? SOFT_LOCK_DATE_KEYS[0];
                  const revoked = !!exception.revokedAt;
                  return (
                    <TableRow key={exception.id} className={!exception.isLive ? "text-muted-foreground" : undefined}>
                      <TableCell className={revoked ? "line-through" : undefined}>{memberEmail(exception.userId)}</TableCell>
                      <TableCell className={revoked ? "line-through" : undefined}>{lockDateLabel(fieldKey, intl)}</TableCell>
                      <TableCell className={`tabular-nums ${revoked ? "line-through" : ""}`}>{exception.lockDate}</TableCell>
                      <TableCell className={revoked ? "line-through" : undefined}>{exception.reason}</TableCell>
                      <TableCell className={`tabular-nums ${revoked ? "line-through" : ""}`}>{exception.endsAt.slice(0, 10)}</TableCell>
                      <TableCell className={revoked ? "line-through" : undefined}>{memberEmail(exception.grantedByUserId)}</TableCell>
                      <TableCell>
                        {exception.isLive ? (
                          <Badge variant="success">{intl.formatMessage({ id: "lockDates.exceptions.active" })}</Badge>
                        ) : revoked ? (
                          <Badge variant="cancelled">{intl.formatMessage({ id: "lockDates.exceptions.revoked" })}</Badge>
                        ) : (
                          <Badge variant="outline">{intl.formatMessage({ id: "lockDates.exceptions.expired" })}</Badge>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {exception.isLive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs text-destructive"
                              disabled={revokingId === exception.id}
                              onClick={() => void handleRevoke(exception.id)}
                            >
                              {intl.formatMessage({ id: "lockDates.exceptions.revoke" })}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {(exceptionsQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "lockDates.exceptions.none" })}</p>
            )}

            {isAdmin && members.length > 0 && (
              <form className="flex flex-col gap-3 border-t pt-4" onSubmit={handleGrantException}>
                {grantError && (
                  <Alert variant="destructive">
                    <AlertDescription>{grantError}</AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap items-end gap-3">
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
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="exception-field">{intl.formatMessage({ id: "lockDates.exceptions.lock" })}</Label>
                    <Select
                      id="exception-field"
                      className="w-40"
                      value={exceptionField}
                      onChange={(event) => setExceptionField(event.target.value as SoftLockDateKey)}
                    >
                      {SOFT_LOCK_DATE_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {lockDateLabel(key, intl)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="exception-lock-date">{intl.formatMessage({ id: "lockDates.exceptions.effectiveDate" })}</Label>
                    <Input
                      id="exception-lock-date"
                      type="date"
                      required
                      value={exceptionLockDate}
                      onChange={(event) => setExceptionLockDate(event.target.value)}
                    />
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
                </div>
                <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "lockDates.exceptions.effectiveDateHint" })}</p>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
