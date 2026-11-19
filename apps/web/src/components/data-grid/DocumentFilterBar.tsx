import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { DocumentFilterControls } from "@/components/data-grid/useDocumentFilters";
import { dateToIso } from "@/lib/dates";

interface Props {
  controls: DocumentFilterControls;
  partners: { id: string; name: string }[];
  partnerLabelId: string;
  showPaymentStatus: boolean;
}

function monthRange(offset: number): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return [dateToIso(start), dateToIso(end)];
}

function quarterRange(): [string, string] {
  const now = new Date();
  const first = Math.floor(now.getMonth() / 3) * 3;
  return [dateToIso(new Date(now.getFullYear(), first, 1)), dateToIso(new Date(now.getFullYear(), first + 3, 0))];
}

function yearRange(): [string, string] {
  const year = new Date().getFullYear();
  return [`${year}-01-01`, `${year}-12-31`];
}

export function DocumentFilterBar({ controls, partners, partnerLabelId, showPaymentStatus }: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { filters, setFilter, setRange, clear, activeCount } = controls;

  const presets: { id: string; range: () => [string, string] }[] = [
    { id: "docFilters.thisMonth", range: () => monthRange(0) },
    { id: "docFilters.lastMonth", range: () => monthRange(-1) },
    { id: "docFilters.thisQuarter", range: quarterRange },
    { id: "docFilters.thisYear", range: yearRange },
  ];

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-md border bg-muted/30 p-3" data-testid="document-filters">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("docFilters.from")}</Label>
          <Input type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("docFilters.to")}</Label>
          <Input type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t(partnerLabelId)}</Label>
          <Select
            value={filters.partnerId}
            onValueChange={(v) => setFilter("partnerId", v)}
            options={[{ value: "", label: t("docFilters.all") }, ...partners.map((p) => ({ value: p.id, label: p.name }))]}
            placeholder={t("docFilters.all")}
            className="w-56"
          />
        </div>
        {showPaymentStatus && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("invoicing.paymentStatus")}</Label>
            <Select
              value={filters.paymentStatus}
              onValueChange={(v) => setFilter("paymentStatus", v)}
              options={[
                { value: "", label: t("docFilters.all") },
                { value: "unpaid", label: t("invoicing.paymentStatus.unpaid") },
                { value: "partial", label: t("invoicing.paymentStatus.partial") },
                { value: "paid", label: t("invoicing.paymentStatus.paid") },
                { value: "overdue", label: t("invoicing.paymentStatus.overdue") },
              ]}
              placeholder={t("docFilters.all")}
              className="w-44"
            />
          </div>
        )}
        {activeCount > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            {t("docFilters.clear")} ({activeCount})
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("docFilters.issueDate")}:</span>
        {presets.map((preset) => (
          <Button key={preset.id} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRange(...preset.range())}>
            {t(preset.id)}
          </Button>
        ))}
      </div>
    </div>
  );
}
