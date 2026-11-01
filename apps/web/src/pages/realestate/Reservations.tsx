import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReservationResponse } from "@pako/shared";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { usePropertyUnits, vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate } from "@/lib/sales-order-enums";
import { cn } from "@/lib/utils";
import { RESERVATION_STATES, ReservationState } from "@/lib/verticals-enums";
import { SaleContractDialog } from "@/pages/realestate/SaleContractDialog";
import { ErrorAlert, ReservationStateBadge, StateFilter } from "@/pages/verticals/shared";
import { amount, useT } from "@/pages/verticals/verticals-utils";

const GRID_ID = "unit-reservations";

// docs/ERP_VERTICALS_PLAN.md §2 — reservations (rezervime) of units, with the deposit (kapar) taken;
// an active one is turned into a sale contract or cancelled.
export function Reservations() {
  const intl = useIntl();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const [state, setState] = useUrlParam("state", String(ReservationState.Active), [`${GRID_ID}.page`]);
  const query = useQuery({
    queryKey: [...vxKeys.reservations(activeCompanyId), state],
    queryFn: () => apiClient.listUnitReservations(activeCompanyId as string, state === "" ? undefined : Number(state)),
    enabled: !!activeCompanyId,
  });
  const units = usePropertyUnits().data ?? [];
  const [selling, setSelling] = useState<ReservationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: (id: string) => apiClient.cancelUnitReservation(activeCompanyId as string, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: vxKeys.reservations(activeCompanyId) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.units(activeCompanyId) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.buildings(activeCompanyId) });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.reservation.cancelError"))),
  });

  const columns = useMemo<ColumnDef<ReservationResponse>[]>(
    () => [
      { accessorKey: "unitNumber", header: t("vx.unit.number") },
      { accessorKey: "partnerName", header: t("vx.reservation.customer") },
      { accessorKey: "date", header: t("common.date"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { accessorKey: "expiresOn", header: t("vx.reservation.expiresOn"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { accessorKey: "deposit", header: t("vx.reservation.deposit"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "state", header: t("vx.state"), cell: ({ getValue }) => <ReservationStateBadge state={getValue() as number} /> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (row.original.state === ReservationState.Active && canWrite("sales") ? (
          <span className="flex justify-end gap-1">
            <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); setSelling(row.original); }}>{t("vx.unit.sell")}</Button>
            <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); setError(null); cancel.mutate(row.original.id); }}>{t("vx.reservation.cancel")}</Button>
          </span>
        ) : null),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, canWrite],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const rows = query.data ?? [];
  const sellingUnit = selling ? units.find((u) => u.id === selling.unitId) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("vx.nav.reservations")}</CardTitle>
        <CardDescription>{t("vx.nav.reservations.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ErrorAlert error={error} />
        <StateFilter value={state} onChange={setState} states={RESERVATION_STATES} labelPrefix="vx.reservationState" label={t("vx.state")} />
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => cn(r.state === ReservationState.Cancelled && "line-through text-muted-foreground", r.state === ReservationState.Expired && "text-muted-foreground")}
          enableGlobalFilter
          globalFilterPlaceholder={t("vx.reservation.search")}
          emptyMessage={t("vx.reservation.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
      {selling && sellingUnit && (
        <SaleContractDialog unit={sellingUnit} reservation={{ id: selling.id, partnerId: selling.partnerId, partnerName: selling.partnerName }}
          onClose={() => setSelling(null)} onSaved={(c) => navigate(`/real-estate/contracts/${c.id}`)} />
      )}
    </Card>
  );
}
