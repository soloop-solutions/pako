namespace Pako.Api.Contracts;

public record RegisterRequest(string Email, string Password);
public record LoginRequest(string Email, string Password);
public record AuthResponse(string Token, Guid UserId, string Email, string? RefreshToken = null);
public record RefreshRequest(string RefreshToken);
public record LogoutRequest(string? RefreshToken = null);

public record VerifyPasswordRequest(string Password);
public record ActionTokenRequest(string Password, string Action, Guid CompanyId);
public record ActionTokenResponse(string Token, DateTime ExpiresAtUtc);
