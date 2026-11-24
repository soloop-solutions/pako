namespace Pako.Api.Desktop;

public sealed class DesktopOptions
{
    public const string Section = "Desktop";

    public bool Enabled { get; set; }
    public string? LaunchSecret { get; set; }
    public string? DataDirectory { get; set; }

    // "Allow tills on this network": the port the desktop app also opens on the shop network
    // (0 = off). Only till devices are let in through it (TillNetworkMiddleware).
    public int TillPort { get; set; }

    // A request that came in on the till port rather than the PC's own loopback port.
    public bool IsTillRequest(HttpContext context) =>
        Enabled && TillPort > 0 && context.Connection.LocalPort == TillPort;
}
