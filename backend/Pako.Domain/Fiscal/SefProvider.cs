namespace Pako.Domain.Fiscal;

public sealed class SefProvider : IFiscalProvider
{
    private const string NotBuiltMessage =
        "SEF (Software Electronic Fiscal) integration is not implemented yet. ATK's SEF API/portal has been open since June 2026; this is Phase 2 scope for PAKO, not a blocked dependency.";

    public Task<FiscalReceiptResult> IssueReceiptAsync(FiscalReceipt receipt, CancellationToken cancellationToken = default)
        => throw new NotImplementedException(NotBuiltMessage);

    public Task<FiscalVoidResult> VoidReceiptAsync(CancellationToken cancellationToken = default)
        => throw new NotImplementedException(NotBuiltMessage);

    public Task<FiscalReportResult> XReportAsync(CancellationToken cancellationToken = default)
        => throw new NotImplementedException(NotBuiltMessage);

    public Task<FiscalReportResult> ZReportAsync(CancellationToken cancellationToken = default)
        => throw new NotImplementedException(NotBuiltMessage);

    public Task<FiscalProviderStatus> GetStatusAsync(CancellationToken cancellationToken = default)
        => Task.FromResult(new FiscalProviderStatus(
            BridgeOnline: false,
            PrinterReady: false,
            Version: null,
            ErrorMessage: NotBuiltMessage));
}
