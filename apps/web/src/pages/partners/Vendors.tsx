
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

const HIDDEN_COLUMNS = ["receivableAccount", "creditLimit", "type"];

export function Vendors() {
  return (
    <PartnerListPage
      gridId="vendors"
      labels={labels}
      role="vendor"
      defaultRole="vendor"
      showTypeColumn={false}
      hiddenColumnIds={HIDDEN_COLUMNS}
      exportFileName="vendors"
    />
  );
}
