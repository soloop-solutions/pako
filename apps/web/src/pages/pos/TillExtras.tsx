import { useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { CustomerOrderResponse, PosCatalogItemResponse, SerialLookupResponse } from "@pako/shared";
import { ApiException } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { CustomerOrderState, customerOrderKindKey, customerOrderStateKey, itemSerialStatusKey } from "@/lib/pos-enums";
import { cn } from "@/lib/utils";

const money = (v: number | undefined) => (v ?? 0).toFixed(2);

// docs/POS_PLAN.md P2 at the till: variants, serial numbers, warranty and customer orders.

// One tile stands for a template; picking it asks which variant (size, colour…). Typing or
// scanning a barcode narrows the list.
export function VariantPicker({ title, variants, onPick, onClose }: {
  title: string;
  variants: PosCatalogItemResponse[];
  onPick: (item: PosCatalogItemResponse) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [term, setTerm] = useState("");
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter((v) => (v.variantLabel ?? v.name).toLowerCase().includes(q) || v.barcodes.includes(term.trim()) || String(v.code) === q);
  }, [variants, term]);
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={title} description={t("till.variant.pick")} size="md">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (shown.length === 1) onPick(shown[0]);
        }}
      >
        <Input autoFocus aria-label={t("till.variant.filter")} placeholder={t("till.variant.filter")} value={term} onChange={(e) => setTerm(e.target.value)} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shown.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onPick(v)}
              disabled={v.price == null}
              className={cn("flex min-h-16 flex-col justify-between rounded-md border p-2 text-left hover:bg-accent", v.price == null && "opacity-50")}
            >
              <span className="text-sm font-medium">{v.variantLabel || v.name}</span>
              <span className="flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                <span>{v.barcodes[0] ?? `#${v.code}`}</span>
                <span className="text-sm font-semibold text-foreground">{v.price == null ? "—" : money(v.price)}</span>
              </span>
            </button>
          ))}
        </div>
        {shown.length === 0 && <p className="text-sm text-muted-foreground">{t("common.noResults")}</p>}
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// An item that tracks serials is sold one unit per line, with the unit's serial number (IMEI).
export function SerialPrompt({ item, taken, onSerial, onCancel }: {
  item: PosCatalogItemResponse;
  /** Serials already in the basket: the same unit can't be sold twice. */
  taken: string[];
  onSerial: (serial: string) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const [serial, setSerial] = useState("");
  const [error, setError] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    const value = serial.trim();
    if (!value) {
      setError(t("till.serial.required"));
      return;
    }
    if (taken.includes(value)) {
      setError(t("till.serial.duplicate", { serial: value }));
      return;
    }
    onSerial(value);
  }
  return (
    <FormDialog open onOpenChange={(open) => !open && onCancel()} title={t("till.serial.title", { item: item.name })} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Label htmlFor="till-serial">{t("till.serial.label")}</Label>
        <Input
          id="till-serial"
          autoFocus
          autoComplete="off"
          maxLength={60}
          value={serial}
          aria-invalid={!!error || undefined}
          onChange={(e) => {
            setSerial(e.target.value);
            setError(null);
          }}
          className="h-12 text-lg tabular-nums"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
          <Button type="submit">{t("till.add")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// What a serial number is: the item, whether it was sold and when, and whether it is still under warranty.
export function WarrantyDialog({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [serial, setSerial] = useState("");
  const lookup = useMutation({
    mutationFn: (value: string) => apiClient.lookupPosSerial(activeCompanyId as string, value),
  });
  const notFound = lookup.error instanceof ApiException && lookup.error.status === 404;
  const results: SerialLookupResponse[] = lookup.data ?? [];
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("till.warranty.title")} size="md">
      <div className="flex flex-col gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (serial.trim()) lookup.mutate(serial.trim());
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="till-warranty-serial">{t("till.serial.label")}</Label>
            <Input id="till-warranty-serial" autoFocus autoComplete="off" maxLength={60} value={serial} onChange={(e) => setSerial(e.target.value)} className="tabular-nums" />
          </div>
          <Button type="submit" disabled={lookup.isPending || !serial.trim()}>{t("till.warranty.find")}</Button>
        </form>
        {lookup.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {notFound ? t("till.warranty.notFound", { serial: lookup.variables ?? "" }) : getApiErrorMessage(lookup.error, t("till.saleError"))}
            </AlertDescription>
          </Alert>
        )}
        {lookup.isSuccess && results.length === 0 && (
          <Alert variant="destructive">
            <AlertDescription>{t("till.warranty.notFound", { serial: lookup.variables ?? "" })}</AlertDescription>
          </Alert>
        )}
        {results.map((r) => (
          <dl key={`${r.itemId}-${r.serial}`} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm" data-testid="serial-result">
            <dt className="text-muted-foreground">{t("till.warranty.item")}</dt>
            <dd className="font-medium">{r.itemName}</dd>
            <dt className="text-muted-foreground">{t("till.serial.label")}</dt>
            <dd className="tabular-nums">{r.serial}</dd>
            <dt className="text-muted-foreground">{t("till.warranty.status")}</dt>
            <dd>{t(`till.serial.status.${itemSerialStatusKey(r.status)}`)}</dd>
            <dt className="text-muted-foreground">{t("till.warranty.soldAt")}</dt>
            <dd className="tabular-nums">{r.soldAt ? `${intl.formatDate(r.soldAt)} ${intl.formatTime(r.soldAt)}` : "—"}</dd>
            <dt className="text-muted-foreground">{t("till.warranty.order")}</dt>
            <dd className="tabular-nums">{r.orderNumber ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("till.warranty.until")}</dt>
            <dd className="tabular-nums">{r.warrantyUntil ? intl.formatDate(r.warrantyUntil) : "—"}</dd>
            <dt className="text-muted-foreground">{t("till.warranty.under")}</dt>
            <dd>
              <Badge variant={r.underWarranty ? "default" : "secondary"}>{t(r.underWarranty ? "till.warranty.yes" : "till.warranty.no")}</Badge>
            </dd>
          </dl>
        ))}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

// Layaways and special orders at the till: take a deposit on one, or collect it (its lines go into
// the basket at their agreed prices, the deposits are offered as payment). Figures are the server's.
export function TillCustomerOrdersDialog({ onDeposit, onCollect, onClose }: {
  onDeposit: (order: CustomerOrderResponse, amount: number) => void;
  onCollect: (order: CustomerOrderResponse) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [state, setState] = useState<string>(String(CustomerOrderState.Open));
  const [search, setSearch] = useState("");
  const [depositFor, setDepositFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [invalid, setInvalid] = useState(false);
  const orders = useQuery({
    queryKey: ["customerOrders", activeCompanyId, "till", state, search.trim()],
    queryFn: () => apiClient.listCustomerOrders(activeCompanyId as string, Number(state), search.trim() || undefined, 1, 25),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  function submitDeposit(e: FormEvent, order: CustomerOrderResponse) {
    e.preventDefault();
    const typed = amount.trim();
    const value = Number(typed.replace(",", "."));
    if (!/^\d+([.,]\d{1,2})?$/.test(typed) || !(value > 0)) {
      setInvalid(true);
      return;
    }
    onDeposit(order, value);
  }

  const list = orders.data?.items ?? [];
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("till.customerOrders.title")} size="lg">
      <div className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
          <Select
            id="till-co-state"
            value={state}
            onValueChange={setState}
            options={[CustomerOrderState.Open, CustomerOrderState.Ready].map((s) => ({ value: String(s), label: t(`pos.customerOrder.state.${customerOrderStateKey(s)}`) }))}
          />
          <Input autoFocus aria-label={t("pos.customerOrder.search")} placeholder={t("pos.customerOrder.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {orders.error && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(orders.error, t("pos.customerOrder.loadError"))}</AlertDescription>
          </Alert>
        )}
        {!orders.isPending && list.length === 0 && <p className="text-sm text-muted-foreground">{t("pos.customerOrder.empty")}</p>}
        <ul className="divide-y rounded-md border text-sm">
          {list.map((o) => (
            <li key={o.id} className="flex flex-col gap-2 px-3 py-2" data-testid="till-customer-order">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {o.number} · {o.customerName}
                  <Badge variant="outline" className="ml-2">{t(`pos.customerOrder.kind.${customerOrderKindKey(o.kind)}`)}</Badge>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {t("pos.customerOrder.total")} {money(o.total)} · {t("pos.customerOrder.deposited")} {money(o.deposited)} · {t("pos.customerOrder.remaining")} {money(o.remaining)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {o.lines.map((l) => `${intl.formatNumber(l.quantity)} × ${l.description}`).join(", ")}
                {o.dueDate && ` · ${t("pos.customerOrder.dueDate")} ${intl.formatDate(o.dueDate)}`}
              </p>
              {depositFor === o.id ? (
                <form className="flex items-end gap-2" onSubmit={(e) => submitDeposit(e, o)}>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`co-deposit-${o.id}`}>{t("till.customerOrders.depositAmount")}</Label>
                    <Input
                      id={`co-deposit-${o.id}`}
                      inputMode="decimal"
                      autoFocus
                      autoComplete="off"
                      placeholder="0.00"
                      value={amount}
                      aria-invalid={invalid || undefined}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setInvalid(false);
                      }}
                      className="w-32 text-right tabular-nums"
                    />
                  </div>
                  <Button type="submit">{t("till.add")}</Button>
                  <Button type="button" variant="ghost" onClick={() => setDepositFor(null)}>{t("common.cancel")}</Button>
                  {invalid && <p className="text-sm text-destructive">{t("till.giftCard.invalid")}</p>}
                </form>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDepositFor(o.id);
                      setAmount("");
                      setInvalid(false);
                    }}
                  >
                    {t("till.customerOrders.deposit")}
                  </Button>
                  <Button size="sm" onClick={() => onCollect(o)}>{t("till.customerOrders.collect")}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}
