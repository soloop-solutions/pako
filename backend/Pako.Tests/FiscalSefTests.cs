using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Pako.Fiscal.Xk;
using Pako.Fiscal.Xk.Atk;

namespace Pako.Tests;

// docs/POS_PLAN.md §2.4 / §14 — the SEF protocol layer: coupon payloads, signing, CSR and the ATK
// client, checked offline (no call reaches ATK).
public class FiscalSefTests
{
    private static readonly FiscalIssuer Issuer = new(BusinessId: 810000001, BranchId: 1, PosId: 3, ApplicationId: 1234, Location: "Prishtinë");

    // ATK's sample basket: water (0 %), sandwiches (18 %), bread (8 %), macchiato (18 %).
    private static FiscalCouponRequest Sale(IReadOnlyList<FiscalCouponPayment>? payments = null) => new(
        Issuer, CouponId: 10, FiscalCouponType.Sale, new DateTimeOffset(2026, 10, 31, 15, 30, 20, TimeSpan.Zero),
        OperatorId: "Arta (7)", VerificationNo: "A1B2C3D4E5F6G7H8",
        Lines: new[]
        {
            new FiscalCouponLine("Ujë Rugove", "copë", 3m, 1.50m, 4.50m, TaxLetters.Zero),
            new FiscalCouponLine("Sendviç", "copë", 2m, 3.00m, 6.00m, TaxLetters.Standard),
            new FiscalCouponLine("Bukë", "copë", 4m, 0.80m, 3.20m, TaxLetters.Reduced),
            new FiscalCouponLine("Makiato e madhe", "copë", 3m, 1.50m, 4.50m, TaxLetters.Standard),
        },
        Payments: payments ?? new[] { new FiscalCouponPayment(FiscalPaymentType.Cash, 5m), new FiscalCouponPayment(FiscalPaymentType.CreditCard, 13.20m) });

    [Fact]
    public void Coupon_TotalsVatPerLetter_FromTheGross_AndBothPayloadsAgree()
    {
        var built = CouponBuilder.Build(Sale());

        // E: 10.50 gross → 8.90 net + 1.60; D: 3.20 → 2.96 + 0.24; C: 4.50 at 0 %.
        Assert.Equal(new[] { ("C", 4.50m, 0m), ("D", 2.96m, 0.24m), ("E", 8.90m, 1.60m) },
            built.TaxTotals.Select(t => (t.TaxLetter, t.Net, t.Tax)).ToArray());
        Assert.Equal((18.20m, 1.84m, 16.36m), (built.Total, built.TotalTax, built.TotalNoTax));

        var pos = built.Pos;
        Assert.Equal((1820L, 184L, 1636L), (pos.Total, pos.TotalTax, pos.TotalNoTax));
        Assert.Equal(CouponType.Sale, pos.Type);
        Assert.Equal((15000L, 45000L), (pos.Items[0].Price, pos.Items[0].Total));
        Assert.Equal(new[] { 500L, 1320L }, pos.Payments.Select(p => p.Amount).ToArray());
        Assert.Equal((810000001UL, 1UL, 3UL, 1234UL), (pos.BusinessId, pos.BranchId, pos.PosId, pos.ApplicationId));

        // The citizen coupon (QR) carries the same identity and totals, or ATK fails verification.
        var citizen = built.Citizen;
        Assert.Equal((pos.BusinessId, pos.CouponId, pos.BranchId, pos.PosId, pos.VerificationNo, pos.Time),
            (citizen.BusinessId, citizen.CouponId, citizen.BranchId, citizen.PosId, citizen.VerificationNo, citizen.Time));
        Assert.Equal((pos.Total, pos.TotalTax, pos.TotalNoTax), (citizen.Total, citizen.TotalTax, citizen.TotalNoTax));
        Assert.Equal(pos.TaxGroups, citizen.TaxGroups);
    }

