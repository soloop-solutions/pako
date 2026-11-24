namespace Pako.Api.Contracts;

public record ArbkBusinessResponse(
    string? RegistrationId,
    string? BusinessName,
    string? TradeName,
    string? Nui,
    string? FiscalNumber,
    string? Municipality,
    string? Address,
    string? BusinessType,
    string? Status,
    string? RegistrationDate,
    string? Phone,
    string? Email,
    string? Website,
    string? Capital,
    string? Employees);
