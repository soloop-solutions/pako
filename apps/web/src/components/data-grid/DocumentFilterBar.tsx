import { useIntl } from "react-intl";

import { ListRibbon } from "@/components/list/ListRibbon";
import type { DocumentFilterControls } from "@/components/data-grid/useDocumentFilters";

interface Props {
  controls: DocumentFilterControls;
  partners: { id: string; name: string }[];
  partnerLabelId: string;
  showPaymentStatus: boolean;
}

// The invoice and bill lists' ribbon: issue date, partner and payment status.
export function DocumentFilterBar({ controls, partners, partnerLabelId, showPaymentStatus }: Props) {
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
      ]}
    />
  );
}
