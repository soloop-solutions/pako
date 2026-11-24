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

// The totals under a list that has one amount per row (stock document value, POS order total).
// Returns and cancellations count negative.
public record ListSumResponse(int Count, decimal Total);

// The totals under the journal entry list.
public record JournalListTotalsResponse(int Count, decimal Debit, decimal Credit);

public static class ListTotalsLimits
{
    public const int OutstandingCheckLimit = 500;
}
