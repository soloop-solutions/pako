import { ShoppingCart, TrendingUp } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router-dom";

import { monthName } from "@/pages/accounting-documents/month-names";

export function AccountingDocumentTypeSelection() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { year, month } = useParams<{ year: string; month: string }>();
  const locale = intl.locale;

  const yearNum = Number(year);
  const monthNum = Number(month);
  const mName = monthName(monthNum, locale);

  function handleTypeClick(type: "buy" | "sell") {
    void navigate(`/accounting-documents/${year}/${month}/${type}`);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Title */}
      <h1 className="text-xl font-semibold">
        {intl.formatMessage(
          { id: "accountingDocuments.monthTitle" },
          { year: yearNum, month: mName },
        )}
      </h1>

      {/* Type cards */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}
      >
        <button
          type="button"
          onClick={() => handleTypeClick("buy")}
          className="flex flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/50"
        >
          <ShoppingCart className="size-10 text-primary" />
          <span className="text-lg font-medium">
            {intl.formatMessage({ id: "accountingDocuments.buy" })}
          </span>
          <span className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: "accountingDocuments.buySubtitle" })}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleTypeClick("sell")}
          className="flex flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/50"
        >
          <TrendingUp className="size-10 text-primary" />
          <span className="text-lg font-medium">
            {intl.formatMessage({ id: "accountingDocuments.sell" })}
          </span>
          <span className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: "accountingDocuments.sellSubtitle" })}
          </span>
        </button>
      </div>
    </div>
  );
}
