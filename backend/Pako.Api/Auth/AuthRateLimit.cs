using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Pako.Api.Auth;

// The anonymous account endpoints (sign in, register, invitations, password reset, account requests)
// are limited per client address, so they can't be used to guess passwords, flood mailboxes with
// reset emails, or fill the request queue.
public static class AuthRateLimit
{
    public const string Policy = "auth";

    public static IServiceCollection AddAuthRateLimit(this IServiceCollection services, int permitsPerMinute) =>
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(Policy, http => RateLimitPartition.GetFixedWindowLimiter(
                http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = permitsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
}