    [Fact]
    public void Coupon_RefusesWhatAtkWouldReject()
    {
        Assert.Throws<FiscalCouponException>(() => CouponBuilder.Build(Sale(new[] { new FiscalCouponPayment(FiscalPaymentType.Cash, 18m) })));
        // A return without the original coupon is rejected by ATK.
        Assert.Throws<FiscalCouponException>(() => CouponBuilder.Build(Sale() with { Type = FiscalCouponType.Return }));
        Assert.Throws<FiscalCouponException>(() => CouponBuilder.Build(Sale() with { VerificationNo = "12345678901234567" }));
        Assert.Throws<FiscalCouponException>(() => CouponBuilder.Build(Sale() with { OperatorId = " " }));
        Assert.Throws<FiscalCouponException>(() => CouponBuilder.Build(Sale() with
        {
            Lines = new[] { new FiscalCouponLine("X", "copë", 1m, 1m, 1m, "B") },
            Payments = new[] { new FiscalCouponPayment(FiscalPaymentType.Cash, 1m) },
        }));

        var cancel = CouponBuilder.Build(Sale() with { Type = FiscalCouponType.Cancel, CouponId = 11, ReferenceNo = 10 });
        Assert.Equal((CouponType.Cancel, 10UL), (cancel.Pos.Type, cancel.Pos.ReferenceNo));
    }

    [Fact]
    public void TaxLetters_MapPakoRates()
    {
        Assert.Equal(new[] { "E", "D", "C", "A" },
            new[] { TaxLetters.For(0.18m, false), TaxLetters.For(0.08m, false), TaxLetters.For(0m, false), TaxLetters.For(0m, true) });
        Assert.Throws<FiscalCouponException>(() => TaxLetters.For(0.10m, false));
    }

    [Theory]
    [InlineData(SignatureEncoding.Der)]
    [InlineData(SignatureEncoding.IeeeP1363)]
    public void Signing_TheQrAndThePosCoupon_VerifiesWithThePublicKey_AndCatchesTampering(SignatureEncoding encoding)
    {
        using var key = FiscalPki.GenerateKey();
        using var signer = new CouponSigner(key, encoding);
        var built = CouponBuilder.Build(Sale());

        var qr = signer.QrCode(built.Citizen);
        var read = CouponVerifier.ReadQrCode(key, qr, encoding);
        Assert.NotNull(read);
        Assert.Equal(built.Citizen, read);

        var signed = signer.SignPosCoupon(built.Pos);
        Assert.True(CouponVerifier.Verify(key, signed.Details, signed.Signature, encoding));
        Assert.Equal(built.Pos, PosCoupon.Parser.ParseFrom(Convert.FromBase64String(signed.Details)));

        // One changed character in the payload breaks the signature.
        var tampered = (signed.Details[0] == 'A' ? 'B' : 'A') + signed.Details[1..];
        Assert.False(CouponVerifier.Verify(key, tampered, signed.Signature, encoding));
        Assert.Null(CouponVerifier.ReadQrCode(key, tampered + "|" + qr.Split('|')[1], encoding));

        // DER signatures are ASN.1 sequences (0x30 …); P1363 is a fixed 64-byte r‖s.
        var raw = Convert.FromBase64String(signed.Signature);
        if (encoding == SignatureEncoding.Der) Assert.Equal(0x30, raw[0]);
        else Assert.Equal(64, raw.Length);
    }

    [Fact]
    public void Signing_FromAPemKey_MatchesAtksPkcs8Format()
    {
        using var key = FiscalPki.GenerateKey();
        using var signer = CouponSigner.FromPem(key.ExportPkcs8PrivateKeyPem());
        var signature = signer.Sign("abc");
        Assert.True(CouponVerifier.Verify(key, "abc", signature));
    }

    [Fact]
    public void Csr_CarriesTheSubjectAtksCaExpects()
    {
        using var key = FiscalPki.GenerateKey();
        var pem = FiscalPki.CreateCsr(key, businessId: 810000001, branchId: 1, posId: 3, businessName: "Pako Demo, Sh.p.k.");
        Assert.StartsWith("-----BEGIN CERTIFICATE REQUEST-----", pem);
        var request = CertificateRequest.LoadSigningRequestPem(pem, HashAlgorithmName.SHA256);
        var subject = request.SubjectName.Format(multiLine: false);
        Assert.Contains("C=RKS", subject);
        Assert.Contains("O=810000001", subject);
        Assert.Contains("OU=3", subject);
        Assert.Contains("L=1", subject);
        Assert.Contains("Pako Demo, Sh.p.k.", subject);
    }

    // ---- ATK client against a fake service ----

