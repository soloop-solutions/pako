import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiException, type ItemResponse, type SalesOrderResponse, type SaveSalesOrderRequest } from "@pako/shared";
import { ArrowLeft, FileText, PackageCheck, Plus, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { PrintButton } from "@/components/shared/PrintButton";
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
import { usePartners } from "@/hooks/useDistribution";
import { useItemLookup } from "@/hooks/useItemLookup";
import { useMyAccess } from "@/hooks/useMyAccess";
import { baseQuantity } from "@/lib/item-units";
import { formatAmount } from "@/lib/payroll-enums";
import { SalesOrderState, formatIsoDate, isoToday } from "@/lib/sales-order-enums";
import { taxRatePercentLabel, taxesForSale } from "@/lib/tax-enums";
import { WarehouseField } from "@/pages/inventory/StockFields";
import { CreditStatusPanel } from "@/pages/sales/CreditStatusPanel";
import { SalesOrderStateBadge, SalesProgressBadge } from "@/pages/sales/SalesOrderBadges";
import { SalesOrderPrint } from "@/pages/sales/SalesOrderPrint";

interface Line {
  itemId: string;
  description: string;
  quantity: string;
  // The item's sales unit, or undefined for the base unit.
  unitName?: string;
  // VAT-inclusive, per the line's unit.
  unitPrice: string;
  discountPercent: string;
  taxDefinitionId: string;
  // Typed by hand: a later price lookup leaves it alone.
  manualPrice?: boolean;
  // Where the looked-up price came from (customer, warehouse, company list or the item) and the
  // volume tier that applied.
  priceSource?: string;
  tierMinQuantity?: number;
}

const emptyLine = (): Line => ({ itemId: "", description: "", quantity: "1", unitPrice: "", discountPercent: "0", taxDefinitionId: "" });
const parse = (s: string) => Number(s.replace(",", "."));

// docs/POS_PLAN.md P6 — a B2B sale: drafted, sent as a quote (OF-…), confirmed as an order (SO-…;
// refused over the credit limit or with overdue invoices unless Sales: Approve overrides with a
// reason), delivered with delivery notes and invoiced, then closed. Totals and VAT come from the API.
export function SalesOrderDetail() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId, activeCompany } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const isNew = id === "new";
  const printRef = useRef<HTMLDivElement>(null);

  const orderQuery = useQuery({
    queryKey: ["salesOrder", activeCompanyId, id],
    queryFn: () => apiClient.getSalesOrder(activeCompanyId as string, id as string),
    enabled: !!activeCompanyId && !isNew && !!id,
  });
  const customers = (usePartners().data ?? []).filter((p) => p.isCustomer);
  const taxes = taxesForSale(useQuery({
    queryKey: ["taxes", activeCompanyId],
    queryFn: () => apiClient.taxes(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []);
  const taxOptions = taxes.map((tx) => ({ value: tx.id, label: taxRatePercentLabel(tx) }));

  const order = orderQuery.data;
  const [partnerId, setPartnerId] = useState(params.get("partner") ?? "");
  const [date, setDate] = useState(isoToday());
  const [validUntil, setValidUntil] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [routeVisitId, setRouteVisitId] = useState(params.get("visit") ?? "");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [dirty, setDirty] = useState(isNew);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<{ message: string; reason: string; error?: string } | null>(null);

  const lookup = useItemLookup(lines.map((l) => l.itemId));
  const itemOptions = useMemo(() => {
    const options = lookup.search.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.unit }));
    const listed = new Set(options.map((o) => o.value));
    for (const l of order?.lines ?? [])
      if (l.itemId && !listed.has(l.itemId)) {
        listed.add(l.itemId);
        options.push({ value: l.itemId, label: l.description, description: "" });
      }
    return options;
  }, [lookup.search.items, order]);

  useEffect(() => {
    if (!order) return;
    setPartnerId(order.partnerId);
    setDate(order.date);
    setValidUntil(order.validUntil ?? "");
    setDeliveryDate(order.deliveryDate ?? "");
    setWarehouseId(order.warehouseId ?? "");
    setCustomerReference(order.customerReference ?? "");
    setDeliveryAddress(order.deliveryAddress ?? "");
    setNotes(order.notes ?? "");
    setRouteVisitId(order.routeVisitId ?? "");
    setLines(order.lines.map((l) => ({
      itemId: l.itemId ?? "", description: l.description, quantity: String(l.quantity), unitName: l.unitName ?? undefined,
      unitPrice: String(l.unitPrice), discountPercent: String(l.discountPercent), taxDefinitionId: l.taxDefinitionId ?? "", manualPrice: true,
    })));
    setDirty(false);
  }, [order]);

  const state = order?.state ?? SalesOrderState.Draft;
  const editable = (isNew || state === SalesOrderState.Draft || state === SalesOrderState.Quoted) && canWrite("sales");

  // Prices come from the server's price lists (the customer's list first, volume tiers by the
  // quantity in base units), per the line's unit. Lines whose price was typed by hand keep it.
  function resolve(targets: { index: number; line: Line }[], customerId: string, onDate = date, inWarehouse = warehouseId) {
    const wanted = targets.filter((x) => x.line.itemId && !x.line.manualPrice);
    if (wanted.length === 0 || !activeCompanyId) return;
    const quantities = wanted.map((x) => baseQuantity(lookup.find(x.line.itemId), x.line.unitName, parse(x.line.quantity) || 0));
    void apiClient.resolvePrices(activeCompanyId, wanted.map((x) => x.line.itemId), inWarehouse || undefined, onDate, customerId || undefined, quantities)
      .then((prices) => {
        setLines((current) => current.map((l, i) => {
          const pos = wanted.findIndex((x) => x.index === i);
          if (pos < 0) return l;
          const asked = wanted[pos].line;
          // The line changed while the price was on its way: a newer lookup will answer.
          if (l.itemId !== asked.itemId || l.unitName !== asked.unitName || l.quantity !== asked.quantity || l.manualPrice) return l;
          const resolved = prices[pos]?.itemId === asked.itemId ? prices[pos] : prices.find((p) => p.itemId === asked.itemId);
          if (!resolved) return l;
          const price = asked.unitName ? resolved.units?.find((u) => u.unitName === asked.unitName)?.price : resolved.price;
          if (price == null) return l;
          return { ...l, unitPrice: String(price), priceSource: resolved.source, tierMinQuantity: resolved.tierMinQuantity ?? undefined };
        }));
      })
      .catch(() => {
        // The price stays as it was; the user can type one.
      });
  }

  function touch() {
    setDirty(true);
    setError(null);
  }

  function changeLine(index: number, patch: Partial<Line>, reprice: boolean) {
    touch();
    const next = { ...lines[index], ...patch };
    setLines((ls) => ls.map((l, i) => (i === index ? next : l)));
    if (reprice) resolve([{ index, line: next }], partnerId);
  }

  function pickItem(index: number, itemId: string) {
    const item: ItemResponse | undefined = lookup.find(itemId);
    changeLine(index, {
      itemId,
      description: item?.name ?? lines[index].description,
      unitName: item?.salesUnit ?? undefined,
      unitPrice: "",
      manualPrice: false,
      priceSource: undefined,
      tierMinQuantity: undefined,
      taxDefinitionId: item?.defaultTaxDefinitionId ?? lines[index].taxDefinitionId,
    }, true);
  }

  function changePartner(next: string) {
    touch();
    setPartnerId(next);
    resolve(lines.map((line, index) => ({ index, line })), next);
  }

  function request(): SaveSalesOrderRequest {
    return {
      partnerId,
      date,
      validUntil: validUntil || undefined,
      deliveryDate: deliveryDate || undefined,
      warehouseId: warehouseId || undefined,
      customerReference: customerReference.trim() || undefined,
      deliveryAddress: deliveryAddress.trim() || undefined,
      notes: notes.trim() || undefined,
      routeVisitId: routeVisitId || undefined,
      lines: lines.filter((l) => l.itemId || l.description.trim()).map((l) => ({
        itemId: l.itemId || undefined,
        description: l.description.trim() || undefined,
        quantity: parse(l.quantity) || 0,
        unitPrice: l.unitPrice === "" ? 0 : parse(l.unitPrice),
        discountPercent: l.discountPercent === "" ? 0 : parse(l.discountPercent),
        taxDefinitionId: l.taxDefinitionId || undefined,
        unitName: l.unitName || undefined,
      })),
    };
  }

  const refresh = async (saved: SalesOrderResponse) => {
    queryClient.setQueryData(["salesOrder", activeCompanyId, saved.id], saved);
    await queryClient.invalidateQueries({ queryKey: ["salesOrders", activeCompanyId] });
    await queryClient.invalidateQueries({ queryKey: ["creditStatus", activeCompanyId] });
  };
  const fail = (fallback: string) => (err: unknown) => setError(getApiErrorMessage(err, t(fallback)));
  // Actions on a draft or quote save the latest edits first.
  const saveFirst = async () => (editable && dirty && !isNew
    ? apiClient.updateSalesOrder(activeCompanyId as string, id as string, request())
    : undefined);
  const done = async (saved: SalesOrderResponse) => {
    setError(null);
    setDirty(false);
    await refresh(saved);
  };

  const save = useMutation({
    mutationFn: () => isNew
      ? apiClient.createSalesOrder(activeCompanyId as string, request())
      : apiClient.updateSalesOrder(activeCompanyId as string, id as string, request()),
    onSuccess: async (saved) => {
      await done(saved);
      if (isNew) navigate(`/sales-orders/${saved.id}`, { replace: true });
    },
    onError: fail("so.saveError"),
  });
  const quote = useMutation({
    mutationFn: async () => {
      await saveFirst();
      return apiClient.quoteSalesOrder(activeCompanyId as string, id as string);
    },
    onSuccess: done,
    onError: fail("so.saveError"),
  });
  const reopen = useMutation({
    mutationFn: () => apiClient.reopenSalesOrder(activeCompanyId as string, id as string),
    onSuccess: done,
    onError: fail("so.saveError"),
  });
  const confirm = useMutation({
    mutationFn: async (overrideReason?: string) => {
      await saveFirst();
      return apiClient.confirmSalesOrder(activeCompanyId as string, id as string, { overrideReason });
    },
    onSuccess: async (saved) => {
      setOverride(null);
      await done(saved);
    },
    onError: (err: unknown, overrideReason) => {
      const message = getApiErrorMessage(err, t("so.confirmError"));
      if (overrideReason) {
        setOverride((o) => (o ? { ...o, error: message } : o));
        return;
      }
      // Refused (credit limit, overdue invoices, an expired quote): Sales: Approve may confirm it
      // anyway with a reason; anyone else sees why.
      if (err instanceof ApiException && err.status === 400 && canApprove("sales")) setOverride({ message, reason: "" });
      else setError(message);
    },
  });
  const close = useMutation({
    mutationFn: () => apiClient.closeSalesOrder(activeCompanyId as string, id as string),
    onSuccess: done,
    onError: fail("so.saveError"),
  });
  const cancel = useMutation({
    mutationFn: () => apiClient.cancelSalesOrder(activeCompanyId as string, id as string),
    onSuccess: done,
    onError: fail("so.saveError"),
  });
  const remove = useMutation({
    mutationFn: () => apiClient.deleteSalesOrder(activeCompanyId as string, id as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["salesOrders", activeCompanyId] });
      navigate("/sales-orders");
    },
    onError: fail("so.saveError"),
  });
  // A draft delivery note for the open stock-tracked quantities; checked and posted in Stock documents.
  const deliver = useMutation({
    mutationFn: () => apiClient.createDeliveryFromSalesOrder(activeCompanyId as string, id as string),
    onSuccess: (deliveryId) => navigate(`/stock-documents/${deliveryId}`),
    onError: fail("so.deliverError"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  if (!isNew && orderQuery.isPending) return <p className="text-muted-foreground">{t("platform.loading")}</p>;
  if (!isNew && !order) return <Alert variant="destructive"><AlertDescription>{t("so.loadError")}</AlertDescription></Alert>;

  const confirmed = state === SalesOrderState.Confirmed;
  const busy = save.isPending || quote.isPending || confirm.isPending || reopen.isPending;
  const canDeliver = confirmed && canWrite("inventory") && (order?.lines ?? []).some((l) => l.tracked && l.toDeliver > 0);
  const canInvoice = confirmed && canWrite("sales") && (order?.lines ?? []).some((l) => l.toInvoice > 0);
  const qty = (v: number) => intl.formatNumber(v);
  const number = order?.number ?? order?.quoteNumber;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/sales-orders")}>
          <ArrowLeft className="size-4" />
          {t("nav.salesOrders")}
        </Button>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {t(state >= SalesOrderState.Confirmed ? "so.title" : "so.quoteTitle")} {number ?? ""}
              <SalesOrderStateBadge state={state} />
              {order && state >= SalesOrderState.Confirmed && <SalesProgressBadge kind="delivery" progress={order.delivery} />}
              {order && state >= SalesOrderState.Confirmed && <SalesProgressBadge kind="invoicing" progress={order.invoicing} />}
            </CardTitle>
            <CardDescription>{t("so.description")}</CardDescription>
            {order?.number && order.quoteNumber && <p className="text-xs text-muted-foreground">{t("so.fromQuote", { quote: order.quoteNumber })}</p>}
            {order?.blockOverrideReason && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{t("so.overridden", { reason: order.blockOverrideReason })}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {order && <PrintButton contentRef={printRef} size="sm" label={t(state >= SalesOrderState.Confirmed ? "so.printOrder" : "so.printQuote")} />}
            {canDeliver && (
              <Button size="sm" variant="outline" disabled={deliver.isPending} onClick={() => deliver.mutate()}>
                <PackageCheck className="size-4" />
                {t("so.deliver")}
              </Button>
            )}
            {canInvoice && (
              <>
                <Button size="sm" onClick={() => navigate(`/invoicing?salesOrder=${id}`)}>
                  <FileText className="size-4" />
                  {t("so.invoiceDelivered")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate(`/invoicing?salesOrder=${id}&undelivered=1`)}>
                  <FileText className="size-4" />
                  {t("so.invoiceAll")}
                </Button>
              </>
            )}
            {confirmed && canWrite("sales") && (
              <Button size="sm" variant="outline" disabled={close.isPending} onClick={() => close.mutate()}>{t("so.close")}</Button>
            )}
            {order && canWrite("sales") && state <= SalesOrderState.Confirmed && order.documents.length === 0 && (
              <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("so.cancel")}</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <form className="flex min-w-0 flex-col gap-5" onSubmit={submit}>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <Label htmlFor="so-customer">{t("so.col.customer")}</Label>
                  <SearchableSelect id="so-customer" value={partnerId} onChange={changePartner} disabled={!editable}
                    placeholder={t("so.pickCustomer")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")}
                    options={customers.map((c) => ({ value: c.id, label: c.name, description: c.taxNumber ?? undefined }))} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="so-date">{t("so.col.date")}</Label>
                  <Input id="so-date" type="date" value={date} disabled={!editable} onChange={(e) => {
                    touch();
                    setDate(e.target.value);
                    resolve(lines.map((line, index) => ({ index, line })), partnerId, e.target.value);
                  }} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="so-valid">{t("so.validUntil")}</Label>
                  <Input id="so-valid" type="date" value={validUntil} disabled={!editable} onChange={(e) => { touch(); setValidUntil(e.target.value); }} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="so-delivery">{t("so.col.deliveryDate")}</Label>
                  <Input id="so-delivery" type="date" value={deliveryDate} disabled={!editable} onChange={(e) => { touch(); setDeliveryDate(e.target.value); }} />
                </div>
                {editable && (
                  <WarehouseField id="so-warehouse" value={warehouseId} onChange={(v) => {
                    touch();
                    setWarehouseId(v);
                    resolve(lines.map((line, index) => ({ index, line })), partnerId, date, v);
                  }} />
                )}
                <div className="flex flex-col gap-1">
                  <Label htmlFor="so-ref">{t("so.customerReference")}</Label>
                  <Input id="so-ref" value={customerReference} disabled={!editable} onChange={(e) => { touch(); setCustomerReference(e.target.value); }} />
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <Label htmlFor="so-address">{t("so.deliveryAddress")}</Label>
                  <Input id="so-address" value={deliveryAddress} disabled={!editable} onChange={(e) => { touch(); setDeliveryAddress(e.target.value); }} />
                </div>
              </div>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{t("stock.doc.lines")}</h3>
                <div className="overflow-x-auto">
                  <div className="flex min-w-[52rem] flex-col gap-2">
                    {lines.map((line, index) => {
                      const saved = !dirty ? order?.lines[index] : undefined;
                      const item = lookup.find(line.itemId);
                      const unitOptions = item?.salesUnit
                        ? [{ value: "", label: item.unit }, { value: item.salesUnit, label: `${item.salesUnit} (${qty(item.salesUnitFactor ?? 1)})` }]
                        : null;
                      return (
                        <div key={index} className="grid grid-cols-[minmax(11rem,1.4fr)_minmax(9rem,1.6fr)_5.5rem_6.5rem_7rem_4.5rem_8rem_6rem_auto] items-start gap-2">
                          <div className="flex flex-col gap-1">
                            {index === 0 && <Label>{t("stock.col.item")}</Label>}
                            <SearchableSelect value={line.itemId} onChange={(v) => pickItem(index, v)} disabled={!editable}
                              aria-label={t("stock.col.item")} placeholder={t("stock.doc.pickItem")} searchPlaceholder={t("common.search")}
                              noResultsText={t("common.noResults")} options={itemOptions} onSearchChange={lookup.search.onSearchChange} />
                          </div>
                          <div className="flex flex-col gap-1">
                            {index === 0 && <Label>{t("so.col.description")}</Label>}
                            <Input value={line.description} disabled={!editable} aria-label={t("so.col.description")}
                              onChange={(e) => changeLine(index, { description: e.target.value }, false)} />
                          </div>
                          <div className="flex flex-col gap-1">
                            {index === 0 && <Label>{t("stock.col.quantity")}</Label>}
                            <Input inputMode="decimal" className="text-right tnum" value={line.quantity} disabled={!editable}
                              aria-label={t("stock.col.quantity")} onChange={(e) => changeLine(index, { quantity: e.target.value }, true)} />
                          </div>
                          <div className="flex flex-col gap-1">
                            {index === 0 && <Label>{t("price.col.unit")}</Label>}
                            {unitOptions ? (
                              <Select value={line.unitName ?? ""} disabled={!editable} aria-label={t("price.col.unit")} options={unitOptions}
                                onValueChange={(v) => changeLine(index, { unitName: v || undefined, manualPrice: false }, true)} />
                            ) : (
                              <span className="flex h-9 items-center text-sm text-muted-foreground">{item?.unit ?? line.unitName ?? "—"}</span>
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            {index === 0 && <Label>{t("so.col.price")}</Label>}
                            <Input inputMode="decimal" className="text-right tnum" value={line.unitPrice} disabled={!editable}
                              aria-label={t("so.col.price")} onChange={(e) => changeLine(index, { unitPrice: e.target.value, manualPrice: true }, false)} />
                            {line.priceSource && !line.manualPrice && (
                              <span className="text-[11px] text-muted-foreground">
                                {t(`so.priceSource.${line.priceSource}`)}
                                {line.tierMinQuantity ? ` · ${t("so.priceTier", { qty: qty(line.tierMinQuantity) })}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            {index === 0 && <Label>{t("so.col.discount")}</Label>}
                            <Input inputMode="decimal" className="text-right tnum" value={line.discountPercent} disabled={!editable}
                              aria-label={t("so.col.discount")} onChange={(e) => changeLine(index, { discountPercent: e.target.value }, false)} />
                          </div>
                          <div className="flex flex-col gap-1">
                            {index === 0 && <Label>{t("so.col.vat")}</Label>}
                            <Select value={line.taxDefinitionId} disabled={!editable} aria-label={t("so.col.vat")}
                              onValueChange={(v) => changeLine(index, { taxDefinitionId: v }, false)} options={[{ value: "", label: "—" }, ...taxOptions]} />
                          </div>
                          <div className="flex flex-col gap-1">
                            {index === 0 && <Label className="justify-end">{t("so.col.gross")}</Label>}
                            <span className="flex h-9 items-center justify-end text-sm tnum">{saved ? formatAmount(saved.gross) : "—"}</span>
                          </div>
                          {editable ? (
                            <Button type="button" size="icon" variant="ghost" className="size-9" aria-label={t("dashboard.edit.remove")}
                              onClick={() => { touch(); setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== index) : [emptyLine()])); }}>
                              <X className="size-4" />
                            </Button>
                          ) : <span />}
                          {saved && state >= SalesOrderState.Confirmed && (
                            <p className="col-span-full -mt-1 text-[11px] text-muted-foreground tnum" data-testid={`so-line-progress-${index}`}>
                              {t("so.line.progress", {
                                delivered: qty(saved.delivered), invoiced: qty(saved.invoiced), toDeliver: qty(saved.toDeliver), toInvoice: qty(saved.toInvoice),
                              })}
                              {saved.invoicedDraft > 0 && ` · ${t("so.line.inDraft", { qty: qty(saved.invoicedDraft) })}`}
                              {!saved.tracked && ` · ${t("so.line.notTracked")}`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {editable && (
                  <Button type="button" size="xs" variant="ghost" className="w-fit" onClick={() => { touch(); setLines((ls) => [...ls, emptyLine()]); }}>
                    <Plus className="size-3.5" />
                    {t("stock.doc.addLine")}
                  </Button>
                )}
              </section>

              <div className="flex flex-col gap-1">
                <Label htmlFor="so-notes">{t("stock.doc.notes")}</Label>
                <Textarea id="so-notes" value={notes} disabled={!editable} onChange={(e) => { touch(); setNotes(e.target.value); }} />
              </div>

              {order && order.documents.length > 0 && (
                <section className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold">{t("so.documents")}</h3>
                  <ul className="flex flex-col gap-1 text-sm">
                    {order.documents.map((d) => (
                      <li key={`${d.kind}-${d.id}`}>
                        <Link className="underline underline-offset-2" to={d.kind === "delivery" ? `/stock-documents/${d.id}` : `/invoicing/${d.id}`}>
                          {t(`so.document.${d.kind}`)} {d.number ?? t("stock.doc.draftNumber")}
                        </Link>{" "}
                        <span className="text-muted-foreground">
                          · {formatIsoDate(intl, d.date)} · {intl.messages[`so.docState.${d.state}`] ? t(`so.docState.${d.state}`) : d.state}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {editable && (
                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  {order && state === SalesOrderState.Draft && !order.quoteNumber && (
                    <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("so.delete")}</Button>
                  )}
                  {state === SalesOrderState.Quoted && (
                    <Button type="button" variant="ghost" disabled={reopen.isPending || dirty} onClick={() => reopen.mutate()}>{t("so.reopen")}</Button>
                  )}
                  <Button type="submit" variant="outline" disabled={busy || !partnerId}>{t("stock.doc.saveDraft")}</Button>
                  {!isNew && state === SalesOrderState.Draft && (
                    <Button type="button" variant="outline" disabled={busy || !partnerId} onClick={() => quote.mutate()}>{t("so.quote")}</Button>
                  )}
                  {!isNew && (
                    <Button type="button" disabled={busy || !partnerId} onClick={() => confirm.mutate(undefined)}>{t("so.confirm")}</Button>
                  )}
                </div>
              )}
            </form>

            <aside className="flex flex-col gap-3">
              <section className="flex flex-col gap-1 rounded-md border p-3 text-sm" aria-label={t("so.totals")}>
                <h3 className="text-sm font-semibold">{t("so.totals")}</h3>
                {order && !dirty ? (
                  <dl className="flex flex-col gap-1">
                    <div className="flex justify-between"><dt className="text-muted-foreground">{t("so.net")}</dt><dd className="tnum">{formatAmount(order.net)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">{t("so.vat")}</dt><dd className="tnum">{formatAmount(order.vat)}</dd></div>
                    <div className="flex justify-between border-t pt-1 font-semibold"><dt>{t("so.total")}</dt><dd className="tnum" data-testid="so-total">{formatAmount(order.total)}</dd></div>
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("so.saveToSeeTotals")}</p>
                )}
              </section>
              <CreditStatusPanel partnerId={partnerId || undefined} />
              {routeVisitId && <Badge variant="info" className="w-fit">{t("so.fromVisit")}</Badge>}
            </aside>
          </div>
        </CardContent>
      </Card>

      {order && (
        <div className="sr-only" aria-hidden>
          <SalesOrderPrint ref={printRef} order={order} companyName={activeCompany?.name ?? ""} taxes={taxes} />
        </div>
      )}

      {override && (
        <FormDialog open onOpenChange={(open) => !open && setOverride(null)} title={t("so.override.title")} size="sm">
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); confirm.mutate(override.reason.trim()); }}>
            <Alert variant="destructive">
              <AlertDescription>{override.message}</AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">{t("so.override.hint")}</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="so-override-reason">{t("so.override.reason")}</Label>
              <Textarea id="so-override-reason" required maxLength={500} value={override.reason}
                onChange={(e) => setOverride({ ...override, reason: e.target.value })} />
            </div>
            {override.error && <p className="text-sm text-destructive">{override.error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOverride(null)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={confirm.isPending || !override.reason.trim()}>{t("so.override.confirm")}</Button>
            </div>
          </form>
        </FormDialog>
      )}
    </div>
  );
}
