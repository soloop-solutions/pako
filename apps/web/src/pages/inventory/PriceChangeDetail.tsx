import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PriceChangeResponse, SavePriceChangeRequest } from "@pako/shared";
import { ArrowLeft, Plus, Printer, X } from "lucide-react";
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
import { useItemSearch } from "@/hooks/useStock";
import { downloadFileResponse } from "@/lib/download";
import { formatAmount } from "@/lib/payroll-enums";
import { PriceChangeState } from "@/lib/stock-enums";
import { priceListLabel } from "@/lib/price-lists";

interface Line {
  itemId: string;
  newPrice: string;
  // docs/POS_PLAN.md P6: 0 (or empty) = the ordinary price; above 0 = a volume tier from that
  // quantity (base units). The same item may sit on one line per tier.
  minQuantity: string;
}

const emptyLine = (): Line => ({ itemId: "", newPrice: "", minQuantity: "" });
const parse = (s: string) => Number(s.replace(",", "."));

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// docs/INVENTORY_PLAN.md §12 P4 — the price-change document (Nivelim). Saving a draft previews the
// old price, quantity on hand and shelf difference; posting (Items: Approve) makes the new prices
// current from the document date and freezes the record. No journal entry.
export function PriceChangeDetail() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const isNew = id === "new";

  const changeQuery = useQuery({
    queryKey: ["priceChange", activeCompanyId, id],
    queryFn: () => apiClient.getPriceChange(activeCompanyId as string, id as string),
    enabled: !!activeCompanyId && !isNew && !!id,
  });
  const lists = (useQuery({
    queryKey: ["priceLists", activeCompanyId],
    queryFn: () => apiClient.listPriceLists(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []).filter((l) => l.isActive);
  const itemSearch = useItemSearch();
  const change = changeQuery.data;
  const itemOptions = useMemo(() => {
    const options = itemSearch.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.unit }));
    // A saved draft's items keep their label even when no search has returned them.
    const listed = new Set(options.map((o) => o.value));
    for (const l of change?.lines ?? [])
      if (!listed.has(l.itemId)) {
        listed.add(l.itemId);
        options.push({ value: l.itemId, label: `${l.itemCode} · ${l.itemName}`, description: l.unit });
      }
    return options;
  }, [itemSearch.items, change]);
  const [listId, setListId] = useState(params.get("list") ?? "");
  const [date, setDate] = useState(isoToday());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);

  useEffect(() => {
    if (!change) return;
    setListId(change.priceListId);
    setDate(change.date);
    setNotes(change.notes ?? "");
    setLines(change.lines.map((l) => ({ itemId: l.itemId, newPrice: String(l.newPrice), minQuantity: l.minQuantity ? String(l.minQuantity) : "" })));
  }, [change]);
  useEffect(() => {
    if (isNew && !listId && lists.length > 0) setListId(lists[0].id);
  }, [isNew, listId, lists]);

  const posted = change?.state === PriceChangeState.Posted;
  const editable = !posted && canWrite("items");

  function request(): SavePriceChangeRequest {
    return {
      priceListId: listId,
      date,
      notes: notes.trim() || undefined,
      lines: lines.filter((l) => l.itemId && l.newPrice !== "").map((l) => ({
        itemId: l.itemId, newPrice: parse(l.newPrice), minQuantity: l.minQuantity.trim() === "" ? 0 : parse(l.minQuantity),
      })),
    };
  }

  const refresh = async (saved: PriceChangeResponse) => {
    queryClient.setQueryData(["priceChange", activeCompanyId, saved.id], saved);
    await queryClient.invalidateQueries({ queryKey: ["priceChanges", activeCompanyId] });
    await queryClient.invalidateQueries({ queryKey: ["priceListItems", activeCompanyId] });
  };

  const save = useMutation({
    mutationFn: () => isNew
      ? apiClient.createPriceChange(activeCompanyId as string, request())
      : apiClient.updatePriceChange(activeCompanyId as string, id as string, request()),
    onSuccess: async (saved) => {
      setError(null);
      await refresh(saved);
      if (isNew) navigate(`/price-changes/${saved.id}`, { replace: true });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.doc.saveError"))),
  });
  const post = useMutation({
    mutationFn: async () => {
      const saved = await apiClient.updatePriceChange(activeCompanyId as string, id as string, request());
      return apiClient.postPriceChange(activeCompanyId as string, saved.id);
    },
    onSuccess: async (saved) => {
      setError(null);
      setConfirmPost(false);
      await refresh(saved);
      await queryClient.invalidateQueries({ queryKey: ["resolvedPrices"] });
    },
    onError: (err: unknown) => {
      setConfirmPost(false);
      setError(getApiErrorMessage(err, t("stock.doc.postError")));
    },
  });
  const discard = useMutation({
    mutationFn: () => apiClient.discardPriceChange(activeCompanyId as string, id as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["priceChanges", activeCompanyId] });
      navigate("/price-lists?tab=changes");
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.doc.saveError"))),
  });
  const print = useMutation({
    mutationFn: () => apiClient.getPriceChangePdf(activeCompanyId as string, id as string),
    onSuccess: (file) => downloadFileResponse(file, "nivelim.pdf"),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("stock.doc.printError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const setLine = (index: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const price = (v: number | undefined) => (v == null ? "—" : intl.formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  if (!isNew && changeQuery.isPending) return <p className="text-muted-foreground">{t("platform.loading")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/price-lists?tab=changes")}>
          <ArrowLeft className="size-4" />
          {t("nav.priceLists")}
        </Button>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {t("price.change.title")} {change?.number ?? ""}
              {posted ? <Badge variant="success">{t("stock.doc.posted")}</Badge> : <Badge variant="outline" className="italic">{t("stock.doc.draft")}</Badge>}
            </CardTitle>
            <CardDescription>{t("price.change.description")}</CardDescription>
          </div>
          {change && (
            <div className="flex flex-col items-end gap-2">
              <p className="text-sm text-muted-foreground tnum">{t("price.change.total", { value: formatAmount(change.totalDifference) })}</p>
              <Button type="button" size="xs" variant="outline" disabled={print.isPending} onClick={() => print.mutate()}>
                <Printer className="size-3.5" />
                {t("price.change.print")}
              </Button>
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
                <Label htmlFor="pc-list">{t("price.list")}</Label>
                <Select id="pc-list" value={listId} disabled={!editable} onValueChange={setListId}
                  options={lists.map((l) => ({ value: l.id, label: priceListLabel(l, t("dist.price.customerList")) }))} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pc-date">{t("price.change.validFrom")}</Label>
                <Input id="pc-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("stock.doc.lines")}</h3>
              {lines.map((line, index) => {
                // By position, not item (the same item may sit on two lines); a line edited since the
                // last save no longer matches and shows no figures until saved again.
                const candidate = change?.lines[index];
                const saved = candidate?.itemId === line.itemId ? candidate : undefined;
                return (
                  <div key={index} className="grid grid-cols-[minmax(12rem,2fr)_6rem_7rem_6rem_6rem_7rem_auto] items-end gap-2">
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("stock.col.item")}</Label>}
                      <SearchableSelect value={line.itemId} onChange={(v) => setLine(index, { itemId: v })} disabled={!editable}
                        aria-label={t("stock.col.item")} placeholder={t("stock.doc.pickItem")} searchPlaceholder={t("common.search")}
                        noResultsText={t("common.noResults")} options={itemOptions} onSearchChange={itemSearch.onSearchChange} />
                    </div>
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label title={t("dist.price.minQuantityHint")}>{t("dist.price.minQuantity")}</Label>}
                      <Input inputMode="decimal" className="text-right tnum" value={line.minQuantity} disabled={!editable} placeholder="—"
                        aria-label={t("dist.price.minQuantity")} title={t("dist.price.minQuantityHint")}
                        onChange={(e) => setLine(index, { minQuantity: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("price.col.newPrice")}</Label>}
                      <Input inputMode="decimal" className="text-right tnum" value={line.newPrice} disabled={!editable}
                        aria-label={t("price.col.newPrice")} onChange={(e) => setLine(index, { newPrice: e.target.value })} />
                    </div>
                    {/* Old price, quantity and difference come from the API (saved draft = preview). */}
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("price.col.oldPrice")}</Label>}
                      <span className="flex h-9 items-center justify-end text-sm tnum text-muted-foreground">{price(saved?.oldPrice)}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("price.col.onHand")}</Label>}
                      <span className="flex h-9 items-center justify-end text-sm tnum text-muted-foreground">
                        {saved?.quantity == null ? "—" : intl.formatNumber(saved.quantity)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {index === 0 && <Label>{t("price.col.difference")}</Label>}
                      <span className="flex h-9 items-center justify-end text-sm tnum">{saved?.difference == null ? "—" : formatAmount(saved.difference)}</span>
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
              {editable && !isNew && <p className="text-xs text-muted-foreground">{t("price.change.previewHint")}</p>}
            </section>

            <div className="flex flex-col gap-1">
              <Label htmlFor="pc-notes">{t("stock.doc.notes")}</Label>
              <Textarea id="pc-notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {editable && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                {!isNew && (
                  <Button type="button" variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate()}>{t("stock.doc.discard")}</Button>
                )}
                <Button type="submit" variant="outline" disabled={save.isPending || !listId}>{t("stock.doc.saveDraft")}</Button>
                {!isNew && canApprove("items") && (
                  confirmPost ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{t("price.change.confirmPost")}</span>
                      <Button type="button" variant="outline" onClick={() => setConfirmPost(false)}>{t("common.cancel")}</Button>
                      <Button type="button" disabled={post.isPending} onClick={() => post.mutate()}>{t("stock.doc.post")}</Button>
                    </div>
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
