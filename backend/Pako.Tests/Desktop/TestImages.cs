using System.Text;

namespace Pako.Tests.Desktop;

internal static class TestImages
{
    public static readonly byte[] Png =
    [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89,
        0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
        0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    public static readonly byte[] Jpeg =
    [
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
        0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x03, 0x00, 0xFF, 0xD9,
    ];

    public static readonly byte[] WebP = BuildWebP();

    public const string CleanSvg =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 10 10\">" +
        "<defs><linearGradient id=\"g\"><stop offset=\"0\" stop-color=\"#123456\"/></linearGradient></defs>" +
        "<rect width=\"10\" height=\"10\" fill=\"url(#g)\"/><use xlink:href=\"#g\"/><text x=\"1\" y=\"8\">Çelik</text></svg>";

    private static byte[] BuildWebP()
    {
        var payload = new byte[] { 0x2F, 0x00, 0x00, 0x00, 0x00, 0x00 };
        var bytes = new List<byte>();
        bytes.AddRange(Encoding.ASCII.GetBytes("RIFF"));
        bytes.AddRange(BitConverter.GetBytes(4 + 8 + payload.Length));
        bytes.AddRange(Encoding.ASCII.GetBytes("WEBPVP8L"));
        bytes.AddRange(BitConverter.GetBytes(payload.Length));
        bytes.AddRange(payload);
        return bytes.ToArray();
    }

    public static byte[] ValidFor(string contentType) => contentType switch
    {
        "image/png" => Png,
        "image/jpeg" => Jpeg,
        "image/webp" => WebP,
        "image/svg+xml" => Encoding.UTF8.GetBytes(CleanSvg),
        _ => throw new ArgumentOutOfRangeException(nameof(contentType)),
    };

    private static byte[] Svg(string body) => Encoding.UTF8.GetBytes(body);

    public static (string ContentType, byte[] Bytes) Bad(string name) => name switch
    {
        "png-with-html" => ("image/png", Encoding.UTF8.GetBytes("<html><script>alert(document.cookie)</script></html>")),
        "png-truncated" => ("image/png", Png[..20]),
        "png-garbage" => ("image/png", [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]),
        "jpeg-truncated" => ("image/jpeg", Jpeg[..10]),
        "webp-truncated" => ("image/webp", WebP[..16]),
        "png-labelled-jpeg" => ("image/jpeg", Png),
        "jpeg-labelled-png" => ("image/png", Jpeg),
        "svg-labelled-png" => ("image/png", Encoding.UTF8.GetBytes(CleanSvg)),
        "svg-script" => ("image/svg+xml", Svg("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")),
        "svg-onload" => ("image/svg+xml", Svg("<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"><rect/></svg>")),
        "svg-doctype-entity" => ("image/svg+xml", Svg(
            "<?xml version=\"1.0\"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>" +
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>&xxe;</text></svg>")),
        "svg-foreign-object" => ("image/svg+xml", Svg(
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><foreignObject><div xmlns=\"http://www.w3.org/1999/xhtml\">x</div></foreignObject></svg>")),
        "svg-javascript-href" => ("image/svg+xml", Svg(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a xlink:href=\" JavaScript:alert(1)\"><rect/></a></svg>")),
        "svg-not-svg-root" => ("image/svg+xml", Svg("<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>x</body></html>")),
        "svg-not-xml" => ("image/svg+xml", Svg("<svg><rect></svg")),
        "svg-html-labelled-svg" => ("image/svg+xml", Svg("<!doctype html><html><script>alert(1)</script></html>")),
        _ => throw new ArgumentOutOfRangeException(nameof(name)),
    };
}
