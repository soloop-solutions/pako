namespace Pako.Domain.Fiscal;

public interface IFiscalProvider
{
    Task<FiscalReceiptResult> IssueReceiptAsync(FiscalReceipt receipt, CancellationToken cancellationToken = default);

    Task<FiscalVoidResult> VoidReceiptAsync(CancellationToken cancellationToken = default);

    Task<FiscalReportResult> XReportAsync(CancellationToken cancellationToken = default);

    Task<FiscalReportResult> ZReportAsync(CancellationToken cancellationToken = default);

    Task<FiscalProviderStatus> GetStatusAsync(CancellationToken cancellationToken = default);
}
