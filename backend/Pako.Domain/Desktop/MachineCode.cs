using System.Security.Cryptography;
using System.Text;

namespace Pako.Domain.Desktop;

public static class MachineCode
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static string Compute(string machineGuid)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(machineGuid));
        var chars = new char[16];
        var buffer = 0;
        var bits = 0;
        var index = 0;
        foreach (var b in hash)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5 && index < 16)
            {
                bits -= 5;
                chars[index++] = Alphabet[(buffer >> bits) & 31];
            }
            if (index == 16) break;
        }
        return string.Concat(
            new string(chars, 0, 4), "-",
            new string(chars, 4, 4), "-",
            new string(chars, 8, 4), "-",
            new string(chars, 12, 4));
    }
}
