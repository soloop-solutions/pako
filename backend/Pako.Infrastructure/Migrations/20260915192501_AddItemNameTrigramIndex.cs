using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddItemNameTrigramIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // B7 (35,000-row verify criterion): ItemsController.List's Name search uses
            // EF.Functions.ILike (translates to ILIKE '%term%'), which a plain btree index can't
            // serve — pg_trgm's GIN index can, for arbitrary substring matches, not just prefixes.
            // Schema-qualified: PostgresTestDatabase runs migrations with SearchPath scoped to a
            // single per-test schema (excludes public), so an unqualified gin_trgm_ops — installed
            // into public by CREATE EXTENSION — would not resolve there.
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;");
            migrationBuilder.Sql("CREATE INDEX ix_items_name_trgm ON items USING gin (\"Name\" public.gin_trgm_ops);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_items_name_trgm;");
        }
    }
}
