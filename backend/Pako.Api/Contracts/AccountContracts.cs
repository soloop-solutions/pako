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
    DateOnly? ValidTo,
    // B2: computed by matching Code against the company's AccountGroup prefix ranges — never a
    // stored column, so this is never stale and never needs a backfill.
    Guid? GroupId,
    CashFlowCategory CashFlowCategory);

// B2: one row per AccountGroup — a Class-level row has ParentGroupId null, a Group-level row
// points to its Class-level row.
public record AccountGroupResponse(
    Guid Id,
    string Name,
    string CodePrefixStart,
    string CodePrefixEnd,
    Guid? ParentGroupId);

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
