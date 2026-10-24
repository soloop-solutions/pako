import { useCallback } from "react";
import type { PartnerResponse } from "@pako/shared";

import { PartnerListPage, type PartnerListPageLabels } from "@/pages/partners/PartnerListPage";

const labels: PartnerListPageLabels = {
  titleKey: "vendors.title",
  descriptionKey: "vendors.description",
  addButtonKey: "vendors.addVendor",
  editTitleKey: "vendors.editVendor",
  createdKey: "vendors.created",
  savedKey: "vendors.saved",
  createErrorKey: "vendors.createError",
  saveErrorKey: "vendors.saveError",
  loadErrorKey: "vendors.loadError",
  emptyKey: "vendors.noVendors",
  searchPlaceholderKey: "vendors.searchPlaceholder",
};

export function Vendors() {
  const filterFn = useCallback((p: PartnerResponse) => p.isVendor, []);
  return <PartnerListPage gridId="vendors" labels={labels} filterFn={filterFn} defaultRole="vendor" exportFileName="vendors" />;
}
