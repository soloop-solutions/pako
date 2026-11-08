namespace Pako.Api.Auth;

public class JwtOptions
{
    public required string Key { get; init; }
    public required string Issuer { get; init; }
    public required string Audience { get; init; }
    public int ExpiryMinutes { get; init; } = 15;
    public int RefreshTokenDays { get; init; } = 30;
    public int RefreshReuseGraceSeconds { get; init; } = 30;
}