    private sealed class FakeAtk(Func<HttpRequestMessage, string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(string Path, string Body)> Calls { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            Calls.Add((request.RequestUri!.AbsolutePath, body));
            return respond(request, body);
        }
    }

    private static HttpResponseMessage JsonResponse(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static (AtkFiscalClient, FakeAtk) Client(Func<HttpRequestMessage, string, HttpResponseMessage> respond)
    {
        var fake = new FakeAtk(respond);
        return (new AtkFiscalClient(new HttpClient(fake) { BaseAddress = AtkFiscalClient.BaseUrl(AtkEnvironment.Test) }), fake);
    }

    [Fact]
    public async Task AtkClient_OnboardsAndSends_InAtksJsonShape()
    {
        var (client, fake) = Client((request, _) => request.RequestUri!.AbsolutePath switch
        {
            "/ca/verify/810000001" => JsonResponse(HttpStatusCode.OK, """{"business_name":"PAKO DEMO","verification_code":"VC-1"}"""),
            "/ca/signcsr" => JsonResponse(HttpStatusCode.OK, """{"signed_certificate":"-----BEGIN CERTIFICATE-----x"}"""),
            "/pos/coupon" => JsonResponse(HttpStatusCode.OK, """{"message":"ok","transaction_id":987654321}"""),
            _ => JsonResponse(HttpStatusCode.OK, """{"message":"ok"}"""),
        });

        var verify = await client.VerifyAsync(810000001, "FN-77", posId: 3, branchId: 1, applicationId: 1234);
        Assert.Equal(("PAKO DEMO", "VC-1"), (verify.BusinessName, verify.VerificationCode));
        using (var body = JsonDocument.Parse(fake.Calls[0].Body))
        {
            Assert.Equal("FN-77", body.RootElement.GetProperty("fiscalization_no").GetString());
            Assert.Equal(3UL, body.RootElement.GetProperty("pos_id").GetUInt64());
            Assert.Equal(1234UL, body.RootElement.GetProperty("application_id").GetUInt64());
        }

        var cert = await client.SignCsrAsync(new AtkSignCsrRequest("PAKO DEMO", 810000001, 1, "VC-1", 3, 1234, "CSR"));
        Assert.StartsWith("-----BEGIN CERTIFICATE-----", cert.SignedCertificate);
        using (var body = JsonDocument.Parse(fake.Calls[1].Body))
        {
            Assert.Equal("VC-1", body.RootElement.GetProperty("verification_code").GetString());
            Assert.Equal("CSR", body.RootElement.GetProperty("csr").GetString());
        }

        var sent = await client.SendPosCouponAsync(new SignedPosCoupon("DETAILS", "SIG"));
        Assert.Equal(987654321UL, sent.TransactionId);
        using (var body = JsonDocument.Parse(fake.Calls[2].Body))
        {
            Assert.Equal(("DETAILS", "SIG"), (body.RootElement.GetProperty("details").GetString(), body.RootElement.GetProperty("signature").GetString()));
        }

        await client.SendCitizenCouponAsync("QR|SIG");
        Assert.Equal("/citizen/coupon", fake.Calls[3].Path);
    }

    [Fact]
    public async Task AtkClient_SeparatesRejectionFromUnavailability()
    {
        var (rejecting, _) = Client((_, _) => JsonResponse(HttpStatusCode.BadRequest, """{"error":"details and signature don't match"}"""));
        var rejected = await Assert.ThrowsAsync<AtkRejectedException>(() => rejecting.SendPosCouponAsync(new SignedPosCoupon("D", "S")));
        Assert.Equal((400, "details and signature don't match"), (rejected.StatusCode, rejected.Error));

        // Server errors and lost connections keep the coupon in the offline queue.
        var (failing, _) = Client((_, _) => JsonResponse(HttpStatusCode.InternalServerError, """{"error":"down"}"""));
        await Assert.ThrowsAsync<AtkUnavailableException>(() => failing.SendPosCouponAsync(new SignedPosCoupon("D", "S")));
        var (offline, _) = Client((_, _) => throw new HttpRequestException("no route to host"));
        await Assert.ThrowsAsync<AtkUnavailableException>(() => offline.SendCitizenCouponAsync("QR|SIG"));
    }
}
