using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Pako.Fiscal.Xk;

// AI 01/2026 Art. 34: one key pair and certificate per point of sale; the private key is generated on
// the machine and never leaves it. The CSR subject is what ATK's CA expects:
// C=RKS, O=<NUI>, OU=<POS id>, L=<branch id>, CN=<business name as ATK returned it>.
public static class FiscalPki
{
    public static ECDsa GenerateKey() => ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public static string CreateCsr(ECDsa key, ulong businessId, ulong branchId, ulong posId, string businessName, string country = "RKS")
    {
        if (string.IsNullOrWhiteSpace(businessName)) throw new FiscalCouponException("The business name from ATK's verification is required.");
        var name = new X500DistinguishedName(
            $"C={country}, O={businessId}, OU={posId}, L={branchId}, CN={Escape(businessName)}");
        var request = new CertificateRequest(name, key, HashAlgorithmName.SHA256);
        return request.CreateSigningRequestPem();
    }

    // The public key and validity of the certificate ATK signed, for the register's records.
    public static (ECDsa PublicKey, DateTime NotBefore, DateTime NotAfter, string Thumbprint) ReadCertificate(string certificatePem)
    {
        var certificate = X509Certificate2.CreateFromPem(certificatePem);
        var key = certificate.GetECDsaPublicKey() ?? throw new FiscalCouponException("The certificate doesn't carry an ECDSA key.");
        return (key, certificate.NotBefore.ToUniversalTime(), certificate.NotAfter.ToUniversalTime(), certificate.Thumbprint);
    }

    // Distinguished-name values with commas or quotes must be quoted.
    private static string Escape(string value) =>
        value.IndexOfAny(new[] { ',', '"', '+', '=', '<', '>', ';', '#' }) >= 0 ? $"\"{value.Replace("\"", "\\\"")}\"" : value;
}
