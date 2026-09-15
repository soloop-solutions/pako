using Pako.Domain.Companies;
using Pako.Domain.Ledger;

namespace Pako.Api.Contracts;

// B1: every Plani Kontabel v2.0 field on Account (backend/Pako.Domain/Ledger/Account.cs), not
// just the original 7 — CompanyId is the one field left out, since it's already the route's own
// {companyId} segment.
public record AccountResponse(
    Guid Id,
    string Code,
    string Name,
    AccountType AccountType,
    AccountSubType AccountSubType,
    Guid? ParentAccountId,
    bool IsReconcilable,
    DateTime CreatedAt,
    string? NameSq,
    int? Class,
    int? Group,
    AccountStatement? Statement,
    NormalBalance? NormalBalance,
    SubledgerType? Subledger,
    bool IsControl,
    bool IsPostable,
    string? DefaultVatCode,
    CitDeductibility? CitDeductibility,
    string? CitLimitRule,
    CompanyProfile Profiles,
    bool IsActive,
    DateOnly? ValidFrom,
    DateOnly? ValidTo);

// R25: Code is accepted here but is refused if it differs from the account's current Code — it's
// on the request so a client can echo the account back unchanged, not because it's editable.
public record CreateAccountRequest(
    string Code,
    string Name,
    AccountType AccountType,
    AccountSubType AccountSubType,
    Guid? ParentAccountId,
    bool IsReconcilable,
    string? NameSq,
    int? Class,
    int? Group,
    AccountStatement? Statement,
    NormalBalance? NormalBalance,
    SubledgerType? Subledger,
    bool IsControl,
    bool IsPostable,
    string? DefaultVatCode,
    CitDeductibility? CitDeductibility,
    string? CitLimitRule,
    CompanyProfile Profiles,
    DateOnly? ValidFrom,
    DateOnly? ValidTo);

public record UpdateAccountRequest(
    string Code,
    string Name,
    AccountType AccountType,
    AccountSubType AccountSubType,
    Guid? ParentAccountId,
    bool IsReconcilable,
    string? NameSq,
    int? Class,
    int? Group,
    AccountStatement? Statement,
    NormalBalance? NormalBalance,
    SubledgerType? Subledger,
    bool IsControl,
    bool IsPostable,
    string? DefaultVatCode,
    CitDeductibility? CitDeductibility,
    string? CitLimitRule,
    CompanyProfile Profiles,
    DateOnly? ValidFrom,
    DateOnly? ValidTo);
