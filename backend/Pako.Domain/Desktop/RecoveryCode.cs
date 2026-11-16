using System.Security.Cryptography;
using System.Text;

namespace Pako.Domain.Desktop;

public static class RecoveryCode
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private const int Length = 20;
    private const int SaltBytes = 16;

    public static string Generate()
    {
        var chars = new char[Length];
        for (var i = 0; i < Length; i++) chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        var sb = new StringBuilder(Length + 4);
        for (var i = 0; i < Length; i++)
        {
            if (i > 0 && i % 4 == 0) sb.Append('-');
            sb.Append(chars[i]);
        }
        return sb.ToString();
    }

    public static string Hash(string code)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(Digest(salt, code))}";
    }

    public static bool Verify(string code, string hash)
    {
        var parts = hash.Split(':');
        if (parts.Length != 2) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[0]);
            var expected = Convert.FromBase64String(parts[1]);
            return CryptographicOperations.FixedTimeEquals(Digest(salt, code), expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static byte[] Digest(byte[] salt, string code)
    {
        var normalized = new string(code.Where(c => c != '-' && !char.IsWhiteSpace(c)).ToArray()).ToUpperInvariant();
        return Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(normalized), salt, 100_000, HashAlgorithmName.SHA256, 32);
    }
}
