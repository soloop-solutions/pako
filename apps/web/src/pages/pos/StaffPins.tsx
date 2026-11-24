import { useMemo, useState, type FormEvent } from "react";
import type { PosPinIssuedResponse, PosStaffPinResponse } from "@pako/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, Shuffle } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { SectionHeader } from "@/components/list/PageHeader";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";

const PIN_PATTERN = /^\d{4,8}$/;
const staffPinsKey = (companyId: string | null) => ["posStaffPins", companyId];

// User request 2026-11-24: the administrator gives each waiter or cashier a till PIN — a random
// one, or one they type — instead of every waiter logging in to set their own. Every employee is
// listed, with or without a login. PINs are stored hashed, so a new one is shown once, here.
export function StaffPinsCard() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<PosPinIssuedResponse[] | null>(null);
  const [typing, setTyping] = useState<PosStaffPinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: staffPinsKey(activeCompanyId),
    queryFn: () => apiClient.listPosStaffPins(companyId),
    enabled: !!activeCompanyId,
  });
  const rows = staff.data ?? [];
  const withoutPin = rows.filter((r) => !r.hasPin);

  // One request per person, in turn: the server checks each new PIN against everyone else's.
  const generate = useMutation({
    mutationFn: async (people: PosStaffPinResponse[]) => {
      const done: PosPinIssuedResponse[] = [];
      for (const person of people) done.push(await apiClient.setPosStaffPin(companyId, person.operatorId, {}));
      return done;
    },
    onMutate: () => setError(null),
    onSuccess: (done) => setIssued(done),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: staffPinsKey(activeCompanyId) }),
  });

  const columns = useMemo<ColumnDef<PosStaffPinResponse>[]>(
    () => [
      { accessorKey: "name", header: t("pos.staffPins.name") },
      {
        accessorKey: "email",
        header: t("pos.staffPins.login"),
        cell: ({ row }) =>
          row.original.hasLogin ? (row.original.email ?? "—") : <span className="text-muted-foreground">{t("pos.staffPins.tillOnly")}</span>,
      },
      {
        id: "pin",
        header: t("pos.staffPins.pin"),
        cell: ({ row }) =>
          row.original.hasPin ? (
            <Badge variant="outline" className="border-success-border bg-success text-success-foreground">{t("pos.staffPins.set")}</Badge>
          ) : (
            <Badge variant="secondary">{t("pos.staffPins.none")}</Badge>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title={t("pos.staffPins")}
          description={t("pos.staffPins.description")}
          actions={
            withoutPin.length > 0 ? (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={generate.isPending} onClick={() => generate.mutate(withoutPin)}>
                <Shuffle className="size-3.5" />
                {t("pos.staffPins.generateMissing", { count: withoutPin.length })}
              </Button>
            ) : undefined
          }
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataGrid
          gridId="pos-staff-pins"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={staff.isPending}
          getRowId={(r) => r.operatorId}
          emptyMessage={t("pos.staffPins.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
          rowActions={(person) => (
            <>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" disabled={generate.isPending} onClick={() => generate.mutate([person])}>
                <Shuffle className="size-3.5" />
                {t("pos.staffPins.generate")}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" onClick={() => setTyping(person)}>
                <KeyRound className="size-3.5" />
                {t("pos.staffPins.type")}
              </Button>
            </>
          )}
        />
      </CardContent>

      {issued && <IssuedPinsDialog issued={issued} onClose={() => setIssued(null)} />}
      {typing && (
        <TypePinDialog
          person={typing}
          onClose={() => setTyping(null)}
          onSaved={async (pin) => {
            setTyping(null);
            setIssued([pin]);
            await queryClient.invalidateQueries({ queryKey: staffPinsKey(activeCompanyId) });
          }}
        />
      )}
    </Card>
  );
}

function IssuedPinsDialog({ issued, onClose }: { issued: PosPinIssuedResponse[]; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("pos.staffPins.issued")} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("pos.staffPins.issued.hint")}</p>
        <ul className="flex flex-col divide-y rounded-md border" data-testid="issued-pins">
          {issued.map((p) => (
            <li key={p.operatorId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="truncate text-sm">{p.name}</span>
              <span className="font-mono text-lg font-semibold tracking-[0.3em] tabular-nums">{p.pin}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button autoFocus onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

function TypePinDialog({
  person,
  onClose,
  onSaved,
}: {
  person: PosStaffPinResponse;
  onClose: () => void;
  onSaved: (issued: PosPinIssuedResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiClient.setPosStaffPin(activeCompanyId as string, person.operatorId, { pin }),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const valid = PIN_PATTERN.test(pin);
  const mismatch = again !== "" && again !== pin;
  return (
    <FormDialog open onOpenChange={(open) => !open && !save.isPending && onClose()} title={t("pos.staffPins.type.title", { name: person.name })} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (valid && again === pin) save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">{t("rest.waiter.setPin.hint")}</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Label htmlFor="staff-pin">{t("rest.waiter.newPin")}</Label>
        <Input id="staff-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="tracking-[0.4em]" />
        <Label htmlFor="staff-pin-again">{t("rest.waiter.newPinAgain")}</Label>
        <Input id="staff-pin-again" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={again}
          aria-invalid={mismatch || undefined} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} className="tracking-[0.4em]" />
        {mismatch && <p className="text-sm text-destructive">{t("rest.waiter.pinMismatch")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || again !== pin || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
