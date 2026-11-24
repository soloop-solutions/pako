import { useIntl } from "react-intl";

import { ListRibbon } from "@/components/list/ListRibbon";
import type { DocumentFilterControls } from "@/components/data-grid/useDocumentFilters";

interface Props {
  controls: DocumentFilterControls;
  partners: { id: string; name: string }[];
  partnerLabelId: string;
  showPaymentStatus: boolean;
  /** Offer a warehouse filter (client request 2026-11-24); hidden when the company has one or none. */
  warehouses?: { id: string; name: string }[];
  /** Offer a "created by" filter: the company's members. */
  users?: { id: string; name: string }[];
}

// The invoice and bill lists' ribbon: issue date, partner, payment status, warehouse and creator.
export function DocumentFilterBar({ controls, partners, partnerLabelId, showPaymentStatus, warehouses = [], users = [] }: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <ListRibbon
      controls={controls.list}
      dateLabelId="docFilters.issueDate"
      selects={[
        { name: "partnerId", labelId: partnerLabelId, options: partners.map((p) => ({ value: p.id, label: p.name })), className: "w-56" },
        ...(showPaymentStatus
          ? [{
              name: "paymentStatus",
              labelId: "invoicing.paymentStatus",
              className: "w-44",
              options: ["unpaid", "partial", "paid", "overdue"].map((s) => ({ value: s, label: t(`invoicing.paymentStatus.${s}`) })),
            }]
          : []),
        ...(warehouses.length > 1
          ? [{ name: "warehouseId", labelId: "listRibbon.warehouse", className: "w-44", options: warehouses.map((w) => ({ value: w.id, label: w.name })) }]
          : []),
        ...(users.length > 1
          ? [{ name: "createdById", labelId: "listRibbon.createdBy", className: "w-48", options: users.map((u) => ({ value: u.id, label: u.name })) }]
          : []),
      ]}
    />
  );
}
