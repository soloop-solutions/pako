namespace Pako.Api.Contracts;

// Client feedback 2026-11: period discount rules (rabat) for a customer, item category and/or item.
public record SaveDiscountRuleRequest(
    string Name,
    decimal Percent,
    DateOnly ValidFrom,
    DateOnly ValidTo,
    Guid? PartnerId = null,
    Guid? ItemCategoryId = null,
    Guid? ItemId = null,
    int Priority = 0,
    bool IsActive = true);

public record DiscountRuleResponse(
    Guid Id,
    string Name,
    decimal Percent,
    DateOnly ValidFrom,
    DateOnly ValidTo,
    Guid? PartnerId,
    string? PartnerName,
    Guid? ItemCategoryId,
    string? ItemCategoryName,
    Guid? ItemId,
    string? ItemName,
    int Priority,
    bool IsActive);
