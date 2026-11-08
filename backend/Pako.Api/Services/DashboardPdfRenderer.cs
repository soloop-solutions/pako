using System.Globalization;
using System.Text.RegularExpressions;
using Pako.Api.Contracts;
using Pako.Domain.Reporting;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Pako.Api.Services;

public record DashboardPdfInput(
    DocumentIssuer Issuer,
    byte[]? Logo,
    string Currency,
    DashboardResponse Data,
    IReadOnlyList<DashboardWidgetConfig> Widgets,
    Func<string, string> Label,
    CultureInfo Culture,
    DateTime Generated);

public static class DashboardPdfRenderer
{
    public const string PdfContentType = "application/pdf";

    public const string Primary = "#2B5C6B";
    public const string Ink = "#2A2824";
    public const string Muted = "#6F6D66";
    public const string Rule = "#E1E0D9";
    public const string Good = "#006300";
    public const string Bad = "#D03B3B";
    private const string Current = "#2A78D6";
    private const string Previous = "#EB6834";
    private const string Other = "#898781";
    private static readonly string[] Categorical = ["#2A78D6", "#EB6834", "#1BAF7A", "#EDA100", "#E87BA4", "#008300"];
    private static readonly string[] Ordinal = ["#86B6EF", "#5598E7", "#2A78D6", "#1C5CAB", "#104281"];
    private static readonly string[] AgingKeys = ["notDue", "d1to30", "d31to60", "d61to90", "d90plus"];

    private const float PageWidth = 595.28f;
    private const float Margin = 32f;
    private const float Gap = 8f;
    private const float CardPadding = 8f;
    private const float AxisWidth = 34f;

    private static readonly HashSet<string> Uncomparable =
        ["kpi.overdueReceivables", "kpi.overduePayables", "kpi.lowStock", "revenueVsExpenses", "receivablesAging", "payablesAging"];

    private static readonly HashSet<string> BalanceKpis =
        ["kpi.cash", "kpi.receivables", "kpi.payables", "kpi.overdueReceivables", "kpi.overduePayables", "kpi.headcount", "kpi.stockValue", "kpi.lowStock"];

    private static readonly HashSet<string> DownIsGood =
        ["kpi.expenses", "kpi.receivables", "kpi.payables", "kpi.overdueReceivables", "kpi.overduePayables", "kpi.purchasesNet", "kpi.payrollCost", "kpi.lowStock"];

    private static readonly HashSet<string> PercentKpis = ["kpi.netMargin", "kpi.stockMargin"];
    private static readonly HashSet<string> CountKpis = ["kpi.invoiceCount", "kpi.headcount", "kpi.lowStock"];

    static DashboardPdfRenderer()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public static bool IsVisible(string key, DashboardSections s) => key switch
    {
        "kpi.revenue" or "kpi.expenses" or "kpi.netProfit" or "kpi.grossProfit" or "kpi.netMargin" or "kpi.cash" or "kpi.receivables"
            or "kpi.payables" or "revenueTrend" or "revenueVsExpenses" or "profitTrend" or "cashTrend" or "revenueBreakdown"
            or "expenseBreakdown" => s.Finance,
        "kpi.overdueReceivables" or "receivablesAging" => s.Finance || s.Sales,
        "kpi.overduePayables" or "payablesAging" => s.Finance || s.Purchases,
        "kpi.salesNet" or "kpi.invoiceCount" or "kpi.averageInvoice" or "topCustomers" or "topItems" => s.Sales,
        "kpi.purchasesNet" or "topVendors" => s.Purchases,
        "kpi.payrollCost" or "payrollTrend" => s.Payroll,
        "kpi.headcount" or "headcountByDepartment" => s.Hr,
        "kpi.stockValue" or "kpi.lowStock" or "kpi.stockMargin" or "stockByItem" => s.Inventory,
        _ => false,
    };

    public static IReadOnlyList<DashboardWidgetConfig> Printable(IEnumerable<DashboardWidgetConfig> widgets, DashboardResponse data) =>
        widgets.Where(w => IsVisible(w.Key, data.Sections)
            && (!w.Key.StartsWith("kpi.") || data.Kpis.Any(k => k.Key == w.Key[4..]))).ToList();

