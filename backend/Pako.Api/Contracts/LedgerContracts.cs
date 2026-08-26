namespace Pako.Api.Contracts;

public record TrialBalanceLine(
    Guid AccountId,
    string AccountCode,
    string AccountName,
    decimal Debit,
    decimal Credit,
    decimal Balance);
