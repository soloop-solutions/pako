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
        itemCode: "K-07",
        unitName: "copë",
        quantity: 2,
        unitPrice: 59,
        discountPercent,
        taxDefinitionId: "tax-18",
        amountBeforeDiscount: amounts.before,
        discountAmount: amounts.discount,
        netAmount: amounts.net,
        taxAmount: amounts.tax,
        grossAmount: amounts.gross,
        unitPriceNet: 50,
        unitPriceGross: 59,
      },
    ],
    totals: {
      amountBeforeDiscount: amounts.before,
      discountAmount: amounts.discount,
      netAmount: amounts.net,
      taxAmount: amounts.tax,
      grossAmount: amounts.gross,
    },
    taxBreakdown: [{ taxDefinitionId: "tax-18", netAmount: amounts.net, taxAmount: amounts.tax, grossAmount: amounts.gross }],
    totalInWords: "njëqind e gjashtë euro e 20 cent",
  };
}

function renderInvoice(inv: ReturnType<typeof invoice>, customer: Record<string, string> = { name: "Blerësi" }) {
  const data = buildDocumentDataFromResponse({ invoice: inv, company, customer: customer as never, taxes: [vat18] });
  return render(
    <IntlProviderWrapper>
      <InvoiceDocument data={data} />
    </IntlProviderWrapper>,
  );
}

function totalsRow(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

// Client request 2026-11-23: every line shows code, unit, quantity, the price without and with VAT,
// rabat % and amount, value excl. VAT, VAT % and amount and the total — all as the server sent them.
describe("InvoiceDocument lines", () => {
  it("prints every column of a discounted line from the server amounts", () => {
    renderInvoice(invoice(10, { before: 118, discount: 11.8, net: 90, tax: 16.2, gross: 106.2 }));

    for (const header of ["No.", "Code", "Unit", "Qty", "Price excl. VAT", "Price incl. VAT", "Disc. %", "Discount", "Value excl. VAT", "VAT %"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("columnheader", { name: "Total" })).toHaveLength(2); // line table and VAT table
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["1", "K-07", "Kafe", "copë", "2", "50.00", "59.00", "10%", "11.80", "90.00", "18%", "16.20", "106.20"]);
  });

  it("prints the totals, the VAT table with its base, and the total in words", () => {
    renderInvoice(invoice(10, { before: 118, discount: 11.8, net: 90, tax: 16.2, gross: 106.2 }));

    expect(totalsRow("Amount before discount").textContent).toContain("118.00");
    expect(totalsRow("Total discount").textContent).toContain("-11.80");
    expect(totalsRow("Subtotal (excl. VAT)").textContent).toContain("90.00");
    expect(totalsRow("Total VAT").textContent).toContain("16.20");
    expect(screen.getByText("106.20 EUR")).toBeInTheDocument();

    const vatRow = screen.getByRole("cell", { name: "TVSH 18%" }).closest("tr") as HTMLElement;
    expect(within(vatRow).getAllByRole("cell").map((c) => c.textContent)).toEqual(["TVSH 18%", "90.00", "16.20", "106.20"]);
    expect(screen.getByText("njëqind e gjashtë euro e 20 cent")).toBeInTheDocument();
  });

  it("leaves the discount rows out of the totals when no line has a rabat", () => {
    renderInvoice(invoice(0, { before: 118, discount: 0, net: 100, tax: 18, gross: 118 }));

    expect(screen.queryByText("Amount before discount")).not.toBeInTheDocument();
    expect(screen.queryByText("Total discount")).not.toBeInTheDocument();
  });

  it("prints the buyer's address, NUI, VAT number and contact", () => {
    renderInvoice(invoice(0, { before: 118, discount: 0, net: 100, tax: 18, gross: 118 }), {
      name: "Blerësi SH.P.K.", taxNumber: "810000001", vatNumber: "330000001", streetAddress: "Rr. Nëna Terezë 1",
      postalCode: "10000", city: "Prishtinë", phone: "044 000 000", contactPerson: "Arta",
    });

    expect(screen.getByText(/NUI: 810000001/)).toBeInTheDocument();
    expect(screen.getByText(/330000001/)).toBeInTheDocument();
    expect(screen.getByText(/Rr\. Nëna Terezë 1/)).toBeInTheDocument();
    expect(screen.getByText(/10000 Prishtinë/)).toBeInTheDocument();
    expect(screen.getByText(/044 000 000/)).toBeInTheDocument();
    expect(screen.getByText(/Arta/)).toBeInTheDocument();
  });
});
