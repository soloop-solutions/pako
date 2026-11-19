using System.Globalization;
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
        Document.Create(container => container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(32);
            page.DefaultTextStyle(t => t.FontSize(9).FontColor(DashboardPdfRenderer.Ink));
            page.Header().Element(h => Header(h, document, label));
            page.Content().PaddingVertical(12).Element(c => Body(c, document, label, culture));
            page.Footer().Element(f => Footer(f, document, label));
        })).WithMetadata(Metadata(document, label)).GeneratePdf();

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
                        left.ConstantItem(48).Height(48).Image(logo).FitArea();
                    }
                    else
                    {
                        var initial = company.Name.Length > 0 ? company.Name[..1].ToUpperInvariant() : "?";
                        left.ConstantItem(48).Height(48).Background(DashboardPdfRenderer.Primary)
                            .AlignCenter().AlignMiddle().Text(initial).FontColor(Colors.White).Bold().FontSize(18);
                    }

                    left.ConstantItem(10);
                    left.RelativeItem().Column(c =>
                    {
                        c.Item().Text(company.Name).Bold().FontSize(13);
                        Optional(c, company.StreetAddress);
                        Optional(c, string.Join(", ", new[] { company.Municipality, company.Country }.Where(p => !string.IsNullOrWhiteSpace(p))));
                        Optional(c, company.VatNumber, label("Pdf_Invoice_VatNumber"));
                        Optional(c, company.FiscalNumber, label("Pdf_Invoice_FiscalNumber"));
                        Optional(c, company.BusinessNumber, label("Pdf_Invoice_BusinessNumber"));
                        Optional(c, company.Phone);
                        Optional(c, company.Email);
                    });
                });

                row.ConstantItem(190).AlignRight().Column(c =>
                {
                    c.Item().AlignRight().Text(Title(document.Type, label)).Bold().FontSize(18).FontColor(DashboardPdfRenderer.Primary);
                    c.Item().AlignRight().Text(document.Number is { } number
                        ? $"{label("Pdf_Invoice_Number")}: {number}"
                        : label("Pdf_Invoice_Draft")).FontSize(10);
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
        var hasDiscount = document.Lines.Any(l => l.DiscountPercent > 0);
        container.Column(col =>
        {
            col.Spacing(12);
            col.Item().Row(row =>
            {
                row.RelativeItem().Column(c =>
                {
                    c.Item().Text(label("Pdf_Invoice_BillTo")).FontColor(DashboardPdfRenderer.Muted).FontSize(8);
                    c.Item().Text(document.Customer.Name).Bold().FontSize(11);
                    Optional(c, document.Customer.StreetAddress);
                    Optional(c, document.Customer.TaxNumber, label("Pdf_Invoice_VatNumber"));
                    Optional(c, document.Customer.FiscalNumber, label("Pdf_Invoice_FiscalNumber"));
                });
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

            col.Item().Table(table =>
            {
                table.ColumnsDefinition(c =>
                {
                    c.RelativeColumn(5);
                    c.RelativeColumn(1.4f);
                    c.RelativeColumn(1.8f);
                    if (hasDiscount) c.RelativeColumn(1.2f);
                    c.RelativeColumn(1.1f);
                    c.RelativeColumn(1.6f);
                    c.RelativeColumn(2);
                });
                table.Header(h =>
                {
                    HeaderCell(h, label("Pdf_Invoice_Col_Description"), left: true);
                    HeaderCell(h, label("Pdf_Invoice_Col_Quantity"));
                    HeaderCell(h, label("Pdf_Invoice_Col_UnitPrice"));
                    if (hasDiscount) HeaderCell(h, label("Pdf_Invoice_Col_Discount"));
                    HeaderCell(h, label("Pdf_Invoice_Col_Vat"));
                    HeaderCell(h, label("Pdf_Invoice_Col_VatAmount"));
                    HeaderCell(h, label("Pdf_Invoice_Col_Total"));
                });
                foreach (var line in document.Lines)
                {
                    Cell(table).Text(line.Description);
                    Cell(table).AlignRight().Text(line.UnitName is { Length: > 0 } unit
                        ? $"{line.Quantity.ToString("0.###", culture)} {unit}"
                        : line.Quantity.ToString("0.###", culture));
                    Cell(table).AlignRight().Text(Money(line.UnitPrice, culture));
                    if (hasDiscount)
                    {
                        Cell(table).AlignRight().Text(line.DiscountPercent > 0 ? $"{line.DiscountPercent.ToString("0.##", culture)}%" : "—");
                    }

                    Cell(table).AlignRight().Text(line.TaxLabel ?? "—");
                    Cell(table).AlignRight().Text(Money(line.Amounts.TaxAmount, culture));
                    Cell(table).AlignRight().Text(Money(line.Amounts.GrossAmount, culture));
                }
            });

            col.Item().AlignRight().Width(240).Column(c =>
            {
                var totals = document.Totals;
                if (totals.DiscountAmount != 0)
                {
                    TotalRow(c, label("Pdf_Invoice_AmountBeforeDiscount"), Money(totals.AmountBeforeDiscount, culture));
                    TotalRow(c, label("Pdf_Invoice_TotalDiscount"), "-" + Money(totals.DiscountAmount, culture));
                }

                TotalRow(c, label("Pdf_Invoice_Subtotal"), Money(totals.NetAmount, culture));
                foreach (var tax in document.Taxes)
                {
                    // "TVSH 18%" already names its rate; only add it when the tax's name doesn't.
                    var rate = $"{(tax.Rate * 100).ToString("0.##", culture)}%";
                    TotalRow(c, tax.Label.Contains(rate) ? tax.Label : $"{tax.Label} ({rate})", Money(tax.Tax, culture));
                }

                TotalRow(c, label("Pdf_Invoice_TotalVat"), Money(totals.TaxAmount, culture));
                c.Item().PaddingTop(4).BorderTop(1).BorderColor(DashboardPdfRenderer.Ink).PaddingTop(4).Row(r =>
                {
                    r.RelativeItem().Text(label("Pdf_Invoice_GrandTotal")).Bold().FontSize(11);
                    r.AutoItem().Text($"{Money(totals.GrossAmount, culture)} {document.Currency}").Bold().FontSize(11);
                });
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
        });
    }

    private static string? PaymentText(InvoiceDocumentCompany company, Func<string, string> label)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(company.PaymentInstructions)) parts.Add(company.PaymentInstructions!);
        if (!string.IsNullOrWhiteSpace(company.Iban)) parts.Add($"IBAN: {company.Iban}");
        if (!string.IsNullOrWhiteSpace(company.BankName)) parts.Add($"{label("Pdf_Invoice_Bank")}: {company.BankName}");
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
