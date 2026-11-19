using System.Text;
using System.Xml;

namespace Pako.Api.Services;

public static class UploadImageValidator
{
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    public static bool IsValid(string contentType, ReadOnlySpan<byte> bytes) => contentType switch
    {
        "image/png" => IsPng(bytes),
        "image/jpeg" => IsJpeg(bytes),
        "image/webp" => IsWebP(bytes),
        "image/svg+xml" => IsSafeSvg(bytes),
        _ => false,
    };

    private static bool IsPng(ReadOnlySpan<byte> b) =>
        b.Length >= 8 + 25 + 12
        && b[..8].SequenceEqual(PngSignature)
        && b.Slice(12, 4).SequenceEqual("IHDR"u8)
        && b.Slice(b.Length - 8, 4).SequenceEqual("IEND"u8);

    private static bool IsJpeg(ReadOnlySpan<byte> b)
    {
        if (b.Length < 4 || b[0] != 0xFF || b[1] != 0xD8 || b[2] != 0xFF) return false;
        var tail = b[Math.Max(2, b.Length - 1024)..];
        return tail.IndexOf([(byte)0xFF, (byte)0xD9]) >= 0;
    }

    private static bool IsWebP(ReadOnlySpan<byte> b)
    {
        if (b.Length < 20 || !b[..4].SequenceEqual("RIFF"u8) || !b.Slice(8, 4).SequenceEqual("WEBP"u8)) return false;
        var chunk = b.Slice(12, 4);
        if (!chunk.SequenceEqual("VP8 "u8) && !chunk.SequenceEqual("VP8L"u8) && !chunk.SequenceEqual("VP8X"u8)) return false;
        var riffSize = (long)BitConverter.ToUInt32(b.Slice(4, 4));
        return riffSize + 8 <= b.Length;
    }

    private static bool IsSafeSvg(ReadOnlySpan<byte> bytes)
    {
        string text;
        try
        {
            text = new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            return false;
        }
        if (text.Contains("<script", StringComparison.OrdinalIgnoreCase)) return false;

        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersFromEntities = 0,
            IgnoreProcessingInstructions = false,
        };
        try
        {
            using var reader = XmlReader.Create(new StringReader(text), settings);
            var sawRoot = false;
            while (reader.Read())
            {
                if (reader.NodeType == XmlNodeType.ProcessingInstruction) return false;
                if (reader.NodeType != XmlNodeType.Element) continue;
                if (!sawRoot)
                {
                    if (reader.LocalName != "svg") return false;
                    sawRoot = true;
                }
                if (reader.LocalName.Equals("script", StringComparison.OrdinalIgnoreCase)) return false;
                if (reader.LocalName.Equals("foreignObject", StringComparison.OrdinalIgnoreCase)) return false;
                if (!reader.HasAttributes) continue;
                while (reader.MoveToNextAttribute())
                {
                    if (reader.LocalName.StartsWith("on", StringComparison.OrdinalIgnoreCase)) return false;
                    if (IsScriptUrl(reader.Value)) return false;
                }
                reader.MoveToElement();
            }
            return sawRoot;
        }
        catch (XmlException)
        {
            return false;
        }
    }

    private static bool IsScriptUrl(string value)
    {
        var compact = new string(value.Where(c => !char.IsWhiteSpace(c) && !char.IsControl(c)).ToArray());
        return compact.Contains("javascript:", StringComparison.OrdinalIgnoreCase);
    }
}
