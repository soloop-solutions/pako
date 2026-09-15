namespace Pako.Domain.Ledger;

// B2: computes an account's group at read time — never backfilled, never stored. When a code
// falls inside more than one group's range (always true here: a Group-level range sits fully
// inside its parent Class-level range), the narrowest range wins.
public static class AccountGroupResolver
{
    public static AccountGroup? Resolve(string accountCode, IReadOnlyCollection<AccountGroup> groups)
    {
        return groups
            .Where(g => string.CompareOrdinal(accountCode, g.CodePrefixStart) >= 0 &&
                        string.CompareOrdinal(accountCode, g.CodePrefixEnd) <= 0)
            .OrderBy(g => RangeWidth(g))
            .FirstOrDefault();
    }

    private static long RangeWidth(AccountGroup g)
    {
        // Prefixes are numeric account-code strings; a parse failure just sorts that group last
        // rather than throwing, since a malformed prefix shouldn't crash every account list.
        if (long.TryParse(g.CodePrefixEnd, out var end) && long.TryParse(g.CodePrefixStart, out var start))
        {
            return end - start;
        }

        return long.MaxValue;
    }
}
