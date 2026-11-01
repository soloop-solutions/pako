import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ItemResponse } from "@pako/shared";
import { Download, X } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { usePosStores } from "@/hooks/usePos";
import { useItemSearch } from "@/hooks/useStock";
import { downloadFileResponse } from "@/lib/download";

// docs/POS_PLAN.md P2: shelf labels — the items picked, priced for a store, as a PDF to print.
export function ShelfLabelsCard() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const stores = (usePosStores().data ?? []).filter((s) => s.isActive);
  const itemSearch = useItemSearch();
  const [storeId, setStoreId] = useState("");
  const [picked, setPicked] = useState<ItemResponse[]>([]);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => itemSearch.items.filter((i) => !i.isVariantTemplate && !picked.some((p) => p.id === i.id)).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })),
    [itemSearch.items, picked],
  );

  // The store whose prices print on the labels — picked, never assumed.
  const store = storeId;
  const download = useMutation({
    mutationFn: () => apiClient.getPosLabelsPdf(activeCompanyId as string, store, picked.map((i) => i.id)),
    onSuccess: (file) => {
      setError(null);
      downloadFileResponse(file, "shelf-labels.pdf");
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.labels.error"))),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pos.labels.title")}</CardTitle>
        <CardDescription>{t("pos.labels.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <div className="flex flex-col gap-1">
            <Label htmlFor="labels-store">{t("pos.register.store")}</Label>
            <Select
              id="labels-store"
              value={store}
              onValueChange={setStoreId}
              placeholder={t("pos.labels.store.pick")}
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="labels-item">{t("pos.labels.addItem")}</Label>
            <SearchableSelect
              id="labels-item"
              value=""
              onChange={(id) => {
                const item = itemSearch.items.find((i) => i.id === id);
                if (item) setPicked((all) => [...all, item]);
              }}
              onSearchChange={itemSearch.onSearchChange}
              placeholder={t("pos.program.targets.pickItem")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              options={options}
            />
          </div>
        </div>
        {picked.length > 0 ? (
          <div className="flex flex-wrap gap-1" aria-label={t("pos.labels.items")}>
            {picked.map((i) => (
              <Badge key={i.id} variant="secondary" className="gap-1">
                {i.code} · {i.name}
                <button type="button" aria-label={intl.formatMessage({ id: "pos.program.targets.remove" }, { name: i.name })} onClick={() => setPicked((all) => all.filter((x) => x.id !== i.id))}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("pos.labels.empty")}</p>
        )}
        <Button className="self-start" disabled={!store || picked.length === 0 || download.isPending} onClick={() => download.mutate()}>
          <Download className="size-4" /> {t("pos.labels.download")}
        </Button>
      </CardContent>
    </Card>
  );
}
