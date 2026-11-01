import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { GuestRegisterRow } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { usePosStores } from "@/hooks/usePos";
import { useUrlParam } from "@/hooks/useUrlParam";
import { ErrorAlert } from "@/pages/pos/hotel/hotel-shared";
import { isIsoDate, isoDate } from "@/pages/pos/hotel/hotel-utils";

const date = (v: string | undefined, format: (d: string) => string) => (v ? format(v) : "");

// docs/POS_PLAN.md §6.4 / P5: the register of guests who stayed in a period, with their documents
// — exported to Excel for the police report of foreign guests.
export function GuestRegister() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const stores = usePosStores().data ?? [];
  const now = new Date();
  const [storeParam, setStoreParam] = useUrlParam("store");
  const [from, setFrom] = useUrlParam("from", isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useUrlParam("to", isoDate(now));
  const [foreign, setForeign] = useUrlParam("foreign", "");
  const storeId = stores.some((s) => s.id === storeParam) ? storeParam : stores.find((s) => s.isActive)?.id ?? stores[0]?.id ?? "";
  const valid = isIsoDate(from) && isIsoDate(to) && to >= from;

  const report = useQuery({
    queryKey: ["posGuestRegister", activeCompanyId, storeId, from, to, foreign],
    queryFn: () => apiClient.getPosGuestRegister(activeCompanyId as string, storeId, from, to, foreign === "1"),
    enabled: !!activeCompanyId && !!storeId && valid,
    placeholderData: keepPreviousData,
  });
  const rows = report.data ?? [];

  const columns = useMemo<ColumnDef<GuestRegisterRow>[]>(
    () => [
      { accessorKey: "bookingNumber", header: t("hotel.booking.number") },
      { accessorKey: "roomNumber", header: t("hotel.room.number") },
      { id: "arrival", header: t("hotel.booking.arrival"), accessorFn: (r) => date(r.arrival, (d) => intl.formatDate(d)) },
      { id: "departure", header: t("hotel.booking.departure"), accessorFn: (r) => date(r.departure, (d) => intl.formatDate(d)) },
      { accessorKey: "fullName", header: t("hotel.guest.fullName") },
      { id: "nationality", header: t("hotel.guest.nationality"), accessorFn: (r) => r.nationality ?? "" },
      { id: "documentType", header: t("hotel.guest.documentType"), accessorFn: (r) => r.documentType ?? "" },
      { id: "documentNumber", header: t("hotel.guest.documentNumber"), accessorFn: (r) => r.documentNumber ?? "" },
      { id: "birthDate", header: t("hotel.guest.birthDate"), accessorFn: (r) => date(r.birthDate, (d) => intl.formatDate(d)) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("hotel.nav.guests")}</CardTitle>
        <CardDescription>{t("hotel.nav.guests.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-56 flex-col gap-1">
            <Label htmlFor="gr-store">{t("pos.register.store")}</Label>
            <Select id="gr-store" value={storeId} onValueChange={setStoreParam} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="gr-from">{t("hotel.period.from")}</Label>
            <Input id="gr-from" type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="gr-to">{t("hotel.period.to")}</Label>
            <Input id="gr-to" type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <Checkbox checked={foreign === "1"} onChange={(e) => setForeign(e.target.checked ? "1" : "")} />
            {t("hotel.guestRegister.foreignOnly")}
          </label>
        </div>
        {report.error && <ErrorAlert message={getApiErrorMessage(report.error, t("pos.report.loadError"))} />}
        <DataGrid
          gridId="pos-guest-register"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={report.isPending && !!storeId && valid}
          getRowId={(r, i) => `${r.bookingNumber}-${i}`}
          emptyMessage={t("hotel.guestRegister.empty")}
          exportFileName="guest-register"
          defaultPageSize={500}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}
