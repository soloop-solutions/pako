using System.Text.RegularExpressions;
using Pako.Api.Desktop;

namespace Pako.Api.Services;

public sealed partial class UploadStorage(string root)
{
    public const string RequestPath = "/uploads";

    public string Root { get; } = root;

    public static UploadStorage From(DesktopOptions desktop) =>
        desktop.Enabled && !string.IsNullOrWhiteSpace(desktop.DataDirectory)
            ? new(Path.Combine(Path.GetFullPath(desktop.DataDirectory), "uploads"))
            : new(Path.Combine("wwwroot", "uploads"));

    public string CompanyDirectory(Guid companyId) => Path.Combine(Root, "companies", companyId.ToString());

    public static bool IsSafeExtension(string extension) => SafeExtension().IsMatch(extension);

    [GeneratedRegex("^\\.[A-Za-z0-9]{1,10}\\z")]
    private static partial Regex SafeExtension();
}
