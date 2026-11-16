namespace Pako.Api.Desktop;

public sealed class DesktopOptions
{
    public const string Section = "Desktop";

    public bool Enabled { get; set; }
    public string? LaunchSecret { get; set; }
    public string? DataDirectory { get; set; }
}
