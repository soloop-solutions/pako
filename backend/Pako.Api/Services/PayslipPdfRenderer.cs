using System.Globalization;
using System.IO.Compression;
using Pako.Api.Contracts;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Pako.Api.Services;

// Renders payslips and annual statements to PDF from stored snapshots only. It never computes a
// figure: every amount printed is a field of the response it is given. Labels come from the
// caller (ErrorMessages.resx via IStringLocalizer), so the document follows the request language.
//
// QuestPDF is used under its Community licence (free below USD 1M annual gross revenue) — confirm
// Soloop's eligibility before go-live; see docs/HR_MASTER_PLAN.md D6.
public static class PayslipPdfRenderer
{
    public const string PdfContentType = "application/pdf";
    public const string ZipContentType = "application/zip";

    static PayslipPdfRenderer()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public static byte[] RenderPayslip(PayslipDocument document, Func<string, string> label, CultureInfo culture) =>
        Document.Create(container => ComposePayslip(container, document, label, culture)).GeneratePdf();

    // One PDF per payslip, named so a bank-upload or archive folder sorts by employee.
    public static byte[] RenderPayslipZip(IEnumerable<PayslipDocument> documents, Func<string, string> label, CultureInfo culture)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var document in documents)
            {
                var name = FileName(document);
                for (var i = 2; !used.Add(name); i++) name = FileName(document, i);
                var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
                using var stream = entry.Open();
                var bytes = RenderPayslip(document, label, culture);
                stream.Write(bytes, 0, bytes.Length);
            }
        }

        return buffer.ToArray();
    }

    public static string FileName(PayslipDocument document, int? suffix = null)
    {
        var safe = new string((document.Line.EmployeeName ?? "employee")
            .Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray()).Trim('-');
        return $"payslip-{document.PeriodStart:yyyyMM}-{safe}{(suffix is null ? "" : "-" + suffix)}.pdf";
    }

    public static byte[] RenderAnnualStatement(
        DocumentIssuer issuer, AnnualEmployeeStatementResponse statement, Func<string, string> label, CultureInfo culture) =>
        Document.Create(container => container.Page(page =>
        {
            SetupPage(page);
            page.Header().Element(h => Header(h, issuer, label("PdfAnnualStatementTitle"),
                string.Format(culture, label("PdfAnnualStatementYear"), statement.Year)));
            page.Content().PaddingVertical(10).Column(col =>
            {
                col.Spacing(8);
                col.Item().Element(c => KeyValues(c, new[]
                {
                    (label("PdfEmployee"), statement.EmployeeName),
                    (label("PdfPersonalNumber"), statement.PersonalNumber ?? "—"),
                }));

                col.Item().Table(table =>
                {
                    table.ColumnsDefinition(c =>
                    {
                        c.RelativeColumn(2);
                        for (var i = 0; i < 5; i++) c.RelativeColumn(2);
                    });
                    table.Header(h =>
                    {
                        foreach (var key in new[] { "PdfMonth", "PdfGross", "PdfEmployeePension", "PdfEmployerPension", "PdfPit", "PdfNetPay" })
                        {
                            h.Cell().BorderBottom(1).PaddingVertical(3).Text(label(key)).SemiBold().FontSize(8);
                        }
                    });
                    foreach (var m in statement.Months)
                    {
                        table.Cell().PaddingVertical(2).Text(m.PeriodStart.ToString("MM.yyyy", culture));
                        foreach (var v in new[] { m.GrossSalary, m.EmployeePension, m.EmployerPension, m.Pit, m.NetPay })
                        {
                            table.Cell().PaddingVertical(2).AlignRight().Text(Money(v, culture));
                        }
                    }

                    table.Cell().BorderTop(1).PaddingVertical(3).Text(label("PdfTotal")).SemiBold();
                    foreach (var v in new[] { statement.TotalGross, statement.TotalEmployeePension, statement.TotalEmployerPension, statement.TotalPit, statement.TotalNetPay })
                    {
                        table.Cell().BorderTop(1).PaddingVertical(3).AlignRight().Text(Money(v, culture)).SemiBold();
                    }
                });

                if (statement.Months.Count == 0)
                {
                    col.Item().Text(label("PdfAnnualStatementEmpty")).Italic().FontColor(Colors.Grey.Darken1);
                }
            });
            page.Footer().Element(f => Signatures(f, label));
        })).GeneratePdf();

    private static void ComposePayslip(IDocumentContainer container, PayslipDocument document, Func<string, string> label, CultureInfo culture)
    {
        var line = document.Line;
        container.Page(page =>
        {
            SetupPage(page);
            var period = $"{document.PeriodStart.ToString("dd.MM.yyyy", culture)} – {document.PeriodEnd.ToString("dd.MM.yyyy", culture)}";
            page.Header().Element(h => Header(h, document.Issuer, label("PdfPayslipTitle"), period));

            page.Content().PaddingVertical(10).Column(col =>
            {
                col.Spacing(10);
                col.Item().Element(c => KeyValues(c, new[]
                {
                    (label("PdfEmployee"), line.EmployeeName),
                    (label("PdfPersonalNumber"), line.PersonalNumber ?? "—"),
                    (label("PdfDepartment"), line.DepartmentName ?? "—"),
                    (label("PdfEmployerType"), label(line.IsPrimaryEmployer ? "PdfPrimaryEmployer" : "PdfSecondaryEmployer")),
                    (label("PdfDays"), string.Format(culture, label("PdfDaysValue"), line.PaidDays, line.WorkingDays)),
                }));

                col.Item().Element(c => Section(c, label("PdfEarnings"), new List<(string, decimal, bool)>
                {
                    (label("PdfBaseSalary"), line.BaseSalary, false),
                    (label("PdfBonuses"), line.BonusAmount, false),
                    (label("PdfOtherAdditions"), line.OtherAdditionsAmount, false),
                    (label("PdfGross"), line.GrossSalary, true),
                }, culture));

                var withholdings = new List<(string, decimal, bool)>
                {
                    (label("PdfEmployeePension"), line.EmployeePensionAmount, false),
                    (label(line.IsPrimaryEmployer ? "PdfPitPrimary" : "PdfPitSecondary"), line.PitAmount, false),
                    (label("PdfDeductions"), line.DeductionsAmount, false),
                };
                if (line.LoanRepaymentAmount != 0m) withholdings.Add(("   " + label("PdfLoanRepayments"), line.LoanRepaymentAmount, false));
                col.Item().Element(c => Section(c, label("PdfWithholdings"), withholdings, culture));

                if (line.ReimbursementAmount != 0m)
                {
                    col.Item().Element(c => Section(c, label("PdfReimbursements"), new List<(string, decimal, bool)>
                    {
                        (label("PdfReimbursements"), line.ReimbursementAmount, false),
                    }, culture));
                }

                if (line.Adjustments.Count > 0)
                {
                    col.Item().Element(c => Section(c, label("PdfAdjustments"), line.Adjustments
                        .Select(a => (
                            string.IsNullOrWhiteSpace(a.Description) ? label("PayrollKind_" + a.Kind) : $"{label("PayrollKind_" + a.Kind)} — {a.Description}",
                            a.Amount,
                            false))
                        .ToList(), culture));
                }

                col.Item().Background(Colors.Grey.Lighten3).Padding(8).Row(row =>
                {
                    row.RelativeItem().Text(label("PdfNetPay")).SemiBold().FontSize(12);
                    row.ConstantItem(140).AlignRight().Text(Money(line.NetPay, culture)).SemiBold().FontSize(12);
                });

                col.Item().Element(c => Section(c, label("PdfEmployerContributions"), new List<(string, decimal, bool)>
                {
                    (label("PdfEmployerPension"), line.EmployerPensionAmount, false),
                }, culture));
            });

            page.Footer().Element(f => Signatures(f, label));
        });
    }

    internal static void SetupPage(PageDescriptor page)
    {
        page.Size(PageSizes.A4);
        page.Margin(36);
        page.DefaultTextStyle(t => t.FontSize(9.5f));
    }

    internal static void Header(IContainer container, DocumentIssuer issuer, string title, string subtitle)
    {
        container.BorderBottom(1).PaddingBottom(6).Row(row =>
        {
            row.RelativeItem().Column(c =>
            {
                c.Item().Text(issuer.Name).SemiBold().FontSize(11);
                if (issuer.FiscalNumber is not null || issuer.BusinessNumber is not null)
                {
                    c.Item().Text(string.Join(" · ", new[] { issuer.FiscalNumber, issuer.BusinessNumber }.Where(x => !string.IsNullOrWhiteSpace(x))))
                        .FontSize(8).FontColor(Colors.Grey.Darken1);
                }
                if (issuer.Address is not null) c.Item().Text(issuer.Address).FontSize(8).FontColor(Colors.Grey.Darken1);
            });
            row.RelativeItem().AlignRight().Column(c =>
            {
                c.Item().AlignRight().Text(title).SemiBold().FontSize(13);
                c.Item().AlignRight().Text(subtitle).FontSize(9);
            });
        });
    }

    private static void KeyValues(IContainer container, IEnumerable<(string Label, string Value)> rows)
    {
        container.Column(col =>
        {
            foreach (var (l, v) in rows)
            {
                col.Item().Row(r =>
                {
                    r.ConstantItem(150).Text(l).FontColor(Colors.Grey.Darken2);
                    r.RelativeItem().Text(v);
                });
            }
        });
    }

    private static void Section(IContainer container, string title, List<(string Label, decimal Amount, bool Strong)> rows, CultureInfo culture)
    {
        container.Column(col =>
        {
            col.Item().BorderBottom(0.5f).PaddingBottom(2).Text(title).SemiBold();
            foreach (var (l, amount, strong) in rows)
            {
                col.Item().PaddingTop(2).Row(r =>
                {
                    var labelText = r.RelativeItem().Text(l);
                    var valueText = r.ConstantItem(140).AlignRight().Text(Money(amount, culture));
                    if (strong)
                    {
                        labelText.SemiBold();
                        valueText.SemiBold();
                    }
                });
            }
        });
    }

    private static void Signatures(IContainer container, Func<string, string> label)
    {
        container.PaddingTop(30).Row(row =>
        {
            row.RelativeItem().PaddingRight(40).BorderTop(0.5f).PaddingTop(3).Text(label("PdfEmployerSignature")).FontSize(8);
            row.RelativeItem().PaddingLeft(40).BorderTop(0.5f).PaddingTop(3).Text(label("PdfEmployeeSignature")).FontSize(8);
        });
    }

    private static string Money(decimal value, CultureInfo culture) => value.ToString("N2", culture) + " €";
}
