using System.Security.Cryptography;
using System.Text;
using Google.Protobuf;
using Pako.Fiscal.Xk.Atk;

namespace Pako.Fiscal.Xk;

// ECDSA P-256 signatures as ATK's samples produce them: Protobuf bytes → Base64 → UTF-8 bytes of that
// string → SHA-256 → ECDSA → Base64.
//
// Signature encoding: ATK's Go sample signs ASN.1/DER (ecdsa.SignASN1); its C# sample uses .NET's
// default IEEE P1363 (r‖s). The service is most likely Go, so DER is the default here; the encoding
// is a setting until ATK confirms it [VERIFY, docs/POS_PLAN.md §16].
public enum SignatureEncoding
{
    Der,
    IeeeP1363,
}

public sealed class CouponSigner : IDisposable
{
    private readonly ECDsa _key;
    private readonly DSASignatureFormat _format;
    // A key passed in stays the caller's (a till signs many coupons with one key); a key loaded
    // from PEM belongs to the signer and is disposed with it.
    private readonly bool _ownsKey;

    public CouponSigner(ECDsa key, SignatureEncoding encoding = SignatureEncoding.Der) : this(key, encoding, ownsKey: false)
    {
    }

    private CouponSigner(ECDsa key, SignatureEncoding encoding, bool ownsKey)
    {
        if (key.KeySize != 256) throw new FiscalCouponException("The fiscal key must be ECDSA P-256.");
        _key = key;
        _ownsKey = ownsKey;
        _format = encoding == SignatureEncoding.Der ? DSASignatureFormat.Rfc3279DerSequence : DSASignatureFormat.IeeeP1363FixedFieldConcatenation;
    }

    public static CouponSigner FromPem(string privateKeyPem, SignatureEncoding encoding = SignatureEncoding.Der)
    {
        var key = ECDsa.Create();
        key.ImportFromPem(privateKeyPem);
        return new CouponSigner(key, encoding, ownsKey: true);
    }

    // Base64 signature of the given text's UTF-8 bytes.
    public string Sign(string text) => Convert.ToBase64String(_key.SignData(Encoding.UTF8.GetBytes(text), HashAlgorithmName.SHA256, _format));

    // The PosCoupon as ATK's /pos/coupon expects it: Base64 Protobuf details and their signature.
    public SignedPosCoupon SignPosCoupon(PosCoupon coupon)
    {
        var details = Convert.ToBase64String(coupon.ToByteArray());
        return new SignedPosCoupon(details, Sign(details));
    }

    // The string encoded into the coupon's QR code: Base64 CitizenCoupon | Base64 signature.
    public string QrCode(CitizenCoupon coupon)
    {
        var details = Convert.ToBase64String(coupon.ToByteArray());
        return $"{details}|{Sign(details)}";
    }

    public void Dispose()
    {
        if (_ownsKey) _key.Dispose();
    }
}

public record SignedPosCoupon(string Details, string Signature);

// Checks a signature with the certificate's public key — used by the cloud to confirm that a coupon
// synced from a till is exactly what the till signed.
public static class CouponVerifier
{
    public static bool Verify(ECDsa publicKey, string text, string base64Signature, SignatureEncoding encoding = SignatureEncoding.Der)
    {
        var format = encoding == SignatureEncoding.Der ? DSASignatureFormat.Rfc3279DerSequence : DSASignatureFormat.IeeeP1363FixedFieldConcatenation;
        try
        {
            return publicKey.VerifyData(Encoding.UTF8.GetBytes(text), Convert.FromBase64String(base64Signature), HashAlgorithmName.SHA256, format);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    // A QR string "details|signature" verified and decoded.
    public static CitizenCoupon? ReadQrCode(ECDsa publicKey, string qr, SignatureEncoding encoding = SignatureEncoding.Der)
    {
        var parts = qr.Split('|');
        if (parts.Length != 2 || !Verify(publicKey, parts[0], parts[1], encoding)) return null;
        return CitizenCoupon.Parser.ParseFrom(Convert.FromBase64String(parts[0]));
    }
}
