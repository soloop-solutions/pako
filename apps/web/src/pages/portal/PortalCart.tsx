import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PortalPricedLineResponse } from "@pako/shared";
import { ShoppingCart, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isoToday } from "@/lib/sales-order-enums";
import { formatAmount } from "@/lib/payroll-enums";
import { usePortal, useRequiredPortalCompanyId, type PortalCartLine } from "@/pages/portal/portal-context";

type Row = PortalPricedLineResponse & { key: string; cart: PortalCartLine };

// The cart, priced by the server exactly as the order will be (pricePortalCart), and the order's
// details. Placing it sends only items, units and quantities.
export function PortalCart() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const companyId = useRequiredPortalCompanyId();
  const { cart, setQuantity, removeFromCart, clearCart } = usePortal();
  const [reference, setReference] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const requestLines = cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitName: l.unitName }));
  const priced = useQuery({
    queryKey: ["portal", companyId, "cart", requestLines],
    queryFn: () => apiClient.pricePortalCart(companyId, { lines: requestLines }),
    enabled: cart.length > 0,
    retry: false,
  });

  const place = useMutation({
    mutationFn: () => apiClient.placePortalOrder(companyId, {
      lines: requestLines,
      customerReference: reference.trim() || undefined,
      deliveryDate: deliveryDate || undefined,
      deliveryAddress: address.trim() || undefined,
      notes: notes.trim() || undefined,
    }),
    onSuccess: async (order) => {
      clearCart();
      toast.success(intl.formatMessage({ id: "portal.placed" }, { reference: order.reference }));
      await queryClient.invalidateQueries({ queryKey: ["portal", companyId] });
      navigate(`/portal/orders/${order.id}`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("portal.placeError"))),
  });

  // The server returns the lines in the cart's order.
  const rows = useMemo<Row[]>(
    () => (priced.data?.lines ?? []).map((line, index) => ({ ...line, key: `${cart[index]?.itemId}-${cart[index]?.unitName ?? ""}`, cart: cart[index] }))
      .filter((r) => !!r.cart),
    [priced.data, cart],
  );

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { accessorKey: "description", header: t("portal.col.item"), enableSorting: false },
      {
        id: "quantity", header: t("portal.col.quantity"), enableSorting: false, meta: { numeric: true },
        cell: ({ row }) => <QuantityCell line={row.original.cart} onChange={(q) => setQuantity(row.original.cart.itemId, row.original.cart.unitName, q)} />,
      },
      { id: "unit", header: t("portal.col.unit"), enableSorting: false, accessorFn: (r) => r.unitName ?? "" },
      { accessorKey: "unitPrice", header: t("portal.col.price"), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      {
        accessorKey: "discountPercent", header: t("portal.col.discount"), enableSorting: false, meta: { numeric: true },
        cell: ({ getValue }) => ((getValue() as number) > 0 ? `${getValue() as number}%` : "—"),
      },
      { accessorKey: "gross", header: t("portal.col.total"), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      {
        id: "remove", header: "", enableSorting: false,
        cell: ({ row }) => (
          <Button size="xs" variant="ghost" aria-label={intl.formatMessage({ id: "portal.remove" }, { item: row.original.description })}
            onClick={() => removeFromCart(row.original.cart.itemId, row.original.cart.unitName)}>
            <Trash2 className="size-3.5" />
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, cart],
  );

  if (cart.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title={t("portal.cartEmpty")}
        description={t("portal.cartEmptyHint")}
        actions={<Button asChild><Link to="/portal">{t("portal.nav.catalogue")}</Link></Button>}
      />
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    place.mutate();
  }

  const totals = priced.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("portal.cartTitle")}</h1>
      {priced.isError && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(priced.error, t("portal.priceError"))}</AlertDescription>
        </Alert>
      )}
      <DataGrid
        gridId="portalCart"
        columns={columns}
        data={rows}
        rowCount={rows.length}
        isLoading={priced.isPending}
        getRowId={(r) => r.key}
        footerRow={totals ? { label: t("portal.total"), cells: { gross: formatAmount(totals.gross) } } : undefined}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
        defaultPageSize={200}
        pageSizeOptions={[200]}
      />
      {totals && (
        <p className="text-right text-sm text-muted-foreground" data-testid="portal-cart-totals">
          {intl.formatMessage({ id: "portal.netVat" }, { net: formatAmount(totals.net), vat: formatAmount(totals.vat) })}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("portal.orderDetails")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label={t("portal.yourReference")} htmlFor="portal-reference" hint={t("portal.yourReferenceHint")}>
                <Input id="portal-reference" maxLength={128} value={reference} onChange={(e) => setReference(e.target.value)} />
              </FormField>
              <FormField label={t("portal.wishedDelivery")} htmlFor="portal-delivery-date">
                <Input id="portal-delivery-date" type="date" min={isoToday()} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </FormField>
              <FormField label={t("portal.deliveryAddress")} htmlFor="portal-address" hint={t("portal.deliveryAddressHint")}>
                <Input id="portal-address" maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} />
              </FormField>
            </div>
            <FormField label={t("portal.notes")} htmlFor="portal-notes">
              <Textarea id="portal-notes" maxLength={2000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{t("portal.placeHint")}</p>
              <Button type="submit" disabled={place.isPending || !totals || priced.isError}>
                {totals ? intl.formatMessage({ id: "portal.place" }, { total: formatAmount(totals.gross) }) : t("portal.placeShort")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function QuantityCell({ line, onChange }: { line: PortalCartLine; onChange: (quantity: number) => void }) {
  const intl = useIntl();
  const [value, setValue] = useState(String(line.quantity));
  function commit() {
    const amount = Number(value.replace(",", "."));
    if (Number.isFinite(amount) && amount > 0 && amount !== line.quantity) onChange(amount);
    else setValue(String(line.quantity));
  }
  return (
    <Input
      aria-label={intl.formatMessage({ id: "portal.quantityFor" }, { item: line.name })}
      className="ml-auto h-7 w-20 text-right tabular-nums"
      inputMode="decimal"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}
