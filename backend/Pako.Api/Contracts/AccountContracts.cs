using Pako.Domain.Ledger;

namespace Pako.Api.Contracts;

public record AccountResponse(
    Guid Id,
    string Code,
    string Name,
    AccountType AccountType,
    AccountSubType AccountSubType,
    Guid? ParentAccountId,
    bool IsReconcilable);
