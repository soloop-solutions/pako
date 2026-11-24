using System.Security.Claims;
using Pako.Api.Services;

namespace Pako.Api.Desktop;

// Desktop "Allow tills on this network": requests on the till port reach the API only as a
// connected till device (POS setup → Devices). Nobody on the shop Wi-Fi can sign in to the full
// ERP, run first-run setup or reach the desktop endpoints; a device gets the till and the KDS,
// and its own rights (Pos Write, Items Read) do the rest. Runs after authentication.
public sealed class TillNetworkMiddleware(RequestDelegate next, DesktopOptions options)
{
    // Reachable without a device token: pairing with a one-use link, and keeping that session.
    private static readonly string[] Open = ["/api/auth/device-connect", "/api/auth/refresh", "/api/auth/logout"];

    public async Task InvokeAsync(HttpContext context, PosDeviceService devices)
    {
        var path = context.Request.Path;
        if (!options.IsTillRequest(context) || !(path.StartsWithSegments("/api") || path.StartsWithSegments("/hubs")))
        {
            await next(context);
            return;
        }

        if (!path.StartsWithSegments("/api/desktop"))
        {
            if (Open.Any(p => path.Equals(p, StringComparison.OrdinalIgnoreCase)))
            {
                await next(context);
                return;
            }
            if (Guid.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
                && await devices.DeviceOfAsync(userId) is not null)
            {
                await next(context);
                return;
            }
        }

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
    }
}
