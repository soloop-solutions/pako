namespace Pako.Api.Contracts;

// One dated value. Defaults come from code (Id null, read-only); overrides are the firm's rows.
public record StatutoryParameterResponse(
    Guid? Id,
    string Key,
    DateOnly EffectiveFrom,
    decimal Value,
    bool IsOverride,
    bool NeedsVerification,
    string? Source);

public record CreateStatutoryParameterRequest(string Key, DateOnly EffectiveFrom, decimal Value, string? Source);
