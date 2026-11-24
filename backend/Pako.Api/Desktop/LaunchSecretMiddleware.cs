using System.Security.Cryptography;
using System.Text;

namespace Pako.Api.Desktop;

public sealed class LaunchSecretMiddleware(RequestDelegate next, DesktopOptions options)
{
    public const string CookieName = "pako_launch";

    private readonly byte[] _secret = Encoding.UTF8.GetBytes(options.LaunchSecret ?? string.Empty);

    public Task InvokeAsync(HttpContext context)
    {
        if (options.IsTillRequest(context))
        {
            // Tills on the shop network never get the launch cookie: TillNetworkMiddleware lets
            // till devices through after authentication. Uploaded files (attachments, documents)
            // stay on the PC.
            if (!context.Request.Path.StartsWithSegments(Pako.Api.Services.UploadStorage.RequestPath))
                return next(context);
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        }

        if (!IsGuarded(context.Request.Path) || HasValidCookie(context))
            return next(context);

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    }

    private static bool IsGuarded(PathString path) =>
        path.StartsWithSegments("/api") || path.StartsWithSegments("/hubs")
        || path.StartsWithSegments(Pako.Api.Services.UploadStorage.RequestPath);

    private bool HasValidCookie(HttpContext context)
    {
        if (_secret.Length == 0) return false;
        if (!context.Request.Cookies.TryGetValue(CookieName, out var value) || string.IsNullOrEmpty(value)) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(value), _secret);
    }
}
