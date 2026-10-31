using Pako.Api.Authorization;
using Pako.Domain.Reporting;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public class VatDeclarationService(PakoDbContext db, CompanyAccessContext access)
{
    public const int CarryLookbackMonths = 12;

    public async Task<VatDeclarationResult> ComputeAsync(
        Guid companyId, int year, int month, decimal? carriedCreditOverride, decimal refundRequested)
    {
        var target = new DateOnly(year, month, 1);
        var windowStart = carriedCreditOverride is null ? target.AddMonths(-CarryLookbackMonths) : target;
        var windowEnd = target.AddMonths(1).AddDays(-1);

        var tax = new TaxReportService(db, access);
        var sales = (await tax.BuildTaxBookRowsAsync(companyId, windowStart, windowEnd, isSalesBook: true))
            .Select(ToAtkRow).ToList();
        var purchases = (await tax.BuildTaxBookRowsAsync(companyId, windowStart, windowEnd, isSalesBook: false))
            .Select(ToAtkRow).ToList();

        List<VatBoxAmount> AmountsFor(DateOnly month) =>
            AtkBookMapper.DeclarationAmounts(
                sales.Where(r => IsInMonth(r, month)), purchases.Where(r => IsInMonth(r, month)));

        var carried = carriedCreditOverride ?? 0m;
        if (carriedCreditOverride is null)
        {
            for (var back = CarryLookbackMonths; back >= 1; back--)
            {
                var earlier = target.AddMonths(-back);
                carried = VatDeclaration.Calculate(AmountsFor(earlier), carried, 0m).CreditForNextPeriod;
            }
        }

        return VatDeclaration.Calculate(AmountsFor(target), carried, refundRequested);
    }

    private static bool IsInMonth(AtkTaxRow row, DateOnly month) =>
        row.IssueDate.Year == month.Year && row.IssueDate.Month == month.Month;

    private static AtkTaxRow ToAtkRow(TaxReportService.TaxBookRow r) =>
        new(r.DocumentId, r.DocumentNumber, r.IssueDate, r.PartnerId, r.VatCode, r.Rate, r.NetAmount,
            r.Direction, r.DeductiblePercent, r.IsReverseCharge, r.AtkBook, r.DocumentType, r.VatAmount);
}
