import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { FloorResponse, SaveTableRequest, TableResponse } from "@pako/shared";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pencil, Plus, Printer, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosStores } from "@/hooks/usePos";
import { useUrlParam } from "@/hooks/useUrlParam";
import { TABLE_SHAPES, TableShape, tableShapeKey } from "@/lib/pos-enums";
import { printElement } from "@/lib/print";
import { cn } from "@/lib/utils";

// The designer's grid: positions and sizes are whole cells (the server accepts 1–20 per side).
const COLS = 24;
const ROWS = 16;
const CELL = 32;
const MAX_SIDE = 20;

const floorsKey = (companyId: string | null, storeId: string) => ["posFloors", companyId, storeId] as const;

// The public QR menu a table's code opens (route /menu/:token, outside the app shell).
const publicMenuUrl = (token: string) => `${window.location.origin}/menu/${token}`;

interface TableDraft {
  name: string;
  seats: string;
  shape: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
}

const draftFrom = (t: TableResponse): TableDraft => ({
  name: t.name, seats: String(t.seats), shape: t.shape, x: t.x, y: t.y, width: t.width, height: t.height, isActive: t.isActive,
});

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function Field({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

// docs/POS_PLAN.md §6.2 / P3: a store's floors and the tables on them, placed on a grid the till's
// floor plan draws; each table carries the QR code that opens the public menu.
export function PosFloors() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const canEdit = canApprove("pos");
  const queryClient = useQueryClient();
  const storesQuery = usePosStores();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const [storeParam, setStoreParam] = useUrlParam("store");
  const [floorParam, setFloorParam] = useUrlParam("floor");
  const storeId = stores.some((s) => s.id === storeParam) ? storeParam : stores.find((s) => s.isActive)?.id ?? stores[0]?.id ?? "";
  const store = stores.find((s) => s.id === storeId);
  const [editingFloor, setEditingFloor] = useState<FloorResponse | "new" | null>(null);
  const [showQr, setShowQr] = useState(false);

  const floorsQuery = useQuery({
    queryKey: floorsKey(activeCompanyId, storeId),
    queryFn: () => apiClient.listPosFloors(activeCompanyId as string, storeId),
    enabled: !!activeCompanyId && !!storeId,
  });
  const floors = useMemo(() => floorsQuery.data ?? [], [floorsQuery.data]);
  const floor = floors.find((f) => f.id === floorParam) ?? floors[0];

  const columns = useMemo<ColumnDef<FloorResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("pos.setup3.floor.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "sortOrder", header: t("pos.setup3.floor.order"), meta: { numeric: true } },
      { id: "tables", header: t("pos.setup3.floor.tables"), meta: { numeric: true }, cell: ({ row }) => row.original.tables.length },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  const refresh = () => queryClient.invalidateQueries({ queryKey: floorsKey(activeCompanyId, storeId) });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("pos.setup3.floors")}</CardTitle>
            <CardDescription>{t("pos.setup3.floors.description")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <Select
                aria-label={t("pos.register.store")}
                value={storeId}
                onValueChange={(v) => {
                  setStoreParam(v);
                  setFloorParam("");
                }}
                options={stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
              />
            </div>
            {canEdit && storeId && (
              <Button size="sm" onClick={() => setEditingFloor("new")}>
                <Plus className="size-4" />
                {t("pos.setup3.floor.new")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {stores.length === 0 && !storesQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t("pos.setup3.floors.noStore")}</p>
          ) : (
            <DataGrid
              gridId="pos-floors"
              columns={columns}
              data={floors}
              rowCount={floors.length}
              isLoading={!!storeId && floorsQuery.isPending}
              getRowId={(f) => f.id}
              getRowClassName={(f) => cn(f.id === floor?.id && "bg-accent", !f.isActive && "text-muted-foreground")}
              onRowClick={(f) => setFloorParam(f.id)}
              emptyMessage={t("pos.setup3.floors.empty")}
              manualFiltering={false}
              manualSorting={false}
              manualGrouping={false}
            />
          )}
          {floorsQuery.error && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription>{getApiErrorMessage(floorsQuery.error)}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {floor && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{floor.name}</CardTitle>
              <CardDescription>{t("pos.setup3.designer.description")}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setEditingFloor(floor)}>
                  <Pencil className="size-4" />
                  {t("pos.setup3.floor.edit")}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={floor.tables.length === 0} onClick={() => setShowQr(true)}>
                <QrCode className="size-4" />
                {t("pos.setup3.qr.print")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <FloorDesigner key={floor.id} floor={floor} canEdit={canEdit} onSaved={refresh} />
          </CardContent>
        </Card>
      )}

      {editingFloor && store && (
        <FloorDialog
          floor={editingFloor === "new" ? null : editingFloor}
          storeId={store.id}
          nextOrder={floors.length}
          onClose={() => setEditingFloor(null)}
          onSaved={async (saved) => {
            setEditingFloor(null);
            setFloorParam(saved.id);
            await refresh();
          }}
        />
      )}
      {showQr && floor && <QrSheetDialog floor={floor} storeName={store?.name ?? ""} onClose={() => setShowQr(false)} />}
    </div>
  );
}

function FloorDialog({ floor, storeId, nextOrder, onClose, onSaved }: {
  floor: FloorResponse | null;
  storeId: string;
  nextOrder: number;
  onClose: () => void;
  onSaved: (saved: FloorResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [name, setName] = useState(floor?.name ?? "");
  const [order, setOrder] = useState(String(floor?.sortOrder ?? nextOrder));
  const [isActive, setIsActive] = useState(floor?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { storeId: floor?.storeId ?? storeId, name: name.trim(), sortOrder: Number(order), isActive };
      return floor ? apiClient.updatePosFloor(activeCompanyId as string, floor.id, body) : apiClient.createPosFloor(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={floor ? floor.name : t("pos.setup3.floor.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field id="fl-name" label={t("pos.setup3.floor.name")}>
            <Input id="fl-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="fl-order" label={t("pos.setup3.floor.order")}>
            <Input id="fl-order" type="number" min={0} value={order} onChange={(e) => setOrder(e.target.value)} className="text-right tabular-nums" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function FloorDesigner({ floor, canEdit, onSaved }: { floor: FloorResponse; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<TableDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRenew, setConfirmRenew] = useState(false);
  const drag = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const table = floor.tables.find((x) => x.id === selected);

  function select(id: string | "new") {
    setError(null);
    setNotice(null);
    setConfirmRenew(false);
    setSelected(id);
    if (id === "new") {
      setDraft({ name: t("pos.setup3.table.defaultName", { n: floor.tables.length + 1 }), seats: "4", shape: TableShape.Square, x: 0, y: 0, width: 2, height: 2, isActive: true });
    } else {
      const found = floor.tables.find((x) => x.id === id);
      setDraft(found ? draftFrom(found) : null);
    }
  }

  const patch = (change: Partial<TableDraft>) => setDraft((d) => {
    if (!d) return d;
    const next = { ...d, ...change };
    next.width = clamp(next.width, 1, MAX_SIDE);
    next.height = clamp(next.height, 1, MAX_SIDE);
    next.x = Math.max(0, next.x);
    next.y = Math.max(0, next.y);
    return next;
  });

  const save = useMutation({
    mutationFn: () => {
      const d = draft as TableDraft;
      const body: SaveTableRequest = {
        floorId: floor.id, name: d.name.trim(), seats: Number(d.seats), shape: d.shape, x: d.x, y: d.y, width: d.width, height: d.height, isActive: d.isActive,
      };
      return selected === "new" || !selected
        ? apiClient.createPosTable(activeCompanyId as string, body)
        : apiClient.updatePosTable(activeCompanyId as string, selected, body);
    },
    onSuccess: async (saved) => {
      setSelected(saved.id);
      setDraft(draftFrom(saved));
      setNotice(t("pos.setup3.table.saved"));
      await onSaved();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  const renew = useMutation({
    mutationFn: () => apiClient.renewPosTableQr(activeCompanyId as string, selected as string),
    onSuccess: async () => {
      setConfirmRenew(false);
      setNotice(t("pos.setup3.qr.renewed"));
      await onSaved();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    save.mutate();
  }

  // Drag: whole cells from where the pointer went down; the save is explicit.
  function startDrag(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (!canEdit) return;
    if (selected !== id) select(id);
    const found = floor.tables.find((x) => x.id === id);
    const from = selected === id && draft ? draft : found ? draftFrom(found) : null;
    if (!from) return;
    drag.current = { pointerX: e.clientX, pointerY: e.clientY, x: from.x, y: from.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function moveDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = Math.round((e.clientX - d.pointerX) / CELL);
    const dy = Math.round((e.clientY - d.pointerY) / CELL);
    setDraft((cur) => (cur ? { ...cur, x: clamp(d.x + dx, 0, COLS - cur.width), y: clamp(d.y + dy, 0, ROWS - cur.height) } : cur));
  }
  function endDrag() {
    drag.current = null;
  }

  const shown = (tb: TableResponse) => (tb.id === selected && draft ? draft : draftFrom(tb));
  const cols = Math.max(COLS, ...floor.tables.map((tb) => tb.x + tb.width), draft ? draft.x + draft.width : 0);
  const rows = Math.max(ROWS, ...floor.tables.map((tb) => tb.y + tb.height), draft ? draft.y + draft.height : 0);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="overflow-auto rounded-md border">
        <div
          className="relative bg-muted/30"
          style={{
            width: cols * CELL,
            height: rows * CELL,
            backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
            backgroundSize: `${CELL}px ${CELL}px`,
          }}
          data-testid="floor-canvas"
        >
          {floor.tables.map((tb) => {
            const d = shown(tb);
            return (
              <button
                key={tb.id}
                type="button"
                aria-label={t("pos.setup3.table.select", { name: tb.name })}
                aria-pressed={tb.id === selected}
                onClick={() => tb.id !== selected && select(tb.id)}
                onPointerDown={(e) => startDrag(e, tb.id)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={cn(
                  "absolute flex touch-none select-none flex-col items-center justify-center border-2 bg-background text-xs",
                  d.shape === TableShape.Round ? "rounded-full" : "rounded-md",
                  tb.id === selected ? "border-primary ring-2 ring-primary/30" : "border-foreground/30",
                  !d.isActive && "border-dashed opacity-50",
                  canEdit && "cursor-move",
                )}
                style={{ left: d.x * CELL, top: d.y * CELL, width: d.width * CELL, height: d.height * CELL }}
              >
                <span className="font-medium">{d.name}</span>
                <span className="text-muted-foreground tabular-nums">{d.seats}</span>
              </button>
            );
          })}
          {selected === "new" && draft && (
            <div
              className={cn("absolute flex items-center justify-center border-2 border-dashed border-primary bg-primary/10 text-xs",
                draft.shape === TableShape.Round ? "rounded-full" : "rounded-md")}
              style={{ left: draft.x * CELL, top: draft.y * CELL, width: draft.width * CELL, height: draft.height * CELL }}
            >
              {draft.name}
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 lg:w-72">
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => select("new")}>
            <Plus className="size-4" />
            {t("pos.setup3.table.new")}
          </Button>
        )}
        {floor.tables.length === 0 && selected !== "new" && <p className="text-sm text-muted-foreground">{t("pos.setup3.tables.empty")}</p>}
        {!draft && floor.tables.length > 0 && <p className="text-sm text-muted-foreground">{t("pos.setup3.table.pick")}</p>}
        {draft && (
          <form className="flex flex-col gap-3" onSubmit={submit} aria-label={t("pos.setup3.table.editor")}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {notice && <p className="text-xs text-muted-foreground" role="status">{notice}</p>}
            <fieldset className="flex flex-col gap-3" disabled={!canEdit}>
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <Field id="tb-name" label={t("pos.setup3.table.name")}>
                  <Input id="tb-name" required maxLength={40} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                </Field>
                <Field id="tb-seats" label={t("pos.setup3.table.seats")}>
                  <Input id="tb-seats" type="number" min={0} max={100} value={draft.seats} onChange={(e) => patch({ seats: e.target.value })} className="text-right tabular-nums" />
                </Field>
              </div>
              <Field id="tb-shape" label={t("pos.setup3.table.shape")}>
                <Select
                  id="tb-shape"
                  value={String(draft.shape)}
                  onValueChange={(v) => patch({ shape: Number(v) })}
                  options={TABLE_SHAPES.map((s) => ({ value: String(s), label: t(`pos.setup3.table.shape.${tableShapeKey(s)}`) }))}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field id="tb-x" label={t("pos.setup3.table.x")}>
                  <Input id="tb-x" type="number" min={0} value={draft.x} onChange={(e) => patch({ x: Number(e.target.value) })} className="text-right tabular-nums" />
                </Field>
                <Field id="tb-y" label={t("pos.setup3.table.y")}>
                  <Input id="tb-y" type="number" min={0} value={draft.y} onChange={(e) => patch({ y: Number(e.target.value) })} className="text-right tabular-nums" />
                </Field>
                <Field id="tb-w" label={t("pos.setup3.table.width")}>
                  <Input id="tb-w" type="number" min={1} max={MAX_SIDE} value={draft.width} onChange={(e) => patch({ width: Number(e.target.value) })} className="text-right tabular-nums" />
                </Field>
                <Field id="tb-h" label={t("pos.setup3.table.height")}>
                  <Input id="tb-h" type="number" min={1} max={MAX_SIDE} value={draft.height} onChange={(e) => patch({ height: Number(e.target.value) })} className="text-right tabular-nums" />
                </Field>
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">{t("pos.setup3.table.move")}</span>
                <Button type="button" size="sm" variant="outline" aria-label={t("pos.setup3.table.move.left")} onClick={() => patch({ x: draft.x - 1 })}><ArrowLeft className="size-4" /></Button>
                <Button type="button" size="sm" variant="outline" aria-label={t("pos.setup3.table.move.up")} onClick={() => patch({ y: draft.y - 1 })}><ArrowUp className="size-4" /></Button>
                <Button type="button" size="sm" variant="outline" aria-label={t("pos.setup3.table.move.down")} onClick={() => patch({ y: draft.y + 1 })}><ArrowDown className="size-4" /></Button>
                <Button type="button" size="sm" variant="outline" aria-label={t("pos.setup3.table.move.right")} onClick={() => patch({ x: draft.x + 1 })}><ArrowRight className="size-4" /></Button>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => patch({ isActive: e.target.checked })} />
                {t("common.active")}
              </label>
            </fieldset>
            {canEdit && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setSelected(null); setDraft(null); }}>{t("common.cancel")}</Button>
                <Button type="submit" size="sm" disabled={save.isPending}>{t("pos.setup3.table.save")}</Button>
              </div>
            )}
            {table && canEdit && (
              <div className="flex flex-col gap-2 border-t pt-3">
                {!confirmRenew ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRenew(true)}>
                    <QrCode className="size-4" />
                    {t("pos.setup3.qr.renew")}
                  </Button>
                ) : (
                  <>
                    <p className="text-xs text-destructive">{t("pos.setup3.qr.renew.confirm")}</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRenew(false)}>{t("common.cancel")}</Button>
                      <Button type="button" size="sm" variant="destructive" disabled={renew.isPending} onClick={() => renew.mutate()}>
                        {t("pos.setup3.qr.renew")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

// One QR per table (active ones), each opening the public menu at that table.
function QrSheetDialog({ floor, storeName, onClose }: { floor: FloorResponse; storeName: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const sheet = useRef<HTMLDivElement>(null);
  const tables = useMemo(() => floor.tables.filter((tb) => tb.isActive), [floor.tables]);
  const [codes, setCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    Promise.all(tables.map(async (tb) => [tb.id, await QRCode.toDataURL(publicMenuUrl(tb.qrToken), { margin: 1, width: 220, errorCorrectionLevel: "M" })] as const))
      .then((pairs) => alive && setCodes(Object.fromEntries(pairs)))
      .catch(() => alive && setCodes({}));
    return () => {
      alive = false;
    };
  }, [tables]);

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("pos.setup3.qr.title", { floor: floor.name })} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("pos.setup3.qr.hint")}</p>
        <div ref={sheet} className="grid grid-cols-2 gap-4 bg-white p-2 text-black sm:grid-cols-3">
          {tables.map((tb) => (
            <div key={tb.id} className="flex break-inside-avoid flex-col items-center gap-1 rounded border border-black/30 p-3 text-center" data-testid="qr-card">
              <p className="text-sm font-semibold">{storeName}</p>
              <p className="text-lg font-bold">{tb.name}</p>
              {codes[tb.id] ? <img src={codes[tb.id]} alt={t("pos.setup3.qr.alt", { name: tb.name })} className="size-40" /> : <div className="size-40" />}
              <p className="text-xs">{t("pos.setup3.qr.scan")}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" onClick={() => sheet.current && printElement(sheet.current)}>
            <Printer className="size-4" />
            {t("pos.setup3.qr.printNow")}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}
