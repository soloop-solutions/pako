using System.Globalization;
using Pako.Api.Contracts;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Pako.Api.Services;

// docs/INVENTORY_PLAN.md §5.5: the printable count sheet — every stock-tracked item of a warehouse
// with empty "counted" and "difference" columns to fill in by hand, signed by whoever counted and
// checked. A blind sheet leaves out the book quantity so the count isn't steered by it. Same page
// layout and QuestPDF licence as PayslipPdfRenderer.
public static class StockPdfRenderer
{
    static StockPdfRenderer()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public static byte[] RenderCountSheet(DocumentIssuer issuer, string warehouseName, DateOnly date, bool blind,
        IReadOnlyList<CountSheetRowResponse> rows, Func<string, string> label, CultureInfo culture) =>
        Document.Create(container => container.Page(page =>
        {
            PayslipPdfRenderer.SetupPage(page);
            page.Header().Element(h => PayslipPdfRenderer.Header(h, issuer, label("PdfCountSheetTitle"),
                string.Format(culture, label("PdfCountSheetSubtitle"), warehouseName, date.ToString("d", culture))));
            page.Content().PaddingVertical(10).Table(table =>
            {
                table.ColumnsDefinition(c =>
                {
                    c.ConstantColumn(28);
                    c.ConstantColumn(48);
                    c.RelativeColumn(4);
                    c.ConstantColumn(48);
                    if (!blind) c.ConstantColumn(64);
                    c.ConstantColumn(64);
                    c.ConstantColumn(64);
                    c.RelativeColumn(2);
                });
                table.Header(h =>
                {
                    void Cell(string text, bool right = false)
                    {
                        var cell = h.Cell().BorderBottom(1).PaddingVertical(3).PaddingHorizontal(2);
                        (right ? cell.AlignRight() : cell).Text(text).SemiBold().FontSize(8.5f);
                    }
                    Cell("#");
                    Cell(label("PdfCountSheetCode"));
                    Cell(label("PdfCountSheetItem"));
                    Cell(label("PdfCountSheetUnit"));
                    if (!blind) Cell(label("PdfCountSheetBook"), right: true);
                    Cell(label("PdfCountSheetCounted"), right: true);
                    Cell(label("PdfCountSheetDifference"), right: true);
                    Cell(label("PdfCountSheetNote"));
                });
                var n = 0;
                foreach (var row in rows)
                {
                    n++;
                    IContainer Cell() => table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten1).MinHeight(20).PaddingVertical(3).PaddingHorizontal(2);
                    Cell().Text(n.ToString(culture)).FontColor(Colors.Grey.Darken1);
                    Cell().Text(row.ItemCode.ToString(culture));
                    Cell().Text(row.ItemName);
                    Cell().Text(row.Unit);
                    if (!blind) Cell().AlignRight().Text(row.BookQuantity.ToString("#,0.####", culture));
                    Cell();
                    Cell();
                    Cell();
                }
            });
            page.Footer().Column(col =>
            {
                col.Item().PaddingTop(24).Row(row =>
                {
                    row.RelativeItem().PaddingRight(40).BorderTop(0.5f).PaddingTop(3).Text(label("PdfCountSheetCountedBy")).FontSize(8);
                    row.RelativeItem().PaddingLeft(40).BorderTop(0.5f).PaddingTop(3).Text(label("PdfCountSheetCheckedBy")).FontSize(8);
                });
                col.Item().PaddingTop(6).AlignRight().Text(t =>
                {
                    t.DefaultTextStyle(s => s.FontSize(7.5f).FontColor(Colors.Grey.Darken1));
                    t.CurrentPageNumber();
                    t.Span(" / ");
                    t.TotalPages();
                });
            });
        })).GeneratePdf();

    // §12 P4: the price-change record (Nivelim) — old and new shelf price, quantity on hand and the
    // difference, signed by whoever changed the shelf labels. Every figure comes from the response.
    public static byte[] RenderPriceChange(DocumentIssuer issuer, PriceChangeResponse change, Func<string, string> label, CultureInfo culture) =>
        Document.Create(container => container.Page(page =>
        {
            PayslipPdfRenderer.SetupPage(page);
            page.Header().Element(h => PayslipPdfRenderer.Header(h, issuer, label("PdfPriceChangeTitle"),
                string.Format(culture, label("PdfPriceChangeSubtitle"), change.Number ?? label("PdfDraft"), change.PriceListName,
                    change.Date.ToString("d", culture))));
            page.Content().PaddingVertical(10).Column(col =>
            {
                col.Item().Table(table =>
                {
                    table.ColumnsDefinition(c =>
                    {
                        c.ConstantColumn(48);
                        c.RelativeColumn(4);
                        c.ConstantColumn(40);
                        c.ConstantColumn(56);
                        c.ConstantColumn(64);
                        c.ConstantColumn(64);
                        c.ConstantColumn(72);
                    });
                    table.Header(h =>
                    {
                        void Cell(string text, bool right = false)
                        {
                            var cell = h.Cell().BorderBottom(1).PaddingVertical(3).PaddingHorizontal(2);
                            (right ? cell.AlignRight() : cell).Text(text).SemiBold().FontSize(8.5f);
                        }
                        Cell(label("PdfCountSheetCode"));
                        Cell(label("PdfCountSheetItem"));
                        Cell(label("PdfCountSheetUnit"));
                        Cell(label("PdfPriceChangeQuantity"), right: true);
                        Cell(label("PdfPriceChangeOld"), right: true);
                        Cell(label("PdfPriceChangeNew"), right: true);
                        Cell(label("PdfPriceChangeDifference"), right: true);
                    });
                    foreach (var line in change.Lines)
                    {
                        IContainer Cell() => table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten1).PaddingVertical(3).PaddingHorizontal(2);
                        Cell().Text(line.ItemCode.ToString(culture));
                        Cell().Text(line.ItemName);
                        Cell().Text(line.Unit);
                        Cell().AlignRight().Text((line.Quantity ?? 0m).ToString("#,0.####", culture));
                        Cell().AlignRight().Text(line.OldPrice is { } o ? o.ToString("#,0.00##", culture) : "—");
                        Cell().AlignRight().Text(line.NewPrice.ToString("#,0.00##", culture));
                        Cell().AlignRight().Text((line.Difference ?? 0m).ToString("#,0.00", culture));
                    }
                });
                col.Item().PaddingTop(6).AlignRight().Text(string.Format(culture, label("PdfPriceChangeTotal"),
                    change.TotalDifference.ToString("#,0.00", culture))).SemiBold();
            });
            page.Footer().PaddingTop(24).Row(row =>
            {
                row.RelativeItem().PaddingRight(40).BorderTop(0.5f).PaddingTop(3).Text(label("PdfPriceChangePreparedBy")).FontSize(8);
                row.RelativeItem().PaddingLeft(40).BorderTop(0.5f).PaddingTop(3).Text(label("PdfPriceChangeApprovedBy")).FontSize(8);
            });
        })).GeneratePdf();
}
