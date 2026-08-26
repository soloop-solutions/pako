using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Pako.Domain.Fiscal;

public sealed class PefBridgeProvider : IFiscalProvider
{
    private static readonly Uri DefaultBridgeUri = new("http://127.0.0.1:7878");
    private static readonly TimeSpan ReceiptTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ReportTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan StatusTimeout = TimeSpan.FromSeconds(3);

    private readonly HttpClient _httpClient;

    public PefBridgeProvider(HttpClient httpClient)
    {
        _httpClient = httpClient;
        _httpClient.BaseAddress ??= DefaultBridgeUri;
    }

    public async Task<FiscalReceiptResult> IssueReceiptAsync(FiscalReceipt receipt, CancellationToken cancellationToken = default)
    {
        var wireReceipt = new BridgeReceiptRequest(
            receipt.OperatorId,
            receipt.Items.Select(i => new BridgeReceiptItem(i.Name, i.Quantity, i.UnitPrice, i.VatRate, i.Department)).ToList(),
            new BridgeReceiptPayments(receipt.Payments.Cash, receipt.Payments.Card));

        var envelope = await PostAsync<BridgeReceiptResult>("/receipt", wireReceipt, ReceiptTimeout, cancellationToken);
        return new FiscalReceiptResult(envelope.FiscalNumber, envelope.FiscalMemoryNumber, envelope.Total);
    }

    public async Task<FiscalVoidResult> VoidReceiptAsync(CancellationToken cancellationToken = default)
    {
        var envelope = await PostAsync<BridgeVoidResult>("/void-receipt", new { }, ReceiptTimeout, cancellationToken);
        return new FiscalVoidResult(envelope.Success, envelope.FiscalNumber);
    }

    public async Task<FiscalReportResult> XReportAsync(CancellationToken cancellationToken = default)
    {
        var envelope = await PostAsync<BridgeReportResult>("/x-report", new { }, ReportTimeout, cancellationToken);
        return new FiscalReportResult(envelope.ReportNumber, envelope.ReceiptCount, envelope.Totals);
    }

    public async Task<FiscalReportResult> ZReportAsync(CancellationToken cancellationToken = default)
    {
        var envelope = await PostAsync<BridgeReportResult>("/z-report", new { }, ReportTimeout, cancellationToken);
        return new FiscalReportResult(envelope.ReportNumber, envelope.ReceiptCount, envelope.Totals);
    }

    public async Task<FiscalProviderStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var timeoutCts = new CancellationTokenSource(StatusTimeout);
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            var status = await _httpClient.GetFromJsonAsync<BridgeStatusResult>("/status", linkedCts.Token);

            return new FiscalProviderStatus(
                BridgeOnline: status?.Bridge == "ok",
                PrinterReady: status?.Printer?.Ok == true,
                Version: status?.Version,
                ErrorMessage: null);
        }
        catch (Exception ex)
        {
            return new FiscalProviderStatus(BridgeOnline: false, PrinterReady: false, Version: null, ErrorMessage: ex.Message);
        }
    }

    private async Task<TData> PostAsync<TData>(string requestUri, object body, TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var timeoutCts = new CancellationTokenSource(timeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.PostAsJsonAsync(requestUri, body, linkedCts.Token);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new FiscalProviderException($"Could not reach the fiscal bridge at {_httpClient.BaseAddress}{requestUri}.", ex);
        }

        var envelope = await response.Content.ReadFromJsonAsync<BridgeEnvelope<TData>>(cancellationToken: cancellationToken)
            ?? throw new FiscalProviderException($"Fiscal bridge returned an empty response for {requestUri}.");

        if (!envelope.Success || envelope.Data is null)
        {
            throw new FiscalProviderException(envelope.Error ?? $"Fiscal bridge request to {requestUri} failed with status {(int)response.StatusCode}.");
        }

        return envelope.Data;
    }

    private sealed record BridgeEnvelope<TData>(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("data")] TData? Data,
        [property: JsonPropertyName("error")] string? Error);

    private sealed record BridgeReceiptRequest(
        [property: JsonPropertyName("operator")] string? OperatorId,
        [property: JsonPropertyName("items")] List<BridgeReceiptItem> Items,
        [property: JsonPropertyName("payments")] BridgeReceiptPayments Payments);

    private sealed record BridgeReceiptItem(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("quantity")] decimal Quantity,
        [property: JsonPropertyName("unitPrice")] decimal UnitPrice,
        [property: JsonPropertyName("vatRate")] decimal VatRate,
        [property: JsonPropertyName("department")] string? Department);

    private sealed record BridgeReceiptPayments(
        [property: JsonPropertyName("cash")] decimal Cash,
        [property: JsonPropertyName("card")] decimal Card);

    private sealed record BridgeReceiptResult(
        [property: JsonPropertyName("fiscalNumber")] string FiscalNumber,
        [property: JsonPropertyName("fiscalMemoryNumber")] string? FiscalMemoryNumber,
        [property: JsonPropertyName("total")] decimal Total);

    private sealed record BridgeVoidResult(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("fiscalNumber")] string? FiscalNumber);

    private sealed record BridgeReportResult(
        [property: JsonPropertyName("zReportNumber")] string? ReportNumber,
        [property: JsonPropertyName("receiptCount")] int? ReceiptCount,
        [property: JsonPropertyName("totals")] Dictionary<string, decimal> Totals);

    private sealed record BridgeStatusResult(
        [property: JsonPropertyName("bridge")] string? Bridge,
        [property: JsonPropertyName("version")] string? Version,
        [property: JsonPropertyName("printer")] BridgePrinterStatus? Printer);

    private sealed record BridgePrinterStatus([property: JsonPropertyName("ok")] bool Ok);
}
