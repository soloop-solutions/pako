import { useIntl } from "react-intl";
import type { CompanyResponse } from "@pako/shared";

import { useCompany } from "@/context/CompanyContext";
import { Dashboard } from "@/pages/Dashboard";
import { CompanyList } from "@/pages/shared/CompanyList";

function isFirmMember(companies: CompanyResponse[]): boolean {
  return companies.length > 1 || companies.some((company) => !!company.firmId);
}

export function Landing() {
  const intl = useIntl();
  const { companies, loading } = useCompany();

  if (loading && companies.length === 0) {
    return <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "companies.loadingCompanies" })}</p>;
  }

  if (!isFirmMember(companies)) {
    return <Dashboard />;
  }

  return (
    <div className="flex flex-col gap-6">
      <CompanyList titleKey="landing.title" descriptionKey="landing.description" />
    </div>
  );
}
