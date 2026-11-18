import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { buildDocumentDataFromResponse } from "@/lib/invoice-document-data";

import { InvoiceDocument } from "./InvoiceDocument";

const company = { name: "Shitësi SH.P.K." };
const vat18 = { id: "tax-18", name: "TVSH 18%", rate: 0.18 };

// 2 × 59.00 VAT-inclusive with a 10% rabat, as returned by the single-invoice GET.
function invoice(discountPercent: number, amounts: { before: number; discount: number; net: number; tax: number; gross: number }) {
  return {
    id: "inv-1",
    invoiceNumber: "07/2026",
    state: "Posted",
    documentType: 0,
    issueDate: "2026-11-18",
    dueDate: "2026-12-18",
    priceMode: 0,
    lines: [
      {
        description: "Kafe",
        quantity: 2,
        unitPrice: 59,
        discountPercent,
        taxDefinitionId: "tax-18",
        amountBeforeDiscount: amounts.before,
        discountAmount: amounts.discount,
        netAmount: amounts.net,
        taxAmount: amounts.tax,
        grossAmount: amounts.gross,
      },
    ],
    totals: {
      amountBeforeDiscount: amounts.before,
      discountAmount: amounts.discount,
      netAmount: amounts.net,
      taxAmount: amounts.tax,
      grossAmount: amounts.gross,
    },
    taxBreakdown: [{ taxDefinitionId: "tax-18", netAmount: amounts.net, taxAmount: amounts.tax }],
  };
}

function renderInvoice(inv: ReturnType<typeof invoice>) {
  const data = buildDocumentDataFromResponse({ invoice: inv, company, customer: { name: "Blerësi" }, taxes: [vat18] });
  return render(
    <IntlProviderWrapper>
      <InvoiceDocument data={data} />
    </IntlProviderWrapper>,
  );
}

function totalsRow(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

describe("InvoiceDocument rabat", () => {
  it("prints the line discount and the server totals: before discount − discount, then net, VAT, total", () => {
    renderInvoice(invoice(10, { before: 118, discount: 11.8, net: 90, tax: 16.2, gross: 106.2 }));

    expect(screen.getByRole("columnheader", { name: "Disc." })).toBeInTheDocument();
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("10%")).toBeInTheDocument();
    expect(within(row).getByText("-11.80")).toBeInTheDocument();

    expect(totalsRow("Amount before discount").textContent).toContain("118.00");
    expect(totalsRow("Total discount").textContent).toContain("-EUR 11.80");
    expect(totalsRow("Subtotal (excl. VAT)").textContent).toContain("90.00");
    expect(totalsRow("Total VAT").textContent).toContain("16.20");
    expect(screen.getByText("EUR 106.20")).toBeInTheDocument();
  });

  it("leaves the discount column and rows out when no line has a rabat", () => {
    renderInvoice(invoice(0, { before: 118, discount: 0, net: 100, tax: 18, gross: 118 }));

    expect(screen.queryByRole("columnheader", { name: "Disc." })).not.toBeInTheDocument();
    expect(screen.queryByText("Amount before discount")).not.toBeInTheDocument();
    expect(screen.queryByText("Total discount")).not.toBeInTheDocument();
  });
});
