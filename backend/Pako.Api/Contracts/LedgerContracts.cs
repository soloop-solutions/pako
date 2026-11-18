namespace Pako.Api.Contracts;

// Balance (period debit minus credit) is a trailing optional member added for the account-balances
// footer; always set by the API.
public record TrialBalanceTotals(decimal Opening, decimal Debit, decimal Credit, decimal Closing, decimal? Balance = null);

public record TrialBalanceLine(
    Guid AccountId,
    string AccountCode,
    string AccountName,
    decimal Debit,
    decimal Credit,
    decimal Balance,
    decimal Opening,
    decimal Closing,
    int? Class,
    string? GroupName);
