import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { RoomResponse, RoomTypeResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useItemLookup } from "@/hooks/useItemLookup";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosStores } from "@/hooks/usePos";
import { useUrlParam } from "@/hooks/useUrlParam";
import { roomStateKey } from "@/lib/pos-enums";
import { ErrorAlert, Field } from "@/pages/pos/hotel/hotel-shared";
import { money, roomTypesKey } from "@/pages/pos/hotel/hotel-utils";
import { ItemPicker } from "@/pages/pos/menuPickers";

interface RoomRow extends RoomResponse {
  typeName: string;
}

// docs/POS_PLAN.md §6.4 / P5: a store's room types (capacity, and the service item a night is
// sold as — its price is the rack rate) and its rooms. Pos: Approve.
export function HotelSetup() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const canEdit = canApprove("pos");
  const queryClient = useQueryClient();
  const storesQuery = usePosStores();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const [storeParam, setStoreParam] = useUrlParam("store");
  const storeId = stores.some((s) => s.id === storeParam) ? storeParam : stores.find((s) => s.isActive)?.id ?? stores[0]?.id ?? "";
  const [editingType, setEditingType] = useState<RoomTypeResponse | "new" | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);

  const typesQuery = useQuery({
    queryKey: roomTypesKey(activeCompanyId, storeId),
    queryFn: () => apiClient.listPosRoomTypes(activeCompanyId as string, storeId),
    enabled: !!activeCompanyId && !!storeId,
  });
  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const rooms = useMemo<RoomRow[]>(() => types.flatMap((x) => x.rooms.map((r) => ({ ...r, typeName: x.name }))), [types]);
  const lookup = useItemLookup(types.map((x) => x.rateItemId));
  const refresh = () => queryClient.invalidateQueries({ queryKey: roomTypesKey(activeCompanyId, storeId) });

  const typeColumns = useMemo<ColumnDef<RoomTypeResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("hotel.roomType.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "capacity", header: t("hotel.roomType.capacity"), meta: { numeric: true } },
      { id: "rateItem", header: t("hotel.roomType.rateItem"), accessorFn: (x) => lookup.find(x.rateItemId)?.name ?? "…" },
      { accessorKey: "rate", header: t("hotel.roomType.rate"), meta: { numeric: true }, cell: ({ getValue }) => (getValue() == null ? "—" : money(getValue() as number)) },
      { id: "rooms", header: t("hotel.roomType.rooms"), meta: { numeric: true }, accessorFn: (x) => x.rooms.length },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, lookup.search.items],
  );
  const roomColumns = useMemo<ColumnDef<RoomRow>[]>(
    () => [
      {
        accessorKey: "number",
        header: t("hotel.room.number"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{row.original.number}</span>
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "floor", header: t("hotel.room.floor"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "typeName", header: t("hotel.room.type") },
      { id: "state", header: t("hotel.room.state"), accessorFn: (r) => t(`hotel.roomState.${roomStateKey(r.state)}`) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("hotel.nav.setup")}</CardTitle>
            <CardDescription>{t("hotel.nav.setup.description")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex w-56 flex-col gap-1">
              <Label htmlFor="hotel-setup-store">{t("pos.register.store")}</Label>
              <Select id="hotel-setup-store" value={storeId} onValueChange={setStoreParam} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
            </div>
            {canEdit && storeId && (
              <Button size="sm" onClick={() => setEditingType("new")}>
                <Plus className="size-4" /> {t("hotel.roomType.new")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!canEdit && (
            <Alert>
              <AlertDescription>{t("hotel.setup.readOnly")}</AlertDescription>
            </Alert>
          )}
          {stores.length === 0 && !storesQuery.isPending && <p className="text-sm text-muted-foreground">{t("pos.setup3.floors.noStore")}</p>}
          <DataGrid
            gridId="pos-room-types"
            columns={typeColumns}
            data={types}
            rowCount={types.length}
            isLoading={typesQuery.isPending && !!storeId}
            getRowId={(x) => x.id}
            getRowClassName={(x) => (x.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canEdit ? setEditingType : undefined}
            emptyMessage={t("hotel.roomType.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("hotel.rooms")}</CardTitle>
            <CardDescription>{t("hotel.rooms.description")}</CardDescription>
          </div>
          {canEdit && types.length > 0 && (
            <Button size="sm" onClick={() => setAddingRoom(true)}>
              <Plus className="size-4" /> {t("hotel.room.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-rooms"
            columns={roomColumns}
            data={rooms}
            rowCount={rooms.length}
            isLoading={typesQuery.isPending && !!storeId}
            getRowId={(r) => r.id}
            getRowClassName={(r) => (r.isActive ? undefined : "text-muted-foreground line-through")}
            emptyMessage={t("hotel.room.empty")}
            exportFileName="rooms"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      {editingType && (
        <RoomTypeDialog
          storeId={storeId}
          type={editingType === "new" ? null : editingType}
          onClose={() => setEditingType(null)}
          onSaved={async () => {
            setEditingType(null);
            await refresh();
          }}
        />
      )}
      {addingRoom && (
        <RoomDialog
          types={types}
          onClose={() => setAddingRoom(false)}
          onSaved={async () => {
            setAddingRoom(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function RoomTypeDialog({ storeId, type, onClose, onSaved }: { storeId: string; type: RoomTypeResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [name, setName] = useState(type?.name ?? "");
  const [capacity, setCapacity] = useState(String(type?.capacity ?? 2));
  const [rateItemId, setRateItemId] = useState(type?.rateItemId ?? "");
  const [isActive, setIsActive] = useState(type?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const lookup = useItemLookup([rateItemId]);
  const save = useMutation({
    mutationFn: async () => {
      const body = { storeId: type?.storeId ?? storeId, name: name.trim(), capacity: Number(capacity), rateItemId, isActive };
      if (type) await apiClient.updatePosRoomType(activeCompanyId as string, type.id, body);
      else await apiClient.createPosRoomType(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const valid = !!name.trim() && /^\d{1,2}$/.test(capacity.trim()) && Number(capacity) >= 1 && !!rateItemId;
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={type ? type.name : t("hotel.roomType.new")} size="md">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (valid) save.mutate();
        }}
      >
        <ErrorAlert message={error} />
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field id="rt-name" label={t("hotel.roomType.name")}>
            <Input id="rt-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="rt-capacity" label={t("hotel.roomType.capacity")}>
            <Input id="rt-capacity" inputMode="numeric" className="text-right tabular-nums" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </div>
        <Field id="rt-rate-item" label={t("hotel.roomType.rateItem")}>
          <ItemPicker id="rt-rate-item" lookup={lookup} value={rateItemId} onChange={setRateItemId} label={t("hotel.roomType.rateItem")} />
        </Field>
        <p className="text-xs text-muted-foreground">{t("hotel.roomType.rateItem.hint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// Rooms are added here; the API has no endpoint to edit one yet (housekeeping state is set on the chart).
function RoomDialog({ types, onClose, onSaved }: { types: RoomTypeResponse[]; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [roomTypeId, setRoomTypeId] = useState(types.find((x) => x.isActive)?.id ?? types[0]?.id ?? "");
  const [number, setNumber] = useState("");
  const [floor, setFloor] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      apiClient.createPosRoom(activeCompanyId as string, { roomTypeId, number: number.trim(), floor: floor.trim() || undefined, isActive }),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const valid = !!roomTypeId && !!number.trim();
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={t("hotel.room.new")} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (valid) save.mutate();
        }}
      >
        <ErrorAlert message={error} />
        <Field id="room-type" label={t("hotel.room.type")}>
          <Select id="room-type" value={roomTypeId} onValueChange={setRoomTypeId} options={types.map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="room-number" label={t("hotel.room.number")}>
            <Input id="room-number" autoFocus maxLength={20} value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field id="room-floor" label={t("hotel.room.floor")}>
            <Input id="room-floor" maxLength={20} value={floor} onChange={(e) => setFloor(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
