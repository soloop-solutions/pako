using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Pako.Api.Services;

// The InMemory provider used by Pako.Tests doesn't support relational transactions/row locks
// (and doesn't need them — tests aren't exercising real concurrency), so every caller that needs
// a row lock or an explicit transaction for a concurrency fix checks this first and no-ops
// otherwise, rather than each controller re-deriving the same provider check.
public static class DatabaseFacadeExtensions
{
    public static bool SupportsRowLocking(this DatabaseFacade database) =>
        database.ProviderName == "Npgsql.EntityFrameworkCore.PostgreSQL";
}
