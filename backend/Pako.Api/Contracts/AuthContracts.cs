namespace Pako.Api.Contracts;

public record RegisterRequest(string Email, string Password);
public record LoginRequest(string Email, string Password);
public record AuthResponse(string Token, Guid UserId, string Email, string? RefreshToken = null);
public record RefreshRequest(string RefreshToken);
public record LogoutRequest(string? RefreshToken = null);

public record VerifyPasswordRequest(string Password);
// ForSession (2026-11-24, user decision): the password is asked once per session — the token stays
// valid for repeated use of the same action until it expires (ActionTokenService.SessionLifetime).
public record ActionTokenRequest(string Password, string Action, Guid CompanyId, bool? ForSession = null);
public record ActionTokenResponse(string Token, DateTime ExpiresAtUtc);
