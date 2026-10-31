import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PurchaseOrderResponse, SavePurchaseOrderRequest } from "@pako/shared";
import { ArrowLeft, FileText, PackageCheck, Plus, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";

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
import { PurchaseOrderState } from "@/lib/purchase-order-enums";
import { taxRatePercentLabel } from "@/lib/tax-enums";
import { ProgressBadge, PurchaseOrderStateBadge } from "@/pages/bills/PurchaseOrderBadges";
import { WarehouseField } from "@/pages/inventory/StockFields";

interface Line {
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxDefinitionId: string;
}

const emptyLine = (): Line => ({ itemId: "", description: "", quantity: "1", unitPrice: "", taxDefinitionId: "" });
const parse = (s: string) => Number(s.replace(",", "."));

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// docs/INVENTORY_PLAN.md §12 P5 — a purchase order: drafted, confirmed (numbered), billed in one or
// more bills that keep the link, then closed. Billed quantities come from the bills themselves.
export function PurchaseOrderDetail() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const isNew = id === "new";

  const orderQuery = useQuery({
    queryKey: ["purchaseOrder", activeCompanyId, id],
    queryFn: () => apiClient.getPurchaseOrder(activeCompanyId as string, id as string),
    enabled: !!activeCompanyId && !isNew && !!id,
  });
  const vendors = (useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []).filter((p) => p.isVendor);
  const taxes = (useQuery({
    queryKey: ["taxes", activeCompanyId],
    queryFn: () => apiClient.taxes(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []);
  const itemsQuery = useQuery({
    queryKey: ["items", activeCompanyId, "all"],
    queryFn: async () => (await apiClient.itemsGET(activeCompanyId as string, 1, 200, undefined, undefined)).items,
    enabled: !!activeCompanyId,
  });
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const itemOptions = useMemo(() => items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.unit })), [items]);
  // Purchase-side VAT codes only (scope Purchase or Both).
  const taxOptions = taxes.filter((tx) => tx.scope !== 0).map((tx) => ({ value: tx.id, label: taxRatePercentLabel(tx) }));

  const order = orderQuery.data;
  const [partnerId, setPartnerId] = useState("");
  const [date, setDate] = useState(isoToday());
  const [expectedDate, setExpectedDate] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [vendorReference, setVendorReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;
    setPartnerId(order.partnerId);
    setDate(order.date);
    setExpectedDate(order.expectedDate ?? "");
    setWarehouseId(order.warehouseId ?? "");
    setVendorReference(order.vendorReference ?? "");
    setNotes(order.notes ?? "");
    setLines(order.lines.map((l) => ({
      itemId: l.itemId ?? "", description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), taxDefinitionId: l.taxDefinitionId ?? "",
    })));
  }, [order]);

  const draft = isNew || order?.state === PurchaseOrderState.Draft;
  const editable = draft && canWrite("purchases");

  function request(): SavePurchaseOrderRequest {
    return {
      partnerId,
      date,
      expectedDate: expectedDate || undefined,
      warehouseId: warehouseId || undefined,
      vendorReference: vendorReference.trim() || undefined,
      notes: notes.trim() || undefined,
      lines: lines.filter((l) => l.itemId || l.description.trim()).map((l) => ({
        itemId: l.itemId || undefined,
        description: l.description.trim(),
        quantity: parse(l.quantity),
        unitPrice: l.unitPrice === "" ? 0 : parse(l.unitPrice),
        taxDefinitionId: l.taxDefinitionId || undefined,
      })),
    };
  }

  const refresh = async (saved: PurchaseOrderResponse) => {
    queryClient.setQueryData(["purchaseOrder", activeCompanyId, saved.id], saved);
    await queryClient.invalidateQueries({ queryKey: ["purchaseOrders", activeCompanyId] });
  };
  const fail = (fallback: string) => (err: unknown) => setError(getApiErrorMessage(err, t(fallback)));

  const save = useMutation({
    mutationFn: () => isNew
      ? apiClient.createPurchaseOrder(activeCompanyId as string, request())
      : apiClient.updatePurchaseOrder(activeCompanyId as string, id as string, request()),
    onSuccess: async (saved) => {
      setError(null);
      await refresh(saved);
      if (isNew) navigate(`/purchase-orders/${saved.id}`, { replace: true });
    },
    onError: fail("po.saveError"),
  });
  const confirm = useMutation({
    mutationFn: async () => {
      const saved = await apiClient.updatePurchaseOrder(activeCompanyId as string, id as string, request());
      return apiClient.confirmPurchaseOrder(activeCompanyId as string, saved.id);
    },
    onSuccess: async (saved) => { setError(null); await refresh(saved); },
    onError: fail("po.saveError"),
  });
  const close = useMutation({
    mutationFn: () => apiClient.closePurchaseOrder(activeCompanyId as string, id as string),
    onSuccess: async (saved) => { setError(null); await refresh(saved); },
    onError: fail("po.saveError"),
  });
  const cancel = useMutation({
    mutationFn: () => apiClient.cancelPurchaseOrder(activeCompanyId as string, id as string),
    onSuccess: async (saved) => { setError(null); await refresh(saved); },
    onError: fail("po.saveError"),
  });
  const remove = useMutation({
    mutationFn: () => apiClient.deletePurchaseOrder(activeCompanyId as string, id as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchaseOrders", activeCompanyId] });
      navigate("/purchase-orders");
    },
    onError: fail("po.saveError"),
  });
  // §12 P6: a draft receipt for what hasn't arrived yet, at the order's net price; it opens in
  // Stock documents to be counted and posted.
  const receive = useMutation({
    mutationFn: () => apiClient.createReceiptFromPurchaseOrder(activeCompanyId as string, id as string),
    onSuccess: (receiptId) => navigate(`/stock-documents/${receiptId}`),
    onError: fail("po.receiveError"),
  });
  // A draft bill for what hasn't been billed yet, each line linked back to its order line. The
  // bill is checked and posted on its own page; prices are the order's expected ones until then.
  const createBill = useMutation({
    mutationFn: () => {
      const remaining = (order?.lines ?? []).filter((l) => l.remaining > 0);
      const today = isoToday();
      return apiClient.billsPOST(activeCompanyId as string, {
        partnerId: order!.partnerId,
        vendorReference: undefined,
        issueDate: today,
        dueDate: today,
        warehouseId: order!.warehouseId,
        lines: remaining.map((l) => ({
          description: l.description || items.find((i) => i.id === l.itemId)?.name || "",
          quantity: l.remaining,
          unitPrice: l.unitPrice,
          taxDefinitionId: l.taxDefinitionId,
          expenseAccountId: undefined,
          itemId: l.itemId,
          purchaseOrderLineId: l.id,
        })),
      });
    },
    onSuccess: async (bill) => {
      await queryClient.invalidateQueries({ queryKey: ["purchaseOrder", activeCompanyId, id] });
      navigate(`/bills/${bill.id}`);
    },
    onError: fail("po.billError"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const setLine = (index: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  function pickItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setLine(index, {
      itemId,
      description: item?.name ?? lines[index].description,
      taxDefinitionId: lines[index].taxDefinitionId || taxes.find((tx) => tx.code === "B18")?.id || "",
    });
  }

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  if (!isNew && orderQuery.isPending) return <p className="text-muted-foreground">{t("platform.loading")}</p>;

  const confirmed = order?.state === PurchaseOrderState.Confirmed;
  const hasRemaining = (order?.lines ?? []).some((l) => l.remaining > 0);
  const qty = (v: number) => intl.formatNumber(v);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/purchase-orders")}>
          <ArrowLeft className="size-4" />
          {t("nav.purchaseOrders")}
        </Button>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {t("po.title")} {order?.number ?? ""}
              {order ? <PurchaseOrderStateBadge state={order.state} /> : <Badge variant="outline" className="italic">{t("po.state.0")}</Badge>}
              {order && order.state !== PurchaseOrderState.Draft && <ProgressBadge progress={order.progress} />}
            </CardTitle>
            <CardDescription>{t("po.description")}</CardDescription>
          </div>
          {confirmed && canWrite("purchases") && (
            <div className="flex flex-wrap gap-2">
              {canWrite("inventory") && (order?.lines ?? []).some((l) => (l.toReceive ?? 0) > 0 && l.itemId) && (
                <Button size="sm" variant="outline" disabled={receive.isPending} onClick={() => receive.mutate()}>
                  <PackageCheck className="size-4" />
                  {t("po.receive")}
                </Button>
              )}
              {hasRemaining && (
                <Button size="sm" disabled={createBill.isPending} onClick={() => createBill.mutate()}>
                  <FileText className="size-4" />
                  {t("po.createBill")}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={close.isPending} onClick={() => close.mutate()}>{t("po.close")}</Button>
              {order?.progress === "none" && order.bills.length === 0 && (
                <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("po.cancel")}</Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="po-vendor">{t("po.col.vendor")}</Label>
                <SearchableSelect id="po-vendor" value={partnerId} onChange={setPartnerId} disabled={!editable}
                  placeholder={t("po.pickVendor")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")}
                  options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="po-date">{t("po.col.date")}</Label>
                <Input id="po-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="po-expected">{t("po.col.expected")}</Label>
                <Input id="po-expected" type="date" value={expectedDate} disabled={!editable} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
              {editable ? (
                <WarehouseField id="po-warehouse" value={warehouseId} onChange={setWarehouseId} />
              ) : null}
              <div className="flex flex-col gap-1">
                <Label htmlFor="po-ref">{t("po.vendorReference")}</Label>
                <Input id="po-ref" value={vendorReference} disabled={!editable} onChange={(e) => setVendorReference(e.target.value)} />
              </div>
            </div>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("stock.doc.lines")}</h3>
              {lines.map((line, index) => {
                const saved = !draft ? order?.lines[index] : undefined;
                return (
                  <div key={index} className="grid grid-cols-[minmax(10rem,1.5fr)_minmax(10rem,2fr)_6rem_7rem_8rem_auto] items-end gap-2">
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("stock.col.item")}</Label>}
                      <SearchableSelect value={line.itemId} onChange={(v) => pickItem(index, v)} disabled={!editable}
                        aria-label={t("stock.col.item")} placeholder={t("stock.doc.pickItem")} searchPlaceholder={t("common.search")}
                        noResultsText={t("common.noResults")} options={itemOptions} />
                    </div>
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("po.col.description")}</Label>}
                      <Input value={line.description} disabled={!editable} aria-label={t("po.col.description")}
                        onChange={(e) => setLine(index, { description: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("stock.col.quantity")}</Label>}
                      <Input inputMode="decimal" className="text-right tnum" value={line.quantity} disabled={!editable}
                        aria-label={t("stock.col.quantity")} onChange={(e) => setLine(index, { quantity: e.target.value })} />
                      {saved && (
                        <span className={saved.overBilled ? "text-[11px] font-semibold text-destructive tnum" : "text-[11px] text-muted-foreground tnum"}>
                          {t(saved.overBilled ? "po.line.overBilled" : "po.line.billed", {
                            billed: qty(saved.billed), remaining: qty(saved.remaining), drafts: qty(saved.inDraftBills),
                          })}
                          {(saved.received ?? 0) > 0 && ` · ${t("po.line.received", { received: qty(saved.received ?? 0) })}`}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("po.col.price")}</Label>}
                      <Input inputMode="decimal" className="text-right tnum" value={line.unitPrice} disabled={!editable}
                        aria-label={t("po.col.price")} onChange={(e) => setLine(index, { unitPrice: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("po.col.vat")}</Label>}
                      <Select value={line.taxDefinitionId} disabled={!editable} onValueChange={(v) => setLine(index, { taxDefinitionId: v })}
                        aria-label={t("po.col.vat")} options={[{ value: "", label: "—" }, ...taxOptions]} />
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
              {editable && (
                <Button type="button" size="xs" variant="ghost" className="w-fit" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                  <Plus className="size-3.5" />
                  {t("stock.doc.addLine")}
                </Button>
              )}
            </section>

            <div className="flex flex-col gap-1">
              <Label htmlFor="po-notes">{t("stock.doc.notes")}</Label>
              <Textarea id="po-notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {order && order.bills.length > 0 && (
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">{t("po.bills")}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {order.bills.map((b) => (
                    <li key={b.billId}>
                      <Link className="underline underline-offset-2" to={`/bills/${b.billId}`}>
                        {intl.formatDate(new Date(`${b.issueDate}T00:00`), { dateStyle: "medium" })} · {b.vendorReference ?? t("po.billNoReference")}
                      </Link>{" "}
                      <span className="text-muted-foreground">({t(`po.billState.${b.state}`)})</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {editable && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                {!isNew && (
                  <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("po.delete")}</Button>
                )}
                <Button type="submit" variant="outline" disabled={save.isPending || !partnerId}>{t("stock.doc.saveDraft")}</Button>
                {!isNew && (
                  <Button type="button" disabled={confirm.isPending || !partnerId} onClick={() => confirm.mutate()}>{t("po.confirm")}</Button>
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
