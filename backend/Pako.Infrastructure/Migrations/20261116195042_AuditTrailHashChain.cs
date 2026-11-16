using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AuditTrailHashChain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EntryHash",
                table: "audit_entries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IpAddress",
                table: "audit_entries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrevHash",
                table: "audit_entries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RequestId",
                table: "audit_entries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "SequenceNumber",
                table: "audit_entries",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceDocumentId",
                table: "audit_entries",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_audit_entries_CompanyId_SequenceNumber",
                table: "audit_entries",
                columns: new[] { "CompanyId", "SequenceNumber" },
                unique: true,
                filter: "\"SequenceNumber\" IS NOT NULL");

            migrationBuilder.Sql(@"
                CREATE FUNCTION audit_entries_append_only() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'audit_entries is append-only: % is not allowed', TG_OP
                        USING ERRCODE = 'integrity_constraint_violation';
                END;
                $$ LANGUAGE plpgsql;");

            migrationBuilder.Sql(@"
                CREATE TRIGGER trg_audit_entries_append_only
                BEFORE UPDATE OR DELETE ON audit_entries
                FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS trg_audit_entries_append_only ON audit_entries;");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS audit_entries_append_only();");

            migrationBuilder.DropIndex(
                name: "IX_audit_entries_CompanyId_SequenceNumber",
                table: "audit_entries");

            migrationBuilder.DropColumn(
                name: "EntryHash",
                table: "audit_entries");

            migrationBuilder.DropColumn(
                name: "IpAddress",
                table: "audit_entries");

            migrationBuilder.DropColumn(
                name: "PrevHash",
                table: "audit_entries");

            migrationBuilder.DropColumn(
                name: "RequestId",
                table: "audit_entries");

            migrationBuilder.DropColumn(
                name: "SequenceNumber",
                table: "audit_entries");

            migrationBuilder.DropColumn(
                name: "SourceDocumentId",
                table: "audit_entries");
        }
    }
}