    public static byte[] Render(DashboardPdfInput input) =>
        Document.Create(container => container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(Margin);
            page.DefaultTextStyle(t => t.FontSize(9).FontColor(Ink));
            page.Header().Element(h => Header(h, input));
            page.Content().PaddingVertical(10).Element(c => Body(c, input));
            page.Footer().Element(f => Footer(f, input));
        })).GeneratePdf();

    private static string RangeLabel(DateOnly from, DateOnly to, CultureInfo c)
    {
        var lastOfMonth = to.Day == DateTime.DaysInMonth(to.Year, to.Month);
        if (from.Day == 1 && lastOfMonth)
        {
            if (from.Year == to.Year && from.Month == to.Month) return from.ToString("MMMM yyyy", c);
            if (from.Year == to.Year && from.Month == 1 && to.Month == 12) return from.Year.ToString(c);
            if (from.Year == to.Year && (from.Month - 1) % 3 == 0 && to.Month == from.Month + 2) return $"Q{(from.Month - 1) / 3 + 1} {from.Year}";
        }

        return $"{from.ToString("d MMM yyyy", c)} – {to.ToString("d MMM yyyy", c)}";
    }

    private static string BucketLabel(DateOnly start, string granularity, CultureInfo c) => granularity switch
    {
        "month" => start.ToString("MMM yy", c),
        "quarter" => $"Q{(start.Month - 1) / 3 + 1} {start.Year % 100:00}",
        _ => start.ToString("d MMM", c),
    };

    private static string Money(decimal v, CultureInfo c) => v.ToString("N2", c);
    private static string Count(decimal v, CultureInfo c) => v.ToString("#,0", c);
    private static string Percent(decimal v, CultureInfo c) => v.ToString("#,0.#", c) + "%";

    private static string Compact(decimal v, CultureInfo c)
    {
        var a = Math.Abs(v);
        if (a >= 1_000_000m) return (v / 1_000_000m).ToString("0.#", c) + "M";
        if (a >= 1_000m) return (v / 1_000m).ToString("0.#", c) + "K";
        return v.ToString("0.##", c);
    }

    private static void Header(IContainer container, DashboardPdfInput input)
    {
        var c = input.Culture;
        var d = input.Data;
        container.BorderBottom(1.5f).BorderColor(Primary).PaddingBottom(8).Row(row =>
        {
            row.ConstantItem(30).Height(30).Element(tile =>
            {
                if (input.Logo is not null)
                {
                    tile.Image(input.Logo).FitArea();
                }
                else
                {
                    var initial = input.Issuer.Name.Trim().Length > 0 ? input.Issuer.Name.Trim()[..1].ToUpper(c) : "P";
                    tile.Background(Primary).AlignCenter().AlignMiddle().Text(initial).FontColor(Colors.White).Bold().FontSize(15);
                }
            });
            row.RelativeItem().PaddingLeft(9).Column(col =>
            {
                col.Item().Text(input.Issuer.Name).SemiBold().FontSize(12);
                var ids = string.Join(" · ", new[] { input.Issuer.FiscalNumber, input.Issuer.BusinessNumber }.Where(x => !string.IsNullOrWhiteSpace(x)));
                if (ids.Length > 0) col.Item().Text(ids).FontSize(7.5f).FontColor(Muted);
            });
            row.RelativeItem().AlignRight().Column(col =>
            {
                col.Item().AlignRight().Text(input.Label("Dash_Title")).Bold().FontSize(15).FontColor(Primary);
                col.Item().AlignRight().Text(RangeLabel(d.From, d.To, c)).SemiBold().FontSize(9);
                if (d.CompareFrom is { } cf && d.CompareTo is { } ct)
                {
                    col.Item().AlignRight().Text(string.Format(c, input.Label("Dash_Compared"), RangeLabel(d.From, d.To, c), RangeLabel(cf, ct, c)))
                        .FontSize(7.5f).FontColor(Muted);
                }
            });
        });
    }

    private static void Footer(IContainer container, DashboardPdfInput input)
    {
        var c = input.Culture;
        container.BorderTop(0.5f).BorderColor(Rule).PaddingTop(4).Row(row =>
        {
            row.RelativeItem().Text(string.Format(c, input.Label("Dash_Generated"), input.Generated.ToString("d MMM yyyy HH:mm", c)))
                .FontSize(7.5f).FontColor(Muted);
            row.RelativeItem().AlignCenter().Text(string.Format(c, input.Label("Dash_Amounts"), input.Currency)).FontSize(7.5f).FontColor(Muted);
            row.RelativeItem().AlignRight().Text(t =>
            {
                t.DefaultTextStyle(s => s.FontSize(7.5f).FontColor(Muted));
                foreach (var part in Regex.Split(input.Label("Dash_Page"), @"(\{0\}|\{1\})"))
                {
                    if (part == "{0}") t.CurrentPageNumber();
                    else if (part == "{1}") t.TotalPages();
                    else if (part.Length > 0) t.Span(part);
                }
            });
        });
    }

    private static void Body(IContainer container, DashboardPdfInput input)
    {
        if (input.Widgets.Count == 0)
        {
            container.Text(input.Label("Dash_Empty")).FontColor(Muted);
            return;
        }

        var rows = new List<List<DashboardWidgetConfig>>();
        var used = 0;
        foreach (var w in input.Widgets)
        {
            var size = Math.Clamp(w.Size, 1, 4);
            if (rows.Count == 0 || used + size > 4)
            {
                rows.Add([]);
                used = 0;
            }
            rows[^1].Add(w);
            used += size;
        }

        container.Column(col =>
        {
            col.Spacing(Gap);
            foreach (var group in rows)
            {
                col.Item().ShowEntire().Row(row =>
                {
                    row.Spacing(Gap);
                    foreach (var w in group)
                    {
                        row.RelativeItem(Math.Clamp(w.Size, 1, 4)).Element(card => Card(card, input, w));
                    }
                    var left = 4 - group.Sum(w => Math.Clamp(w.Size, 1, 4));
                    if (left > 0) row.RelativeItem(left);
                });
            }
        });
    }

    private static float InnerWidth(int size) => (PageWidth - 2 * Margin - 3 * Gap) / 4 * size + Gap * (size - 1) - 2 * CardPadding - 1.2f;

    private static void Card(IContainer container, DashboardPdfInput input, DashboardWidgetConfig w)
    {
        var d = input.Data;
        var c = input.Culture;
        var size = Math.Clamp(w.Size, 1, 4);
        var currentName = RangeLabel(d.From, d.To, c);
        var previousName = d.CompareFrom is { } pf && d.CompareTo is { } pt ? RangeLabel(pf, pt, c) : string.Empty;
        var hasCompare = w.ShowComparison && !Uncomparable.Contains(w.Key) && d.CompareSeries is not null;
        var title = input.Label("Dash_W_" + w.Key.Replace('.', '_'));
        var asOf = string.Format(c, input.Label("Dash_AsOf"), d.To.ToString("d MMM yyyy", c));
        var subtitle = currentName;
        Action<IContainer> body = _ => { };

        if (w.Key.StartsWith("kpi."))
        {
            var kpi = d.Kpis.First(k => k.Key == w.Key[4..]);
            subtitle = BalanceKpis.Contains(w.Key) ? asOf : currentName;
            body = b => KpiBody(b, input, w, kpi, hasCompare, previousName);
        }
        else if (w.Key is "revenueTrend" or "profitTrend" or "cashTrend" or "payrollTrend" or "revenueVsExpenses")
        {
            Func<DashboardPoint, decimal> pick = w.Key switch
            {
                "revenueTrend" => p => p.Revenue,
                "profitTrend" => p => p.NetProfit,
                "cashTrend" => p => p.CashBalance,
                _ => p => p.PayrollCost,
            };
            var series = w.Key == "revenueVsExpenses"
                ? new List<ChartSeries>
                {
                    new(input.Label("Dash_Revenue"), Current, d.Series.Select(p => p.Revenue).ToList()),
                    new(input.Label("Dash_Expenses"), Previous, d.Series.Select(p => p.Expenses).ToList()),
                }
                : new List<ChartSeries> { new(currentName, Current, d.Series.Select(pick).ToList()) };
            if (hasCompare && w.Key != "revenueVsExpenses")
            {
                series.Add(new ChartSeries(previousName, Previous, d.CompareSeries!.Select(pick).ToList()));
                subtitle = string.Format(c, input.Label("Dash_Compared"), currentName, previousName);
            }
            var labels = d.Series.Select(p => BucketLabel(p.Start, d.Granularity, c)).ToList();
            body = b => TimeSeriesBody(b, input, w, series, labels, size);
        }
        else if (w.Key is "receivablesAging" or "payablesAging")
        {
            var buckets = w.Key == "receivablesAging" ? d.ReceivablesAging : d.PayablesAging;
            subtitle = string.Format(c, input.Label("Dash_OpenAt"), (d.AgingAsOf ?? d.To).ToString("d MMM yyyy", c));
            body = b => AgingBody(b, input, w, buckets, size);
        }
        else
        {
            var items = w.Key switch
            {
                "revenueBreakdown" => d.RevenueByAccount,
                "expenseBreakdown" => d.ExpensesByAccount,
                "topCustomers" => d.TopCustomers,
                "topVendors" => d.TopVendors,
                "topItems" => d.TopItems,
                "headcountByDepartment" => d.HeadcountByDepartment,
                _ => d.StockByItem ?? [],
            };
            if (w.Key == "headcountByDepartment" || (w.Key == "stockByItem" && !hasCompare)) subtitle = asOf;
            else if (hasCompare) subtitle = string.Format(c, input.Label("Dash_Compared"), currentName, previousName);
            body = b => RankBody(b, input, w, items, hasCompare, currentName, previousName);
        }

        container.Background(Colors.White).Border(0.6f).BorderColor(Rule).Padding(CardPadding).Column(col =>
        {
            col.Spacing(4);
            col.Item().Text(title).SemiBold().FontSize(w.Key.StartsWith("kpi.") ? 8.5f : 9.5f).FontColor(w.Key.StartsWith("kpi.") ? Muted : Ink);
            col.Item().Text(subtitle).FontSize(7).FontColor(Muted);
            col.Item().PaddingTop(2).Element(body);
        });
    }

    private static void KpiBody(IContainer container, DashboardPdfInput input, DashboardWidgetConfig w, DashboardKpi kpi, bool hasCompare, string previousName)
    {
        var c = input.Culture;
        string Format(decimal v) => PercentKpis.Contains(w.Key) ? Percent(v, c) : CountKpis.Contains(w.Key) ? Count(v, c) : Money(v, c);
        var hero = w.Visual == "hero";
        container.Column(col =>
        {
            col.Spacing(3);
            col.Item().Text(Format(kpi.Current)).Bold().FontSize(hero ? 20 : 15);
            if (w.Visual != "tile" && kpi.Trend.Count > 1)
            {
                var sparkW = (float)Math.Floor(InnerWidth(Math.Clamp(w.Size, 1, 4)));
                var sparkH = hero ? 26f : 16f;
                col.Item().Height(sparkH).Svg(DashboardChartSvg.Sparkline(kpi.Trend, Current, sparkW, sparkH)).FitArea();
            }
            if (!hasCompare) return;
            col.Item().Text(t =>
            {
                t.DefaultTextStyle(s => s.FontSize(7.5f));
                if (kpi.ChangePercent is { } p)
                {
                    var up = p > 0;
                    var good = p == 0 ? (bool?)null : up != DownIsGood.Contains(w.Key);
                    var unit = kpi.ChangeUnit == ChangeMath.PointsUnit ? " " + input.Label("Dash_Points") : "%";
                    var span = t.Span($"{(up ? "+" : "")}{p.ToString("#,0.#", c)}{unit}").SemiBold();
                    span.FontColor(good is null ? Muted : good.Value ? Good : Bad);
                    t.Span(" ");
                }
                if (kpi.Previous is { } prev)
                {
                    t.Span(string.Format(c, input.Label("Dash_VsPrevious"), Format(prev), previousName)).FontColor(Muted);
                }
            });
        });
    }

    private static void Legend(ColumnDescriptor col, IEnumerable<(string Name, string Color)> items)
    {
        col.Item().Row(row =>
        {
            row.Spacing(8);
            foreach (var (name, color) in items)
            {
                row.AutoItem().Row(r =>
                {
                    r.ConstantItem(6).AlignMiddle().Height(6).Background(color);
                    r.AutoItem().PaddingLeft(3).Text(name).FontSize(7).FontColor(Muted);
                });
            }
        });
    }

    private static void PlotWithAxes(IContainer container, DashboardPdfInput input, IReadOnlyList<ChartSeries> series, string kind,
        IReadOnlyList<string> labels, int size, float height, IReadOnlyList<string>? barColors = null)
    {
        var c = input.Culture;
        var ticks = DashboardChartSvg.TicksFor(series);
        var plotWidth = InnerWidth(size) - AxisWidth;
        var svg = DashboardChartSvg.Plot(series, kind, ticks, plotWidth, height, barColors);
        var tMin = ticks[0];
        var span = ticks[^1] - tMin == 0 ? 1 : ticks[^1] - tMin;
        var n = Math.Max(1, labels.Count);
        var slotWidth = plotWidth / n;
        var every = Math.Max(1, (int)Math.Ceiling(34 / slotWidth));

        container.Column(col =>
        {
            col.Item().Row(row =>
            {
                row.ConstantItem(AxisWidth).Height(height).Layers(layers =>
                {
                    layers.PrimaryLayer().Height(height);
                    foreach (var t in ticks)
                    {
                        var y = height - (float)((t - tMin) / span) * height;
                        layers.Layer().TranslateY(y - 4f).PaddingRight(3).AlignRight().Text(Compact(t, c)).FontSize(6.5f).FontColor(Muted);
                    }
                });
                row.RelativeItem().Height(height).Svg(svg).FitArea();
            });
            col.Item().PaddingLeft(AxisWidth).Row(row =>
            {
                for (var i = 0; i < n; i += every)
                {
                    var cover = Math.Min(every, n - i);
                    row.RelativeItem(cover).Text(i < labels.Count ? labels[i] : string.Empty).FontSize(6.5f).FontColor(Muted).ClampLines(1);
                }
            });
        });
    }

    private static void TimeSeriesBody(IContainer container, DashboardPdfInput input, DashboardWidgetConfig w, List<ChartSeries> series,
        IReadOnlyList<string> labels, int size)
    {
        if (series.All(s => s.Values.All(v => v == 0)))
        {
            container.PaddingVertical(14).AlignCenter().Text(input.Label("Dash_NoData")).FontColor(Muted);
            return;
        }

        var kind = w.Visual is "column" or "area" ? w.Visual : "line";
        container.Column(col =>
        {
            col.Spacing(4);
            Legend(col, series.Select(s => (s.Name, s.Color)));
            col.Item().Element(c => PlotWithAxes(c, input, series, kind, labels, size, size >= 3 ? 120 : 100));
        });
    }

    private static void AgingBody(IContainer container, DashboardPdfInput input, DashboardWidgetConfig w, List<DashboardAgingBucket> buckets, int size)
    {
        var c = input.Culture;
        var names = AgingKeys.Select(k => input.Label("Dash_Aging_" + k)).ToList();
        var amounts = AgingKeys.Select(k => buckets.FirstOrDefault(b => b.Key == k)?.Amount ?? 0m).ToList();
        var counts = AgingKeys.Select(k => buckets.FirstOrDefault(b => b.Key == k)?.Count ?? 0).ToList();
        if (amounts.All(a => a == 0))
        {
            container.PaddingVertical(14).AlignCenter().Text(input.Label("Dash_NothingOpen")).FontColor(Muted);
            return;
        }

        container.Column(col =>
        {
            col.Spacing(4);
            if (w.Visual == "stacked")
            {
                StackedBar(col, names.Select((n, i) => (n, amounts[i], Ordinal[i])).ToList(), c);
            }
            else if (w.Visual != "table")
            {
                col.Item().Element(p => PlotWithAxes(p, input, [new ChartSeries(w.Key, Current, amounts)], "column", names, size, 96, Ordinal));
            }
            col.Item().Table(table =>
            {
                table.ColumnsDefinition(cd =>
                {
                    cd.RelativeColumn(3);
                    cd.RelativeColumn(2);
                    cd.RelativeColumn(1);
                });
                void Head(string text, bool right) => (right ? table.Cell().BorderBottom(0.5f).BorderColor(Rule).AlignRight() : table.Cell().BorderBottom(0.5f).BorderColor(Rule))
                    .PaddingVertical(2).Text(text).FontSize(7).SemiBold().FontColor(Muted);
                Head(string.Empty, false);
                Head(string.Empty, true);
                Head(input.Label("Dash_Documents"), true);
                for (var i = 0; i < names.Count; i++)
                {
                    table.Cell().PaddingVertical(1.5f).Text(names[i]).FontSize(7.5f);
                    table.Cell().PaddingVertical(1.5f).AlignRight().Text(Money(amounts[i], c)).FontSize(7.5f);
                    table.Cell().PaddingVertical(1.5f).AlignRight().Text(Count(counts[i], c)).FontSize(7.5f);
                }
            });
        });
    }

    private static void StackedBar(ColumnDescriptor col, List<(string Name, decimal Value, string Color)> segments, CultureInfo c)
    {
        var positive = segments.Where(s => s.Value > 0).ToList();
        if (positive.Count > 0)
        {
            col.Item().Height(12).Row(row =>
            {
                foreach (var s in positive)
                {
                    row.RelativeItem((float)s.Value).Background(s.Color);
                }
            });
        }
        foreach (var s in segments)
        {
            col.Item().Row(r =>
            {
                r.ConstantItem(6).AlignMiddle().Height(6).Background(s.Color);
                r.RelativeItem().PaddingLeft(4).Text(s.Name).FontSize(7.5f).ClampLines(1);
                r.AutoItem().Text(Money(s.Value, c)).FontSize(7.5f);
            });
        }
    }

    private static void RankBody(IContainer container, DashboardPdfInput input, DashboardWidgetConfig w, IReadOnlyList<DashboardRankItem> items,
        bool hasCompare, string currentName, string previousName)
    {
        var c = input.Culture;
        var isCount = w.Key == "headcountByDepartment";
        string Format(decimal v) => isCount ? Count(v, c) : Money(v, c);
        string Name(DashboardRankItem i) => i.Name switch
        {
            DashboardService.OtherName => input.Label("Dash_Other"),
            DashboardService.NoneName => input.Label("Dash_NoDepartment"),
            _ => i.Name,
        };

        if (items.Count == 0)
        {
            container.PaddingVertical(14).AlignCenter().Text(input.Label("Dash_NoData")).FontColor(Muted);
            return;
        }

        container.Column(col =>
        {
            col.Spacing(3);
            if (w.Visual == "stacked")
            {
                StackedBar(col, items.Select((it, i) => (Name(it), it.Current, it.Id is null ? Other : Categorical[i % Categorical.Length])).ToList(), c);
                return;
            }

            if (w.Visual == "table")
            {
                col.Item().Table(table =>
                {
                    table.ColumnsDefinition(cd =>
                    {
                        cd.RelativeColumn(3);
                        cd.RelativeColumn(2);
                        if (hasCompare) cd.RelativeColumn(2);
                    });
                    void Head(string text, bool right) => (right ? table.Cell().BorderBottom(0.5f).BorderColor(Rule).AlignRight() : table.Cell().BorderBottom(0.5f).BorderColor(Rule))
                        .PaddingVertical(2).Text(text).FontSize(7).SemiBold().FontColor(Muted);
                    Head(string.Empty, false);
                    Head(currentName, true);
                    if (hasCompare) Head(previousName, true);
                    foreach (var it in items)
                    {
                        table.Cell().PaddingVertical(1.5f).Text(Name(it)).FontSize(7.5f);
                        table.Cell().PaddingVertical(1.5f).AlignRight().Text(Format(it.Current)).FontSize(7.5f);
                        if (hasCompare) table.Cell().PaddingVertical(1.5f).AlignRight().Text(Format(it.Previous ?? 0)).FontSize(7.5f);
                    }
                });
                return;
            }

            if (hasCompare) Legend(col, [(currentName, Current), (previousName, Previous)]);
            var max = items.Max(i => Math.Max(i.Current, hasCompare ? i.Previous ?? 0 : 0));
            if (max <= 0) max = 1;
            foreach (var it in items)
            {
                col.Item().Row(row =>
                {
                    row.RelativeItem(5).PaddingRight(4).AlignMiddle().Text(Name(it)).FontSize(7.5f).ClampLines(1);
                    row.RelativeItem(5).AlignMiddle().Column(bars =>
                    {
                        bars.Spacing(1.5f);
                        Bar(bars, it.Current, max, Current);
                        if (hasCompare) Bar(bars, it.Previous ?? 0, max, Previous);
                    });
                    row.ConstantItem(hasCompare ? 62 : 56).AlignRight().Column(vals =>
                    {
                        vals.Item().AlignRight().Text(Format(it.Current)).FontSize(7.5f);
                        if (hasCompare) vals.Item().AlignRight().Text(Format(it.Previous ?? 0)).FontSize(7).FontColor(Muted);
                    });
                });
            }
        });
    }

    private static void Bar(ColumnDescriptor bars, decimal value, decimal max, string color)
    {
        var fraction = value <= 0 ? 0.0f : Math.Min(1f, (float)(value / max));
        bars.Item().Height(5).Row(r =>
        {
            if (fraction > 0) r.RelativeItem(fraction).Background(color);
            if (fraction < 1) r.RelativeItem(1 - fraction);
        });
    }
}
