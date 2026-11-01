using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pako.Fiscal.Xk;

// ATK's fiscalization service (AI 01/2026; endpoints from ATK's samples and Swagger at
// https://fiskalizimi-test.atk-ks.org/swagger). Onboarding: /ca/verify/{nui} then /ca/signcsr.
// Coupons: /pos/coupon (full detail, signed) and /citizen/coupon (the QR payload).
public enum AtkEnvironment
{
    Test,
    Production,
}

public sealed class AtkFiscalClient
{
    public static Uri BaseUrl(AtkEnvironment environment) => environment == AtkEnvironment.Production
        ? new Uri("https://fiskalizimi.atk-ks.org/")
        : new Uri("https://fiskalizimi-test.atk-ks.org/");

    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    private readonly HttpClient _http;

    // The HttpClient's BaseAddress must be one of BaseUrl(...).
    public AtkFiscalClient(HttpClient http)
    {
        if (http.BaseAddress is null) throw new ArgumentException("The HttpClient needs ATK's base address.", nameof(http));
        _http = http;
    }

    // Step 1 of onboarding a point of sale: ATK confirms the registration and returns the business
    // name and a verification code for the CSR.
    public Task<AtkVerifyResponse> VerifyAsync(ulong businessId, string fiscalizationNo, ulong posId, ulong branchId, ulong applicationId,
        CancellationToken cancellationToken = default) =>
        PostAsync<AtkVerifyResponse>($"ca/verify/{businessId}",
            new AtkVerifyRequest(fiscalizationNo, posId, branchId, applicationId), cancellationToken);

    // Step 2: ATK's CA signs the CSR and returns the point of sale's certificate (PEM).
    public Task<AtkSignCsrResponse> SignCsrAsync(AtkSignCsrRequest request, CancellationToken cancellationToken = default) =>
        PostAsync<AtkSignCsrResponse>("ca/signcsr", request, cancellationToken);

    // Sends a signed PosCoupon; ATK answers with its transaction number.
    public Task<AtkPosCouponResponse> SendPosCouponAsync(SignedPosCoupon coupon, CancellationToken cancellationToken = default) =>
        PostAsync<AtkPosCouponResponse>("pos/coupon", new { details = coupon.Details, signature = coupon.Signature }, cancellationToken);

    // Sends the citizen (QR) coupon.
    public Task<AtkMessageResponse> SendCitizenCouponAsync(string qrCode, ulong citizenId = 0, CancellationToken cancellationToken = default) =>
        PostAsync<AtkMessageResponse>("citizen/coupon", new { citizen_id = citizenId, qr_code = qrCode }, cancellationToken);

    private async Task<T> PostAsync<T>(string path, object body, CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            response = await _http.PostAsJsonAsync(path, body, Json, cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            // No connection: the caller keeps the coupon in its offline queue (Art. 32(3), 44).
            throw new AtkUnavailableException(ex.Message, ex);
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AtkUnavailableException("ATK did not answer in time.", ex);
        }

        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if ((int)response.StatusCode >= 500) throw new AtkUnavailableException($"ATK returned {(int)response.StatusCode}: {ErrorOf(text)}");
        if (!response.IsSuccessStatusCode) throw new AtkRejectedException((int)response.StatusCode, ErrorOf(text));
        return JsonSerializer.Deserialize<T>(text, Json) ?? throw new AtkRejectedException((int)response.StatusCode, "Empty response from ATK.");
    }

    private static string ErrorOf(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("error", out var error)) return error.ToString();
        }
        catch (JsonException)
        {
        }
        return string.IsNullOrWhiteSpace(body) ? "(no details)" : body;
    }
}

public record AtkVerifyRequest(string FiscalizationNo, ulong PosId, ulong BranchId, ulong ApplicationId);
public record AtkVerifyResponse(string BusinessName, string VerificationCode);
public record AtkSignCsrRequest(string BusinessName, ulong BusinessId, ulong BranchId, string VerificationCode, ulong PosId, ulong ApplicationId, string Csr);
public record AtkSignCsrResponse(string SignedCertificate);
public record AtkPosCouponResponse(string? Message, [property: JsonPropertyName("transaction_id")] ulong TransactionId);
public record AtkMessageResponse(string? Message);

// ATK can't be reached (network, timeout, 5xx): keep the coupon queued and retry.
public class AtkUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

// ATK refused the request (4xx): don't retry blindly; the coupon needs attention.
public class AtkRejectedException(int statusCode, string error) : Exception($"ATK rejected the request ({statusCode}): {error}")
{
    public int StatusCode { get; } = statusCode;
    public string Error { get; } = error;
}
