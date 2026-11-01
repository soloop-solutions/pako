import { useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { MembershipResponse, PackageResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { MembershipState, membershipStateKey, packageUsable } from "@/lib/pos-services";
import { MembershipStatus } from "@/pages/pos/TillServices";

const PACKAGES_GRID = "pos-packages";
const MEMBERSHIPS_GRID = "pos-memberships";
const money = (v: number) => v.toFixed(2);

// docs/POS_PLAN.md §6.9 / P4: packages of sessions and memberships, sold at the till. Sessions,
// values and end dates are the server's. Freezing (Approve) moves the end date; resuming ends the
// freeze.
export function Memberships() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const packagesGrid = useDataGridUrlState(PACKAGES_GRID, 50);
  const membershipsGrid = useDataGridUrlState(MEMBERSHIPS_GRID, 50);
  const [editing, setEditing] = useState<MembershipResponse | null>(null);
  const [freezing, setFreezing] = useState<MembershipResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const packages = useQuery({
    queryKey: ["posPackages", activeCompanyId, packagesGrid.globalFilter],
    queryFn: () => apiClient.listPosPackages(activeCompanyId as string, packagesGrid.globalFilter || undefined),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const memberships = useQuery({
    queryKey: ["posMemberships", activeCompanyId, membershipsGrid.globalFilter],
    queryFn: () => apiClient.listPosMemberships(activeCompanyId as string, membershipsGrid.globalFilter || undefined),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const refreshMemberships = () => queryClient.invalidateQueries({ queryKey: ["posMemberships", activeCompanyId] });

  const resume = useMutation({
    mutationFn: (id: string) => apiClient.resumePosMembership(activeCompanyId as string, id),
    onSuccess: async () => {
      setError(null);
      await refreshMemberships();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  const packageColumns = useMemo<ColumnDef<PackageResponse>[]>(
    () => [
      { accessorKey: "number", header: t("svc.pkg.number"), cell: ({ getValue }) => <span className="tabular-nums">{getValue() as string}</span> },
      { accessorKey: "serviceName", header: t("svc.appt.service") },
      { id: "holder", header: t("svc.holder"), accessorFn: (p) => p.holderName ?? "—" },
      { id: "phone", header: t("svc.phone"), accessorFn: (p) => p.phone ?? "—" },
      { accessorKey: "sessionsTotal", header: t("svc.pkg.total"), meta: { numeric: true } },
      { accessorKey: "sessionsUsed", header: t("svc.pkg.used"), meta: { numeric: true } },
      { accessorKey: "sessionsLeft", header: t("svc.pkg.left"), meta: { numeric: true } },
      { accessorKey: "unitValue", header: t("svc.pkg.value"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      { id: "expiresOn", header: t("svc.pkg.expires"), accessorFn: (p) => p.expiresOn ?? "—" },
      {
        id: "status",
        header: t("svc.status"),
        accessorFn: (p) => (packageUsable(p) ? t("svc.pkg.usable") : t("svc.till.package.unusable")),
        cell: ({ row, getValue }) => <Badge variant={packageUsable(row.original) ? "default" : "secondary"}>{getValue() as string}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const membershipColumns = useMemo<ColumnDef<MembershipResponse>[]>(
    () => [
      { accessorKey: "number", header: t("svc.member.number"), cell: ({ getValue }) => <span className="tabular-nums">{getValue() as string}</span> },
      { accessorKey: "planName", header: t("svc.member.plan") },
      { id: "holder", header: t("svc.holder"), accessorFn: (m) => m.holderName ?? "—" },
      { id: "phone", header: t("svc.phone"), accessorFn: (m) => m.phone ?? "—" },
      { accessorKey: "startsOn", header: t("svc.member.startsOn") },
      { accessorKey: "endsOn", header: t("svc.member.endsOn") },
      { accessorKey: "frozenDays", header: t("svc.member.frozenDays"), meta: { numeric: true } },
      {
        id: "state",
        header: t("svc.status"),
        accessorFn: (m) => t(`svc.member.state.${membershipStateKey(m.state)}`),
        cell: ({ row, getValue }) => (
          <span className="flex items-center gap-1">
            <Badge variant={row.original.state === MembershipState.Active ? "default" : "secondary"}>{getValue() as string}</Badge>
            {row.original.activeToday ? (
              <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-400">{t("svc.member.today")}</Badge>
            ) : null}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <span className="flex justify-end gap-1">
              {canApprove("pos") && m.state === MembershipState.Active && (
                <Button size="xs" variant="outline" onClick={() => setFreezing(m)}>{t("svc.member.freeze")}</Button>
              )}
              {canWrite("pos") && m.state === MembershipState.Frozen && (
                <Button size="xs" variant="outline" disabled={resume.isPending} onClick={() => resume.mutate(m.id)}>{t("svc.member.resume")}</Button>
              )}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, resume.isPending],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const packageRows = packages.data ?? [];
  const membershipRows = memberships.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <CheckMemberCard />
      <Card>
        <CardHeader>
          <CardTitle>{t("svc.memberships")}</CardTitle>
          <CardDescription>{t("svc.memberships.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DataGrid
            gridId={MEMBERSHIPS_GRID}
            columns={membershipColumns}
            data={membershipRows}
            rowCount={membershipRows.length}
            isLoading={memberships.isPending}
            getRowId={(m) => m.id}
            getRowClassName={(m) => (m.state === MembershipState.Cancelled ? "text-muted-foreground line-through" : !m.activeToday ? "text-muted-foreground" : undefined)}
            onRowClick={canWrite("pos") ? setEditing : undefined}
            enableGlobalFilter
            globalFilterPlaceholder={t("svc.member.search")}
            emptyMessage={t("svc.member.empty")}
            exportFileName="memberships"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("svc.packages")}</CardTitle>
          <CardDescription>{t("svc.packages.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={PACKAGES_GRID}
            columns={packageColumns}
            data={packageRows}
            rowCount={packageRows.length}
            isLoading={packages.isPending}
            getRowId={(p) => p.id}
            getRowClassName={(p) => (packageUsable(p) ? undefined : "text-muted-foreground")}
            enableGlobalFilter
            globalFilterPlaceholder={t("svc.pkg.search")}
            emptyMessage={t("svc.pkg.empty")}
            exportFileName="packages"
          />
        </CardContent>
      </Card>
      {editing && (
        <HolderDialog
          membership={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refreshMemberships();
          }}
        />
      )}
      {freezing && (
        <FreezeDialog
          membership={freezing}
          onClose={() => setFreezing(null)}
          onSaved={async () => {
            setFreezing(null);
            await refreshMemberships();
          }}
        />
      )}
    </div>
  );
}

// The quick check at the front desk: type or scan the member number.
function CheckMemberCard() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [typed, setTyped] = useState("");
  const [number, setNumber] = useState<string | null>(null);
  const check = useQuery({
    queryKey: ["posMembership", activeCompanyId, number],
    queryFn: () => apiClient.checkPosMembership(activeCompanyId as string, number as string),
    enabled: !!activeCompanyId && !!number,
    retry: false,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("svc.member.checkTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex max-w-md items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) setNumber(typed.trim());
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="check-member">{t("svc.member.number")}</Label>
            <Input id="check-member" autoComplete="off" maxLength={40} value={typed} onChange={(e) => setTyped(e.target.value)} className="tabular-nums" />
          </div>
          <Button type="submit" disabled={!typed.trim()}>{t("svc.member.check")}</Button>
        </form>
        {number && check.error && <p className="text-sm text-destructive">{t("svc.member.notFound", { number })}</p>}
        {check.data && <MembershipStatus membership={check.data} />}
      </CardContent>
    </Card>
  );
}

function HolderDialog({ membership: m, onClose, onSaved }: { membership: MembershipResponse; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const customers = (useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []).filter((p) => p.isCustomer);
  const [holderName, setHolderName] = useState(m.holderName ?? "");
  const [phone, setPhone] = useState(m.phone ?? "");
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      apiClient.setPosMembershipHolder(activeCompanyId as string, m.id, {
        holderName: holderName.trim() || undefined, phone: phone.trim() || undefined, customerId: customerId || undefined,
      }),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }
  return (
    <FormDialog open onOpenChange={(open) => !open && !save.isPending && onClose()} title={`${m.number} · ${m.planName}`} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <MembershipStatus membership={m} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="holder-customer">{t("svc.appt.partner")}</Label>
          <SearchableSelect
            id="holder-customer"
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              const partner = customers.find((p) => p.id === v);
              if (partner && !holderName.trim()) setHolderName(partner.name);
            }}
            placeholder={t("svc.member.partner.keep")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("common.noResults")}
            emptyOptionLabel={t("svc.member.partner.keep")}
            options={customers.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="holder-name">{t("svc.holder")}</Label>
          <Input id="holder-name" maxLength={120} value={holderName} onChange={(e) => setHolderName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="holder-phone">{t("svc.phone")}</Label>
          <Input id="holder-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function FreezeDialog({ membership: m, onClose, onSaved }: { membership: MembershipResponse; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [days, setDays] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const freeze = useMutation({
    mutationFn: () => apiClient.freezePosMembership(activeCompanyId as string, m.id, { days: Number(days) }),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const valid = /^\d+$/.test(days.trim()) && Number(days) > 0;
  return (
    <FormDialog open onOpenChange={(open) => !open && !freeze.isPending && onClose()} title={t("svc.member.freezeTitle", { number: m.number })} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          freeze.mutate();
        }}
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Label htmlFor="freeze-days">{t("svc.member.freezeDays")}</Label>
        <Input id="freeze-days" type="number" min={1} max={365} step={1} autoFocus value={days} onChange={(e) => setDays(e.target.value)} className="text-right tabular-nums" />
        <p className="text-xs text-muted-foreground">{t("svc.member.freeze.hint", { date: m.endsOn })}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={freeze.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || freeze.isPending}>{t("svc.member.freeze")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
