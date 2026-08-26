namespace Pako.Api.Contracts;

public record ReportLine(Guid AccountId, string AccountCode, string AccountName, decimal Amount);

public record ProfitAndLossResponse(
    DateOnly From,
    DateOnly To,
    List<ReportLine> Income,
    List<ReportLine> Expenses,
    decimal TotalIncome,
    decimal TotalExpenses,
    decimal NetIncome);

public record BalanceSheetResponse(
    DateOnly AsOf,
    List<ReportLine> Assets,
    List<ReportLine> Liabilities,
    List<ReportLine> Equity,
    decimal CurrentEarnings,
    decimal TotalAssets,
    decimal TotalLiabilities,
    decimal TotalEquity);

public record VatReturnLine(Guid TaxDefinitionId, string Name, decimal Rate, decimal Amount);

public record VatReturnResponse(
    DateOnly From,
    DateOnly To,
    List<VatReturnLine> OutputVat,
    List<VatReturnLine> InputVat,
    decimal TotalOutputVat,
    decimal TotalInputVat,
    decimal NetVatDue);
