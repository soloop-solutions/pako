import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveStockDocumentRequest, StockDocumentResponse } from "@pako/shared";
import { ArrowLeft, ClipboardList, Plus, X } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useWarehouses } from "@/hooks/useStock";
import { formatAmount } from "@/lib/payroll-enums";
import {
  StockDocumentState,
  StockDocumentType,
  WRITE_OFF_REASONS,
  needsAtkNotice,
  stockDocumentTypeKey,
  writeOffReasonKey,
} from "@/lib/stock-enums";

interface Line {
  itemId: string;
  quantity: string;
  unitCost: string;
  note: string;
  // Count only: the book quantity loaded from the count sheet, to compare against.
  bookQuantity?: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): Line => ({ itemId: "", quantity: "", unitCost: "", note: "" });
const parse = (s: string) => Number(s.replace(",", "."));

// docs/INVENTORY_PLAN.md — one screen for all four stock documents. A draft can be edited and
// discarded; posting (Inventory: Approve) numbers it, moves the stock and writes the ledger.
export function StockDocumentDetail() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const isNew = id === "new";
  const warehouses = (useWarehouses().data ?? []).filter((w) => w.isActive);

  const documentQuery = useQuery({
    queryKey: ["stockDocument", activeCompanyId, id],
    queryFn: () => apiClient.getStockDocument(activeCompanyId as string, id as string),
    enabled: !!activeCompanyId && !isNew && !!id,
  });
  const itemsQuery = useQuery({
    queryKey: ["items", activeCompanyId, "tracked"],
    queryFn: async () => (await apiClient.itemsGET(activeCompanyId as string, 1, 200, undefined, undefined)).items.filter((i) => i.trackInventory),
    enabled: !!activeCompanyId,
  });
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const document = documentQuery.data;
  const [type, setType] = useState<number>(Number(params.get("type") ?? StockDocumentType.Opening));
  const [date, setDate] = useState(today());
  const [warehouseId, setWarehouseId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [reason, setReason] = useState<number | "">("");
  const [atkNotice, setAtkNotice] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);

  // Fill the form from the loaded draft (once).
  useEffect(() => {
    if (!document) return;
    setType(document.type);
    setDate(document.date);
    setWarehouseId(document.warehouseId);
    setDestinationId(document.destinationWarehouseId ?? "");
    setReason(document.reason ?? "");
    setAtkNotice(document.atkNoticeDate ?? "");
    setNotes(document.notes ?? "");
    setLines(document.lines.map((l) => ({ itemId: l.itemId, quantity: String(l.quantity), unitCost: l.unitCost == null ? "" : String(l.unitCost), note: l.note ?? "" })));
  }, [document]);

  useEffect(() => {
    if (isNew && !warehouseId && warehouses.length > 0) setWarehouseId((warehouses.find((w) => w.isDefault) ?? warehouses[0]).id);
  }, [isNew, warehouseId, warehouses]);

  const posted = document?.state === StockDocumentState.Posted;
  const editable = !posted && canWrite("inventory");
  const typeKey = stockDocumentTypeKey(type);

  function request(): SaveStockDocumentRequest {
    return {
      type,
      date,
      warehouseId,
      destinationWarehouseId: type === StockDocumentType.Transfer ? destinationId || undefined : undefined,
      reason: type === StockDocumentType.WriteOff && reason !== "" ? reason : undefined,
      atkNoticeDate: type === StockDocumentType.WriteOff && atkNotice ? atkNotice : undefined,
      notes: notes.trim() || undefined,
      lines: lines.filter((l) => l.itemId).map((l) => ({
        itemId: l.itemId,
        quantity: parse(l.quantity),
        unitCost: type === StockDocumentType.Opening && l.unitCost !== "" ? parse(l.unitCost) : undefined,
        note: l.note.trim() || undefined,
      })),
    };
  }

  const refresh = async (saved: StockDocumentResponse) => {
    queryClient.setQueryData(["stockDocument", activeCompanyId, saved.id], saved);
    await queryClient.invalidateQueries({ queryKey: ["stockDocuments", activeCompanyId] });
    await queryClient.invalidateQueries({ queryKey: ["stockLevels", activeCompanyId] });
  };

  const save = useMutation({
    mutationFn: () => isNew
      ? apiClient.createStockDocument(activeCompanyId as string, request())
      : apiClient.updateStockDocument(activeCompanyId as string, id as string, request()),
    onSuccess: async (saved) => {
      setError(null);
      await refresh(saved);
      if (isNew) navigate(`/stock-documents/${saved.id}`, { replace: true });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.doc.saveError"))),
  });

  const post = useMutation({
    mutationFn: async () => {
      // Save the latest edits first, then post.
      const saved = await apiClient.updateStockDocument(activeCompanyId as string, id as string, request());
      return apiClient.postStockDocument(activeCompanyId as string, saved.id);
    },
    onSuccess: async (saved) => {
      setError(null);
      setConfirmPost(false);
      await refresh(saved);
      await queryClient.invalidateQueries({ queryKey: ["stockOnHand"] });
    },
    onError: (err: unknown) => {
      setConfirmPost(false);
      setError(getApiErrorMessage(err, t("stock.doc.postError")));
    },
  });

  const discard = useMutation({
    mutationFn: () => apiClient.discardStockDocument(activeCompanyId as string, id as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stockDocuments", activeCompanyId] });
      navigate("/stock-documents");
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.doc.saveError"))),
  });

  // Count: start from the book quantities of every stock item in the warehouse.
  const loadCountSheet = useMutation({
    mutationFn: () => apiClient.getCountSheet(activeCompanyId as string, warehouseId, date),
    onSuccess: (rows) => setLines(rows.map((r) => ({ itemId: r.itemId, quantity: String(r.bookQuantity), unitCost: "", note: "", bookQuantity: r.bookQuantity }))),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.doc.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const itemOptions = useMemo(() => items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.unit })), [items]);
  const setLine = (index: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  if (!isNew && documentQuery.isPending) return <p className="text-muted-foreground">{t("platform.loading")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/stock-documents")}>
          <ArrowLeft className="size-4" />
          {t("nav.stockDocuments")}
        </Button>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {t(`stock.doc.type.${typeKey}`)} {document?.number ?? ""}
              {posted ? <Badge variant="success">{t("stock.doc.posted")}</Badge> : <Badge variant="outline" className="italic">{t("stock.doc.draft")}</Badge>}
            </CardTitle>
            <CardDescription>{t(`stock.doc.type.${typeKey}.description`)}</CardDescription>
          </div>
          {posted && document && (
            <p className="text-sm text-muted-foreground tnum">{t("stock.doc.totalValue", { value: formatAmount(document.totalValue) })}</p>
          )}
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {document?.vatRepaymentDue && (
              <Alert>
                <AlertDescription>{t("stock.doc.vatRepayment")}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="sd-date">{t("stock.card.date")}</Label>
                <Input id="sd-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="sd-warehouse">{t(type === StockDocumentType.Transfer ? "stock.doc.from" : "stock.warehouse")}</Label>
                <Select id="sd-warehouse" value={warehouseId} disabled={!editable} onValueChange={setWarehouseId}
                  options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
              </div>
              {type === StockDocumentType.Transfer && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="sd-destination">{t("stock.doc.to")}</Label>
                  <Select id="sd-destination" value={destinationId} disabled={!editable} onValueChange={setDestinationId}
                    options={warehouses.filter((w) => w.id !== warehouseId).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
                </div>
              )}
              {type === StockDocumentType.WriteOff && (
                <>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sd-reason">{t("stock.doc.reason")}</Label>
                    <Select id="sd-reason" value={reason === "" ? "" : String(reason)} disabled={!editable} onValueChange={(v) => setReason(v === "" ? "" : Number(v))}
                      placeholder={t("stock.doc.reasonPlaceholder")}
                      options={WRITE_OFF_REASONS.map((r) => ({ value: String(r), label: t(`stock.reason.${writeOffReasonKey(r)}`) }))} />
                  </div>
                  {needsAtkNotice(reason === "" ? null : reason) && (
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="sd-atk">{t("stock.doc.atkNotice")}</Label>
                      <Input id="sd-atk" type="date" value={atkNotice} disabled={!editable} onChange={(e) => setAtkNotice(e.target.value)} />
                    </div>
                  )}
                </>
              )}
            </div>
            {type === StockDocumentType.WriteOff && reason !== "" && (
              <p className="text-xs text-muted-foreground">{t(`stock.reason.${writeOffReasonKey(reason)}.hint`)}</p>
            )}

            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t("stock.doc.lines")}</h3>
                {editable && type === StockDocumentType.Count && (
                  <Button type="button" size="xs" variant="outline" disabled={!warehouseId || loadCountSheet.isPending} onClick={() => loadCountSheet.mutate()}>
                    <ClipboardList className="size-3.5" />
                    {t("stock.doc.loadCountSheet")}
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {lines.map((line, index) => {
                  const postedLine = posted ? document?.lines.find((l) => l.itemId === line.itemId) : undefined;
                  return (
                    <div key={index} className="grid grid-cols-[minmax(12rem,2fr)_7rem_7rem_minmax(8rem,1fr)_auto] items-end gap-2">
                      <div className="flex flex-col gap-1">
                        {index === 0 && <Label>{t("stock.col.item")}</Label>}
                        <SearchableSelect value={line.itemId} onChange={(v) => setLine(index, { itemId: v })} disabled={!editable}
                          aria-label={t("stock.col.item")} placeholder={t("stock.doc.pickItem")} searchPlaceholder={t("common.search")}
                          noResultsText={t("stock.doc.noTrackedItems")} options={itemOptions} />
                      </div>
                      <div className="flex flex-col gap-1">
                        {index === 0 && <Label>{t(type === StockDocumentType.Count ? "stock.doc.counted" : "stock.col.quantity")}</Label>}
                        <Input inputMode="decimal" className="text-right tnum" value={line.quantity} disabled={!editable}
                          aria-label={t("stock.col.quantity")} onChange={(e) => setLine(index, { quantity: e.target.value })} />
                        {type === StockDocumentType.Count && (line.bookQuantity !== undefined || postedLine?.bookQuantity != null) && (
                          <span className="text-[11px] text-muted-foreground tnum">
                            {t("stock.doc.book", { qty: intl.formatNumber(postedLine?.bookQuantity ?? line.bookQuantity ?? 0) })}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {index === 0 && <Label>{t(type === StockDocumentType.Opening ? "stock.doc.unitCost" : "stock.col.value")}</Label>}
                        {type === StockDocumentType.Opening && !posted ? (
                          <Input inputMode="decimal" className="text-right tnum" value={line.unitCost} disabled={!editable}
                            aria-label={t("stock.doc.unitCost")} onChange={(e) => setLine(index, { unitCost: e.target.value })} />
                        ) : (
                          <span className="flex h-9 items-center justify-end text-sm tnum">{postedLine?.value != null ? formatAmount(postedLine.value) : "—"}</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {index === 0 && <Label>{t("stock.doc.note")}</Label>}
                        <Input value={line.note} disabled={!editable} aria-label={t("stock.doc.note")} onChange={(e) => setLine(index, { note: e.target.value })} />
                      </div>
                      {editable ? (
                        <Button type="button" size="icon" variant="ghost" className="size-9" aria-label={t("dashboard.edit.remove")}
                          onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== index) : [emptyLine()]))}>
                          <X className="size-4" />
                        </Button>
                      ) : <span />}
                    </div>
                  );
                })}
              </div>
              {editable && (
                <Button type="button" size="xs" variant="ghost" className="w-fit" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                  <Plus className="size-3.5" />
                  {t("stock.doc.addLine")}
                </Button>
              )}
            </section>

            <div className="flex flex-col gap-1">
              <Label htmlFor="sd-notes">{t("stock.doc.notes")}</Label>
              <Textarea id="sd-notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {editable && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                {!isNew && (
                  <Button type="button" variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate()}>
                    {t("stock.doc.discard")}
                  </Button>
                )}
                <Button type="submit" variant="outline" disabled={save.isPending}>
                  {t("stock.doc.saveDraft")}
                </Button>
                {!isNew && canApprove("inventory") && (
                  confirmPost ? (
                    <span className="flex items-center gap-2 text-sm">
                      {t("stock.doc.confirmPost")}
                      <Button type="button" variant="outline" onClick={() => setConfirmPost(false)}>{t("common.cancel")}</Button>
                      <Button type="button" disabled={post.isPending} onClick={() => post.mutate()}>{t("stock.doc.post")}</Button>
                    </span>
                  ) : (
                    <Button type="button" onClick={() => setConfirmPost(true)}>{t("stock.doc.post")}</Button>
                  )
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
