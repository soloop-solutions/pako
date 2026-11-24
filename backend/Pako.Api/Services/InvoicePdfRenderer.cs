using System.Globalization;
using Pako.Domain.Documents;
using Pako.Domain.Invoicing;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Pako.Api.Services;

// The invoice as a PDF (email delivery): what the web print (InvoiceDocument.tsx) shows, built
// server-side so it can be attached to an email and downloaded from the portal. It never computes a
// figure: every amount is a field of the InvoiceDocument (DocumentLineCalculator). Labels are
// Pdf_Invoice_* keys from the caller, so the document follows the reader's language.
//
// Layout follows docs/REPORTS.md "Report PDF pattern" (A4, 32 pt margins, the dashboard palette).
// QuestPDF Community licence — see PayslipPdfRenderer.
public static class InvoicePdfRenderer
{
    public const string PdfContentType = "application/pdf";

    static InvoicePdfRenderer()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public static byte[] Render(InvoiceDocument document, Func<string, string> label, CultureInfo culture) =>
        Compose(document, label, culture).GeneratePdf();

    // Client request 2026-11-24 ("Print selected"): several invoices in one PDF, each keeping its own
    // page numbers, in the order given.
    public static byte[] RenderMany(IReadOnlyList<InvoiceDocument> documents, Func<string, string> label, CultureInfo culture) =>
        Document.Merge(documents.Select(d => (IDocument)Compose(d, label, culture))).UseOriginalPageNumbers().GeneratePdf();

