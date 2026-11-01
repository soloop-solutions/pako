import { useCallback } from "react";
import type { PartnerResponse } from "@pako/shared";

import { PartnerListPage, type PartnerListPageLabels } from "@/pages/partners/PartnerListPage";

const labels: PartnerListPageLabels = {
  titleKey: "customers.title",
  descriptionKey: "customers.description",
  addButtonKey: "customers.addCustomer",
  editTitleKey: "customers.editCustomer",
  createdKey: "customers.created",
  savedKey: "customers.saved",
  createErrorKey: "customers.createError",
  saveErrorKey: "customers.saveError",
  loadErrorKey: "customers.loadError",
  emptyKey: "customers.noCustomers",
  searchPlaceholderKey: "customers.searchPlaceholder",
};

const HIDDEN_COLUMNS = ["payableAccount", "type"];

export function Customers() {
  const filterFn = useCallback((p: PartnerResponse) => p.isCustomer, []);
  return (
    <PartnerListPage
      gridId="customers"
      labels={labels}
      filterFn={filterFn}
      defaultRole="customer"
      showTypeColumn={false}
      hiddenColumnIds={HIDDEN_COLUMNS}
      exportFileName="customers"
    />
  );
}
