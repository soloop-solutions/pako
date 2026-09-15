namespace Pako.Domain.Ledger;

// B2: an account's group is derived by matching Code against [CodePrefixStart, CodePrefixEnd],
// never stored on the Account itself — mirrors Odoo's account.group, where group_id is computed.
// Two levels: a Class-level row (ParentGroupId null, e.g. "1" 100000-199999) and a Group-level row
// nested under it (e.g. "10" 100000-109999). Both prefixes are stored as full-width account-code
// strings so membership is a plain ordinal string comparison, not prefix-length arithmetic.
public class AccountGroup
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string CodePrefixStart { get; set; } = string.Empty;
    public string CodePrefixEnd { get; set; } = string.Empty;
    public Guid? ParentGroupId { get; set; }
}
