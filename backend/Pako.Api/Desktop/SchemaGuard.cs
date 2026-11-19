using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Pako.Api.Desktop;

public static class SchemaGuard
{
    public const int NewerSchemaExitCode = 78;

    public static async Task<IReadOnlyList<string>> UnknownAppliedMigrationsAsync(DatabaseFacade database, CancellationToken ct = default)
    {
        var known = database.GetMigrations().ToHashSet(StringComparer.Ordinal);
        var applied = await database.GetAppliedMigrationsAsync(ct);
        return applied.Where(id => !known.Contains(id)).ToList();
    }

    public static string NewerSchemaMessage(IReadOnlyList<string> unknown) =>
        "PAKO_STARTUP_ERROR newer-schema: this data was created by a newer version of PAKO " +
        $"(migrations unknown to this version: {string.Join(", ", unknown)}). " +
        "Install the current version, or restore an older backup.";
}
