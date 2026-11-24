namespace Pako.Api.Contracts;

// Client request 2026-11-24: the totals under a document list, for every document the list's
// filters select (all pages). Credit notes and returns count negative. Outstanding is the open
// balance of the posted documents; null when the selection holds more posted documents than are
// checked one by one (ListTotalsLimits.OutstandingCheckLimit).
public record ListTotalsResponse(
    int Count, decimal AmountBeforeDiscount, decimal DiscountAmount, decimal NetAmount, decimal TaxAmount, decimal GrossAmount,
    decimal? Outstanding = null);

// The counts next to a list's saved views in the sidebar. Overdue is null when there are more
// posted documents past their due date than are checked one by one.
public record ViewCountsResponse(int All, int Draft, int Posted, int? Overdue = null);

public static class ListTotalsLimits
{
    public const int OutstandingCheckLimit = 500;
}