    private static Document Compose(InvoiceDocument document, Func<string, string> label, CultureInfo culture) =>
        Document.Create(container => container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(32);
            page.DefaultTextStyle(t => t.FontSize(9).FontColor(DashboardPdfRenderer.Ink));
            page.Header().Element(h => Header(h, document, label));
            page.Content().PaddingVertical(12).Element(c => Body(c, document, label, culture));
            page.Footer().Element(f => Footer(f, document, label));
        })).WithMetadata(Metadata(document, label));

    // Fixed dates (not "now"): the same invoice renders to the same bytes, so a retried email repeats
    // the same request under the same Idempotency-Key (Resend refuses a reused key with a new body).
    private static DocumentMetadata Metadata(InvoiceDocument document, Func<string, string> label)
    {
        var date = new DateTimeOffset(document.IssueDate.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        return new DocumentMetadata
        {
            Title = $"{Title(document.Type, label)} {document.Number}".Trim(),
            Author = document.Company.Name,
            Creator = "PAKO",
            Producer = "PAKO",
            CreationDate = date,
            ModifiedDate = date,
        };
    }

    public static string Title(DocumentType type, Func<string, string> label) => label(type switch
    {
        DocumentType.CreditNote => "Pdf_Invoice_Title_CreditNote",
        DocumentType.DebitNote => "Pdf_Invoice_Title_DebitNote",
        DocumentType.DownPayment => "Pdf_Invoice_Title_DownPayment",
        DocumentType.SalesReturn => "Pdf_Invoice_Title_SalesReturn",
        DocumentType.Proforma => "Pdf_Invoice_Title_Proforma",
        _ => "Pdf_Invoice_Title_Invoice",
    });

    // e.g. "invoice-INV-0012.pdf"; a document without a number yet uses its id.
    public static string FileName(InvoiceDocument document)
    {
        var kind = document.Type switch
        {
            DocumentType.CreditNote => "credit-note",
            DocumentType.DebitNote => "debit-note",
            DocumentType.DownPayment => "down-payment",
            DocumentType.SalesReturn => "return",
            DocumentType.Proforma => "proforma",
            _ => "invoice",
        };
        var number = document.Number ?? document.Id.ToString("N")[..8];
        var safe = new string(number.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '-').ToArray()).Trim('-');
        return $"{kind}-{safe}.pdf";
    }

    private static string Money(decimal value, CultureInfo culture) => value.ToString("N2", culture);

    // Client request 2026-11-23: the seller block names the company in full — trading name with its
    // legal form, the registered name when it differs, the full address, every identifier on one line
    // and the contact details on another.
    private static void Header(IContainer container, InvoiceDocument document, Func<string, string> label)
    {
        var company = document.Company;
        container.Column(col =>
        {
            col.Item().Row(row =>
            {
                row.RelativeItem().Row(left =>
                {
                    if (company.Logo is { } logo)
                    {
                        left.ConstantItem(56).Height(56).Image(logo).FitArea();
                    }
                    else
                    {
                        var initial = company.Name.Length > 0 ? company.Name[..1].ToUpperInvariant() : "?";
                        left.ConstantItem(56).Height(56).Background(DashboardPdfRenderer.Primary)
                            .AlignCenter().AlignMiddle().Text(initial).FontColor(Colors.White).Bold().FontSize(20);
                    }

                    left.ConstantItem(10);
                    left.RelativeItem().Column(c =>
                    {
                        c.Item().Text(company.LegalForm is { } form ? $"{company.Name} {form}" : company.Name).Bold().FontSize(13);
                        Optional(c, company.LegalName);
                        Optional(c, Join(", ", company.StreetAddress, Join(" ", company.PostalCode, company.Municipality), company.Country));
                        Optional(c, Join(" · ",
                            Captioned(label("Pdf_Invoice_BusinessNumber"), company.BusinessNumber),
                            Captioned(label("Pdf_Invoice_FiscalNumber"), company.FiscalNumber),
                            Captioned(label("Pdf_Invoice_VatNumber"), company.VatNumber)));
                        Optional(c, Join(" · ",
                            Captioned(label("Pdf_Invoice_Phone"), company.Phone), company.Email, company.Website));
                    });
                });

                row.ConstantItem(170).AlignRight().Column(c =>
                {
                    c.Item().AlignRight().Text(Title(document.Type, label).ToUpper(CultureInfo.CurrentCulture)).Bold().FontSize(18).FontColor(DashboardPdfRenderer.Primary);
                    c.Item().AlignRight().Text(document.Number is { } number
                        ? $"{label("Pdf_Invoice_Number")}: {number}"
                        : label("Pdf_Invoice_Draft")).FontSize(11).SemiBold();
                    if (document.State != InvoiceState.Posted)
                    {
                        c.Item().AlignRight().Text(label(document.State == InvoiceState.Cancelled ? "Pdf_Invoice_Cancelled" : "Pdf_Invoice_NotPosted"))
                            .FontColor(DashboardPdfRenderer.Bad).SemiBold();
                    }
                });
            });
            col.Item().PaddingTop(8).LineHorizontal(1.5f).LineColor(DashboardPdfRenderer.Primary);
        });
    }

    private static void Body(IContainer container, InvoiceDocument document, Func<string, string> label, CultureInfo culture)
    {
        var customer = document.Customer;
        container.Column(col =>
        {
            col.Spacing(10);

            // Buyer (boxed, left) and the document's dates (right).
            col.Item().Row(row =>
            {
                row.RelativeItem().Border(0.8f).BorderColor(DashboardPdfRenderer.Rule).Background(Colors.Grey.Lighten5).Padding(8).Column(c =>
                {
                    c.Item().Text(label("Pdf_Invoice_Buyer").ToUpper(CultureInfo.CurrentCulture)).FontColor(DashboardPdfRenderer.Muted).FontSize(7.5f).SemiBold();
                    c.Item().PaddingTop(2).Text(customer.Name).Bold().FontSize(11);
                    Optional(c, Captioned(label("Pdf_Invoice_ContactPerson"), customer.ContactPerson));
                    Optional(c, Join(", ", customer.StreetAddress, Join(" ", customer.PostalCode, customer.City), customer.Country));
                    // TaxNumber is the NUI; the VAT number is its own field since 2026-11-23.
                    Optional(c, Join(" · ",
                        Captioned(label("Pdf_Invoice_Nui"), customer.TaxNumber),
                        Captioned(label("Pdf_Invoice_VatNumber"), customer.VatNumber),
                        Captioned(label("Pdf_Invoice_FiscalNumber"), customer.FiscalNumber)));
                    Optional(c, Join(" · ", Captioned(label("Pdf_Invoice_Phone"), customer.Phone), customer.Email));
                });
                row.ConstantItem(16);
                row.ConstantItem(190).Column(c =>
                {
                    KeyValue(c, label("Pdf_Invoice_IssueDate"), document.IssueDate.ToString("dd.MM.yyyy", culture));
                    KeyValue(c, label("Pdf_Invoice_DueDate"), document.DueDate.ToString("dd.MM.yyyy", culture));
                    if (document.PaymentTermDays is > 0)
                    {
                        KeyValue(c, label("Pdf_Invoice_PaymentTerms"), string.Format(culture, label("Pdf_Invoice_NetDays"), document.PaymentTermDays));
                    }

                    KeyValue(c, label("Pdf_Invoice_Currency"), document.Currency);
                    if (document.OriginalNumber is { } original) KeyValue(c, label("Pdf_Invoice_OriginalRef"), original);
                });
            });

            // Lines: every column always shown, compact so 13 columns fit A4 portrait. The header row
            // repeats on every page.
            col.Item().DefaultTextStyle(t => t.FontSize(7.5f)).Table(table =>
            {
                table.ColumnsDefinition(c =>
                {
                    c.ConstantColumn(16);   // Nr
                    c.ConstantColumn(34);   // Code
                    c.RelativeColumn();     // Description
                    c.ConstantColumn(28);   // Unit
                    c.ConstantColumn(32);   // Qty
                    c.ConstantColumn(44);   // Price excl. VAT
                    c.ConstantColumn(44);   // Price incl. VAT
                    c.ConstantColumn(28);   // Rabat %
                    c.ConstantColumn(36);   // Rabat
                    c.ConstantColumn(46);   // Value excl. VAT
                    c.ConstantColumn(26);   // VAT %
                    c.ConstantColumn(38);   // VAT
                    c.ConstantColumn(48);   // Total
                });
                table.Header(h =>
                {
                    HeaderCell(h, label("Pdf_Invoice_Col_No"), left: true);
                    HeaderCell(h, label("Pdf_Invoice_Col_Code"), left: true);
                    HeaderCell(h, label("Pdf_Invoice_Col_Description"), left: true);
                    HeaderCell(h, label("Pdf_Invoice_Col_Unit"), left: true);
                    HeaderCell(h, label("Pdf_Invoice_Col_Quantity"));
                    HeaderCell(h, label("Pdf_Invoice_Col_UnitPriceExclVat"));
                    HeaderCell(h, label("Pdf_Invoice_Col_UnitPriceInclVat"));
                    HeaderCell(h, label("Pdf_Invoice_Col_DiscountPercent"));
                    HeaderCell(h, label("Pdf_Invoice_Col_DiscountAmount"));
                    HeaderCell(h, label("Pdf_Invoice_Col_Net"));
                    HeaderCell(h, label("Pdf_Invoice_Col_VatRate"));
                    HeaderCell(h, label("Pdf_Invoice_Col_VatValue"));
                    HeaderCell(h, label("Pdf_Invoice_Col_Total"));
                });
                var number = 0;
                foreach (var line in document.Lines)
                {
                    number++;
                    LineCell(table).Text(number.ToString(culture)).FontColor(DashboardPdfRenderer.Muted);
                    LineCell(table).Text(line.ItemCode ?? "");
                    LineCell(table).Text(line.Description);
                    LineCell(table).Text(line.UnitName ?? "");
                    LineCell(table).AlignRight().Text(line.Quantity.ToString("0.###", culture));
                    LineCell(table).AlignRight().Text(Money(line.Amounts.UnitPriceNet, culture));
                    LineCell(table).AlignRight().Text(Money(line.Amounts.UnitPriceGross, culture));
                    LineCell(table).AlignRight().Text(line.DiscountPercent > 0 ? $"{line.DiscountPercent.ToString("0.##", culture)}%" : "—");
                    LineCell(table).AlignRight().Text(line.Amounts.DiscountAmount != 0 ? Money(line.Amounts.DiscountAmount, culture) : "—");
                    LineCell(table).AlignRight().Text(Money(line.Amounts.NetAmount, culture));
                    LineCell(table).AlignRight().Text(line.TaxLabel ?? "—");
                    LineCell(table).AlignRight().Text(Money(line.Amounts.TaxAmount, culture));
                    LineCell(table).AlignRight().Text(Money(line.Amounts.GrossAmount, culture)).SemiBold();
                }
            });

            // VAT per rate with its taxable base (left) and the document totals (right).
            col.Item().Row(row =>
            {
                row.RelativeItem().Element(e =>
                {
                    if (document.Taxes.Count == 0) return;
                    e.DefaultTextStyle(t => t.FontSize(8)).Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn(2);
                            c.RelativeColumn(1.4f);
                            c.RelativeColumn(1.4f);
                            c.RelativeColumn(1.4f);
                        });
                        table.Header(h =>
                        {
                            HeaderCell(h, label("Pdf_Invoice_VatTable_Rate"), left: true);
                            HeaderCell(h, label("Pdf_Invoice_VatTable_Base"));
                            HeaderCell(h, label("Pdf_Invoice_VatTable_Vat"));
                            HeaderCell(h, label("Pdf_Invoice_VatTable_Total"));
                        });
                        foreach (var tax in document.Taxes)
                        {
                            // "TVSH 18%" already names its rate; only add it when the tax's name doesn't.
                            var rate = $"{(tax.Rate * 100).ToString("0.##", culture)}%";
                            Cell(table).Text(tax.Label.Contains(rate) ? tax.Label : $"{tax.Label} ({rate})");
                            Cell(table).AlignRight().Text(Money(tax.Net, culture));
                            Cell(table).AlignRight().Text(Money(tax.Tax, culture));
                            Cell(table).AlignRight().Text(Money(tax.Gross, culture));
                        }
                    });
                });
                row.ConstantItem(24);
                row.ConstantItem(220).Column(c =>
                {
                    var totals = document.Totals;
                    if (totals.DiscountAmount != 0)
                    {
                        TotalRow(c, label("Pdf_Invoice_AmountBeforeDiscount"), Money(totals.AmountBeforeDiscount, culture));
                        TotalRow(c, label("Pdf_Invoice_TotalDiscount"), "-" + Money(totals.DiscountAmount, culture));
                    }

                    TotalRow(c, label("Pdf_Invoice_Subtotal"), Money(totals.NetAmount, culture));
                    TotalRow(c, label("Pdf_Invoice_TotalVat"), Money(totals.TaxAmount, culture));
                    c.Item().PaddingTop(4).Background(DashboardPdfRenderer.Primary).Padding(5).Row(r =>
                    {
                        r.RelativeItem().Text(label("Pdf_Invoice_GrandTotal")).Bold().FontSize(11).FontColor(Colors.White);
                        r.AutoItem().Text($"{Money(totals.GrossAmount, culture)} {document.Currency}").Bold().FontSize(11).FontColor(Colors.White);
                    });
                });
            });

            col.Item().Text(t =>
            {
                t.Span($"{label("Pdf_Invoice_InWords")}: ").FontColor(DashboardPdfRenderer.Muted);
                t.Span(AmountInWords.ToWords(document.Totals.GrossAmount, document.Currency, culture)).Italic();
            });

            if (!string.IsNullOrWhiteSpace(document.Notes))
            {
                col.Item().Element(c => Block(c, label("Pdf_Invoice_Notes"), document.Notes!));
            }

            var payment = PaymentText(document.Company, label);
            if (payment is not null)
            {
                col.Item().Element(c => Block(c, label("Pdf_Invoice_PaymentInfo"), payment));
            }

            // Delivered by / received by, and the company's stamp and signature.
            col.Item().PaddingTop(18).ShowEntire().Row(row =>
            {
                row.RelativeItem().Element(e => SignatureBox(e, label("Pdf_Invoice_DeliveredBy"), null));
                row.ConstantItem(20);
                row.RelativeItem().Element(e => SignatureBox(e, label("Pdf_Invoice_ReceivedBy"), null));
                row.ConstantItem(20);
                row.RelativeItem().Element(e => SignatureBox(e, label("Pdf_Invoice_StampAndSignature"), document.Company.Stamp));
            });
        });
    }

    private static void SignatureBox(IContainer container, string caption, byte[]? image) => container.Column(c =>
    {
        c.Item().Height(64).AlignCenter().AlignMiddle().Element(e =>
        {
            if (image is not null) e.Image(image).FitArea();
        });
        c.Item().BorderTop(0.8f).BorderColor(DashboardPdfRenderer.Ink).PaddingTop(3).AlignCenter()
            .Text(caption).FontSize(8).FontColor(DashboardPdfRenderer.Muted);
    });

    private static string? Join(string separator, params string?[] parts)
    {
        var present = parts.Where(p => !string.IsNullOrWhiteSpace(p)).ToList();
        return present.Count == 0 ? null : string.Join(separator, present);
    }

    private static string? Captioned(string caption, string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : $"{caption}: {value}";

    private static string? PaymentText(InvoiceDocumentCompany company, Func<string, string> label)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(company.PaymentInstructions)) parts.Add(company.PaymentInstructions!);
        var banks = company.BankAccounts is { Count: > 0 } list
            ? list
            : !string.IsNullOrWhiteSpace(company.BankName) || !string.IsNullOrWhiteSpace(company.Iban)
                ? new[] { new InvoiceDocumentBank(company.BankName ?? string.Empty, null, company.Iban, null) }
                : Array.Empty<InvoiceDocumentBank>();
        foreach (var bank in banks)
        {
            var bankParts = new List<string>();
            if (!string.IsNullOrWhiteSpace(bank.BankName)) bankParts.Add($"{label("Pdf_Invoice_Bank")}: {bank.BankName}");
            if (!string.IsNullOrWhiteSpace(bank.Iban)) bankParts.Add($"IBAN: {bank.Iban}");
            if (!string.IsNullOrWhiteSpace(bank.SwiftBic)) bankParts.Add($"{label("Pdf_Invoice_Swift")}: {bank.SwiftBic}");
            if (!string.IsNullOrWhiteSpace(bank.AccountHolder)) bankParts.Add($"{label("Pdf_Invoice_AccountHolder")}: {bank.AccountHolder}");
            if (bankParts.Count > 0) parts.Add(string.Join(" · ", bankParts));
        }
        return parts.Count == 0 ? null : string.Join("\n", parts);
    }

    private static void Footer(IContainer container, InvoiceDocument document, Func<string, string> label)
    {
        container.Column(col =>
        {
            col.Item().LineHorizontal(0.6f).LineColor(DashboardPdfRenderer.Rule);
            if (!string.IsNullOrWhiteSpace(document.Company.DocumentFooter))
            {
                col.Item().PaddingTop(4).AlignCenter().Text(document.Company.DocumentFooter!).FontSize(8).FontColor(DashboardPdfRenderer.Muted);
            }

            col.Item().PaddingTop(4).Row(row =>
            {
                row.RelativeItem().Text(label("Pdf_Invoice_GeneratedBy")).FontSize(7).FontColor(DashboardPdfRenderer.Muted);
                row.AutoItem().Text(t =>
                {
                    t.DefaultTextStyle(s => s.FontSize(7).FontColor(DashboardPdfRenderer.Muted));
                    t.CurrentPageNumber();
                    t.Span(" / ");
                    t.TotalPages();
                });
            });
        });
    }

    private static void Optional(ColumnDescriptor col, string? value, string? caption = null)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        col.Item().Text(caption is null ? value : $"{caption}: {value}").FontColor(DashboardPdfRenderer.Muted);
    }

    private static void KeyValue(ColumnDescriptor col, string key, string value) => col.Item().Row(r =>
    {
        r.RelativeItem().Text(key).FontColor(DashboardPdfRenderer.Muted);
        r.AutoItem().Text(value).SemiBold();
    });

    private static void HeaderCell(TableCellDescriptor header, string text, bool left = false)
    {
        var cell = header.Cell().BorderBottom(1).BorderColor(DashboardPdfRenderer.Ink).PaddingVertical(4);
        (left ? cell : cell.AlignRight()).Text(text).SemiBold().FontSize(8).FontColor(DashboardPdfRenderer.Muted);
    }

    // The line table's denser row (13 columns, 7.5 pt).
    private static IContainer LineCell(TableDescriptor table) =>
        table.Cell().BorderBottom(0.5f).BorderColor(DashboardPdfRenderer.Rule).PaddingVertical(2.5f).PaddingRight(2);

    private static IContainer Cell(TableDescriptor table) =>
        table.Cell().BorderBottom(0.5f).BorderColor(DashboardPdfRenderer.Rule).PaddingVertical(4);

    private static void TotalRow(ColumnDescriptor col, string key, string value) => col.Item().PaddingVertical(1).Row(r =>
    {
        r.RelativeItem().Text(key).FontColor(DashboardPdfRenderer.Muted);
        r.AutoItem().Text(value);
    });

    private static void Block(IContainer container, string title, string text) => container.Column(c =>
    {
        c.Item().Text(title).SemiBold().FontSize(8).FontColor(DashboardPdfRenderer.Muted);
        c.Item().Text(text);
    });
}
