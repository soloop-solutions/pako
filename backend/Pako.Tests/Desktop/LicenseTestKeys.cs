using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;
using Pako.Domain.Desktop;

namespace Pako.Tests.Desktop;

public sealed class LicenseTestKeys
{
    private readonly Ed25519PrivateKeyParameters _private;

    public byte[] PublicKey { get; }

    public LicenseTestKeys()
    {
        var generator = new Ed25519KeyPairGenerator();
        generator.Init(new Ed25519KeyGenerationParameters(new SecureRandom()));
        var pair = generator.GenerateKeyPair();
        _private = (Ed25519PrivateKeyParameters)pair.Private;
        PublicKey = ((Ed25519PublicKeyParameters)pair.Public).GetEncoded();
    }

    public string Issue(LicensePayload payload)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        return Sign(json);
    }

    public string Sign(byte[] payloadJson)
    {
        var signer = new Ed25519Signer();
        signer.Init(true, _private);
        signer.BlockUpdate(payloadJson, 0, payloadJson.Length);
        var signature = signer.GenerateSignature();
        return Encode(payloadJson) + "." + Encode(signature);
    }

    public static string Encode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Text(string s) => Encode(Encoding.UTF8.GetBytes(s));
}
