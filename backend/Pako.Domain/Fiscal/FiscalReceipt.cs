namespace Pako.Domain.Fiscal;

public record FiscalReceipt(
    string? OperatorId,
    IReadOnlyList<FiscalReceiptItem> Items,
    FiscalPayments Payments);

public record FiscalReceiptItem(
    string Name,
    decimal Quantity,
    decimal UnitPrice,
    decimal VatRate,
    string? Department);

public record FiscalPayments(decimal Cash, decimal Card);

public record FiscalReceiptResult(
    string FiscalNumber,
    string? FiscalMemoryNumber,
    decimal Total);

public record FiscalVoidResult(bool Success, string? FiscalNumber);

public record FiscalReportResult(
    string? ReportNumber,
    int? ReceiptCount,
    IReadOnlyDictionary<string, decimal> Totals);

public record FiscalProviderStatus(
    bool BridgeOnline,
    bool PrinterReady,
    string? Version,
    string? ErrorMessage);
