using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace Pako.Domain.Desktop;

public sealed record LicensePayload(string MachineCode, string Customer, DateTimeOffset IssuedAt, DateTimeOffset? ExpiresAt);

public static class LicenseVerifier
{
    public const int MaxKeyLength = 4096;

    public static LicensePayload? Verify(string licenseKey, ReadOnlySpan<byte> publicKey)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(licenseKey) || publicKey.Length != 32 || licenseKey.Length > MaxKeyLength) return null;
            var parts = licenseKey.Trim().Split('.');
            if (parts.Length != 2) return null;
            var payload = Decode(parts[0]);
            var signature = Decode(parts[1]);
            if (payload is null || signature is null) return null;

            var verifier = new Ed25519Signer();
            verifier.Init(false, new Ed25519PublicKeyParameters(publicKey.ToArray(), 0));
            verifier.BlockUpdate(payload, 0, payload.Length);
            if (!verifier.VerifySignature(signature)) return null;

            var result = JsonSerializer.Deserialize<LicensePayload>(payload);
            if (result is null || string.IsNullOrEmpty(result.MachineCode)) return null;
            return result;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static byte[]? Decode(string value)
    {
        if (value.Length == 0) return null;
        var s = value.Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        try
        {
            return Convert.FromBase64String(s);
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
