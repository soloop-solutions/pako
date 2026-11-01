using System.Globalization;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Pako.Api.Services;

// docs/POS_PLAN.md P2: shelf labels — name, price, unit price, code and barcode — three to a row
// on A4, cut along the borders. Same QuestPDF licence as the other renderers.
public static class PosLabelRenderer
{
    static PosLabelRenderer()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public record Label(string Name, decimal? Price, string Unit, string Code, string? Barcode, string? Plu);

    public static byte[] Render(IReadOnlyList<Label> labels, string storeName, DateOnly printed, Func<string, string> text, CultureInfo culture) =>
        Document.Create(container => container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(8, Unit.Millimetre);
            page.DefaultTextStyle(t => t.FontSize(9));
            page.Content().Table(table =>
            {
                table.ColumnsDefinition(c =>
                {
                    c.RelativeColumn();
                    c.RelativeColumn();
                    c.RelativeColumn();
                });
                foreach (var label in labels)
                {
                    table.Cell().Border(0.5f).BorderColor(Colors.Grey.Medium).Padding(5).MinHeight(36, Unit.Millimetre).Column(col =>
                    {
                        col.Item().Text(label.Name).SemiBold().FontSize(10).ClampLines(2);
                        col.Item().PaddingTop(4).AlignRight().Text(label.Price is { } p ? p.ToString("N2", culture) + " €" : "—").Bold().FontSize(22);
                        col.Item().AlignRight().Text($"{text("PdfLabelPer")} {label.Unit}").FontSize(7.5f).FontColor(Colors.Grey.Darken1);
                        col.Item().PaddingTop(4).Row(row =>
                        {
                            row.RelativeItem().Text(label.Barcode ?? "").FontFamily("Courier New").FontSize(8);
                            row.ConstantItem(70).AlignRight().Text($"#{label.Code}{(label.Plu is { } plu ? " · PLU " + plu : "")}").FontSize(7.5f);
                        });
                        col.Item().Text($"{storeName} · {printed.ToString("d", culture)}").FontSize(6.5f).FontColor(Colors.Grey.Darken1);
                    });
                }
            });
        })).GeneratePdf();
}
