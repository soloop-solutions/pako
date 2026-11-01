import { useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { GiftCardResponse, LoyaltyCardResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { GiftCardKind, giftCardKindKey } from "@/lib/pos-enums";
import { cn } from "@/lib/utils";

const money = (v: number) => v.toFixed(2);

// docs/POS_PLAN.md P2: customers' loyalty cards (points) and the gift cards and store credit
// issued at the tills (balances). Every figure is the server's.
export function PosCards() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const loyaltyGrid = useDataGridUrlState("pos-loyalty-cards", 50);
  const giftGrid = useDataGridUrlState("pos-gift-cards", 50);
  const [editing, setEditing] = useState<LoyaltyCardResponse | "new" | null>(null);
  const [giftNumber, setGiftNumber] = useState<string | null>(null);

  const loyalty = useQuery({
    queryKey: ["posLoyaltyCards", activeCompanyId, loyaltyGrid.globalFilter, loyaltyGrid.page, loyaltyGrid.pageSize],
    queryFn: () => apiClient.listLoyaltyCards(activeCompanyId as string, loyaltyGrid.globalFilter || undefined, loyaltyGrid.page, loyaltyGrid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const gifts = useQuery({
    queryKey: ["posGiftCards", activeCompanyId, giftGrid.globalFilter, giftGrid.page, giftGrid.pageSize],
    queryFn: () => apiClient.listGiftCards(activeCompanyId as string, giftGrid.globalFilter || undefined, giftGrid.page, giftGrid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const loyaltyColumns = useMemo<ColumnDef<LoyaltyCardResponse>[]>(
    () => [
      {
        accessorKey: "number",
        header: t("pos.loyalty.number"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2 tabular-nums">
            {row.original.number}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { id: "holder", header: t("pos.loyalty.holder"), cell: ({ row }) => row.original.holderName ?? "—" },
      { id: "phone", header: t("pos.loyalty.phone"), cell: ({ row }) => row.original.phone ?? "—" },
      {
        id: "points",
        header: t("pos.loyalty.points"),
        meta: { numeric: true },
        cell: ({ row }) => <span className="block text-right tabular-nums">{intl.formatNumber(row.original.points)}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const giftColumns = useMemo<ColumnDef<GiftCardResponse>[]>(
    () => [
      {
        accessorKey: "number",
        header: t("pos.giftCard.number"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2 tabular-nums">
            {row.original.number}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      {
        id: "kind",
        header: t("pos.giftCard.kind"),
        cell: ({ row }) => (
          <Badge variant={row.original.kind === GiftCardKind.StoreCredit ? "outline" : "secondary"}>
            {t(`pos.giftCard.kind.${giftCardKindKey(row.original.kind)}`)}
          </Badge>
        ),
      },
      {
        id: "balance",
        header: t("pos.giftCard.balance"),
        meta: { numeric: true },
        cell: ({ row }) => <span className="block text-right tabular-nums">{money(row.original.balance)}</span>,
      },
      { id: "created", header: t("pos.giftCard.created"), cell: ({ row }) => intl.formatDate(row.original.createdAt) },
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
            <CardTitle>{t("pos.loyalty.title")}</CardTitle>
            <CardDescription>{t("nav.posCards.description")}</CardDescription>
          </div>
          {canWrite("pos") && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("pos.loyalty.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-loyalty-cards"
            columns={loyaltyColumns}
            data={loyalty.data?.items ?? []}
            rowCount={loyalty.data?.total ?? 0}
            isLoading={loyalty.isPending}
            getRowId={(c) => c.id}
            getRowClassName={(c) => (c.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canApprove("pos") ? setEditing : undefined}
            enableGlobalFilter
            globalFilterPlaceholder={t("pos.loyalty.search")}
            emptyMessage={t("pos.loyalty.empty")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pos.giftCard.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-gift-cards"
            columns={giftColumns}
            data={gifts.data?.items ?? []}
            rowCount={gifts.data?.total ?? 0}
            isLoading={gifts.isPending}
            getRowId={(c) => c.id}
            getRowClassName={(c) => (c.isActive ? undefined : "text-muted-foreground")}
            onRowClick={(c) => setGiftNumber(c.number)}
            enableGlobalFilter
            globalFilterPlaceholder={t("pos.giftCard.search")}
            emptyMessage={t("pos.giftCard.empty")}
          />
        </CardContent>
      </Card>

      {editing && (
        <LoyaltyCardDialog
          card={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["posLoyaltyCards", activeCompanyId] });
          }}
        />
      )}
      {giftNumber && <GiftCardDialog number={giftNumber} onClose={() => setGiftNumber(null)} />}
    </div>
  );
}

function LoyaltyCardDialog({ card, onClose, onSaved }: { card: LoyaltyCardResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [number, setNumber] = useState(card?.number ?? "");
  const [holder, setHolder] = useState(card?.holderName ?? "");
  const [phone, setPhone] = useState(card?.phone ?? "");
  const [isActive, setIsActive] = useState(card?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        number: number.trim() || undefined, holderName: holder.trim() || undefined, phone: phone.trim() || undefined,
        partnerId: card?.partnerId, isActive,
      };
      return card
        ? apiClient.updateLoyaltyCard(activeCompanyId as string, card.id, body)
        : apiClient.createLoyaltyCard(activeCompanyId as string, body);
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
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={card ? card.number : t("pos.loyalty.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="lc-number">{t("pos.loyalty.number")}</Label>
          {/* The number is the card's identity: set once, when it is issued. */}
          <Input id="lc-number" maxLength={40} disabled={!!card} value={number} onChange={(e) => setNumber(e.target.value)} className="tabular-nums" />
          {!card && <p className="text-xs text-muted-foreground">{t("pos.loyalty.number.hint")}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lc-holder">{t("pos.loyalty.holder")}</Label>
          <Input id="lc-holder" maxLength={120} value={holder} onChange={(e) => setHolder(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lc-phone">{t("pos.loyalty.phone")}</Label>
          <Input id="lc-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {card && (
          <p className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("pos.loyalty.points")}</span>
            <span className="font-semibold tabular-nums">{intl.formatNumber(card.points)}</span>
          </p>
        )}
        {card && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("common.active")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function GiftCardDialog({ number, onClose }: { number: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const card = useQuery({
    queryKey: ["posGiftCard", activeCompanyId, number],
    queryFn: () => apiClient.getGiftCard(activeCompanyId as string, number),
  });
  const c = card.data;
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={number} size="sm">
      {card.error ? (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(card.error, t("till.pay.giftCardNotFound"))}</AlertDescription>
        </Alert>
      ) : !c ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between">
            <Badge variant="secondary">{t(`pos.giftCard.kind.${giftCardKindKey(c.kind)}`)}</Badge>
            <span className="text-muted-foreground">
              {t("pos.giftCard.created")} {intl.formatDate(c.createdAt)}
              {c.expiresOn && ` · ${t("pos.giftCard.expires", { date: intl.formatDate(c.expiresOn) })}`}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">{t("pos.giftCard.balance")}</span>
            <span className="text-2xl font-bold tabular-nums">{money(c.balance)}</span>
          </div>
          <p className="font-medium">{t("pos.giftCard.movements")}</p>
          {c.movements.length === 0 ? (
            <p className="text-muted-foreground">{t("pos.giftCard.movements.empty")}</p>
          ) : (
            <ul className="divide-y rounded-md border" aria-label={t("pos.giftCard.movements")}>
              {c.movements.map((m, i) => (
                <li key={i} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5 tabular-nums">
                  <span>{intl.formatDate(m.at)} {intl.formatTime(m.at)}</span>
                  <span className="text-muted-foreground">{m.orderNumber ?? "—"}</span>
                  <span className={cn("text-right", m.amount < 0 && "text-destructive")}>{money(m.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button onClick={onClose}>{t("common.close")}</Button>
      </div>
    </FormDialog>
  );
}
