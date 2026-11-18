using Pako.Api.Desktop;

namespace Pako.Api.Services;

public sealed class UploadStorage(string root)
{
    public const string RequestPath = "/uploads";

    private static readonly Dictionary<string, string> ImageExtensions = new(StringComparer.Ordinal)
    {
        ["image/png"] = ".png",
        ["image/jpeg"] = ".jpg",
        ["image/svg+xml"] = ".svg",
        ["image/webp"] = ".webp",
    };

    public string Root { get; } = root;

    public static UploadStorage From(DesktopOptions desktop) =>
        desktop.Enabled && !string.IsNullOrWhiteSpace(desktop.DataDirectory)
            ? new(Path.Combine(Path.GetFullPath(desktop.DataDirectory), "uploads"))
            : new(Path.Combine("wwwroot", "uploads"));

    public string CompanyDirectory(Guid companyId) => Path.Combine(Root, "companies", companyId.ToString());

    public static string? ImageExtension(string? contentType) =>
        contentType is not null && ImageExtensions.TryGetValue(contentType, out var ext) ? ext : null;
}
