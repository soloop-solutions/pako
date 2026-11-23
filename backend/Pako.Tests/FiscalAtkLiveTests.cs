using System.Security.Cryptography;
using Pako.Fiscal.Xk;
using Pako.Fiscal.Xk.Atk;

namespace Pako.Tests;

// Live integration tests against ATK's test endpoint (fiskalizimi-test.atk-ks.org).
// Gated by ATK_LIVE_TEST=true — skipped in CI and normal development. Run manually with:
//   ATK_LIVE_TEST=true ATK_BASE_URL=https://fiskalizimi-test.atk-ks.org \
//   ATK_APPLICATION_ID=895741008848 ATK_FISCALIZATION_NO=694539400125 ATK_NUI=812290427 \
//   dotnet test backend/Pako.Tests/Pako.Tests.csproj --filter "FullyQualifiedName~FiscalAtkLiveTests"
//
// These tests cover all three P0 certification items:
//   P0 #1: The 3 ATK verification tests (onboarding + fiskalizim + coupon structure)
//   P0 #2: DER signature encoding accepted by ATK
//   P0 #3: verification_code as string accepted by /ca/signcsr
public class FiscalAtkLiveTests
{
    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("ATK_LIVE_TEST"), "true", StringComparison.OrdinalIgnoreCase);

    private static ulong Nui => ulong.TryParse(
        Environment.GetEnvironmentVariable("ATK_NUI"), out var n) ? n : 812290427;

    private static string FiscalizationNo =>
        Environment.GetEnvironmentVariable("ATK_FISCALIZATION_NO") ?? "694539400125";

    private static ulong ApplicationId => ulong.TryParse(
        Environment.GetEnvironmentVariable("ATK_APPLICATION_ID"), out var id) ? id : 895741008848;

    private static ulong BranchId => ulong.TryParse(
        Environment.GetEnvironmentVariable("ATK_BRANCH_ID"), out var id) ? id : 1;

    private static ulong PosId => ulong.TryParse(
        Environment.GetEnvironmentVariable("ATK_POS_ID"), out var id) ? id : 1;

    private static AtkFiscalClient CreateClient()
    {
        var baseUrl = Environment.GetEnvironmentVariable("ATK_BASE_URL") ?? "https://fiskalizimi-test.atk-ks.org";
        if (!baseUrl.EndsWith('/')) baseUrl += "/";
        var http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(15) };
        return new AtkFiscalClient(http);
    }

    // P0 #1 (Onboarding test) + P0 #3 (verification_code type):
    // Calls /ca/verify/{nui} and confirms the response contains a string verification_code,
    // then calls /ca/signcsr with that string and confirms ATK signs the CSR.
    [Fact]
    public async Task P0_Onboarding_VerifyAndSignCsr()
    {
        if (!Enabled) return; // Set ATK_LIVE_TEST=true to run.

        var client = CreateClient();

        // Step 1: Verify — ATK returns business_name and verification_code (string).
        var verify = await client.VerifyAsync(Nui, FiscalizationNo, PosId, BranchId, ApplicationId);
        Assert.False(string.IsNullOrWhiteSpace(verify.BusinessName), "ATK should return a business name.");
        Assert.False(string.IsNullOrWhiteSpace(verify.VerificationCode),
            "ATK should return a verification_code as a non-empty string — P0 #3 confirmed.");

        // Step 2: Generate key and CSR.
        using var key = FiscalPki.GenerateKey();
        var csr = FiscalPki.CreateCsr(key, Nui, BranchId, PosId, verify.BusinessName);
        Assert.StartsWith("-----BEGIN CERTIFICATE REQUEST-----", csr);

        // Step 3: Sign CSR — passes verification_code as a STRING to /ca/signcsr.
        var signed = await client.SignCsrAsync(new AtkSignCsrRequest(
            verify.BusinessName, Nui, BranchId, verify.VerificationCode, PosId, ApplicationId, csr));
        Assert.False(string.IsNullOrWhiteSpace(signed.SignedCertificate),
            "ATK should return a signed certificate PEM.");
        Assert.Contains("-----BEGIN CERTIFICATE-----", signed.SignedCertificate);

        // Confirm the certificate is valid and readable.
        var (pubKey, _, notAfter, thumbprint) = FiscalPki.ReadCertificate(signed.SignedCertificate);
        pubKey.Dispose();
        Assert.True(notAfter > DateTime.UtcNow, "Certificate should not already be expired.");
        Assert.False(string.IsNullOrWhiteSpace(thumbprint));
    }

    // P0 #1 (Fiskalizim test) + P0 #2 (DER signature encoding):
    // Onboards a register, builds a real coupon, signs it with DER, and sends it to /pos/coupon.
    [Fact]
    public async Task P0_Fiskalizim_SignAndSendCoupon_DER()
    {
        if (!Enabled) return;

        await SignAndSendCoupon(SignatureEncoding.Der);
    }

    // Fallback test: same flow with IEEE P1363, in case ATK rejects DER.
    [Fact]
    public async Task P0_Fiskalizim_SignAndSendCoupon_P1363()
    {
        if (!Enabled) return;

        await SignAndSendCoupon(SignatureEncoding.IeeeP1363);
    }

    private static async Task SignAndSendCoupon(SignatureEncoding encoding)
    {
        var client = CreateClient();

        // Onboard first to get a certificate.
        var verify = await client.VerifyAsync(Nui, FiscalizationNo, PosId, BranchId, ApplicationId);
        using var key = FiscalPki.GenerateKey();
        var csr = FiscalPki.CreateCsr(key, Nui, BranchId, PosId, verify.BusinessName);
        var cert = await client.SignCsrAsync(new AtkSignCsrRequest(
            verify.BusinessName, Nui, BranchId, verify.VerificationCode, PosId, ApplicationId, csr));
        Assert.Contains("-----BEGIN CERTIFICATE-----", cert.SignedCertificate);

        // Build a test coupon (single item, cash payment).
        var request = new FiscalCouponRequest(
            new FiscalIssuer(Nui, BranchId, PosId, ApplicationId, "Prishtinë, Kosovë"),
            CouponId: (ulong)(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() % 1_000_000_000),
            FiscalCouponType.Sale,
            DateTimeOffset.UtcNow,
            OperatorId: "PakoTest",
            VerificationNo: Guid.NewGuid().ToString("N")[..16],
            Lines: new[]
            {
                new FiscalCouponLine("Ujë", "copë", 1m, 1.00m, 1.00m, TaxLetters.Standard),
            },
            Payments: new[]
            {
                new FiscalCouponPayment(FiscalPaymentType.Cash, 1.00m),
            });
        var built = CouponBuilder.Build(request);

        // Sign with the specified encoding and send.
        using var signer = new CouponSigner(key, encoding);
        var signed = signer.SignPosCoupon(built.Pos);

        var response = await client.SendPosCouponAsync(signed);
        Assert.True(response.TransactionId > 0,
            $"ATK should accept the coupon with {encoding} encoding and return a transaction ID — P0 #2 confirmed.");

        // Also send the citizen coupon.
        var qr = signer.QrCode(built.Citizen);
        await client.SendCitizenCouponAsync(qr);
    }
}
