using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNegativeNumberStyleAndCreatedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CreatedByUserId",
                table: "invoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NegativeNumberStyle",
                table: "companies",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "CreatedByUserId",
                table: "bills",
                type: "uuid",
                nullable: true);

            foreach (var (table, entity) in new[] { ("invoices", "Invoice"), ("bills", "Bill") })
            {
                migrationBuilder.Sql(
                    $@"UPDATE {table} t SET ""CreatedByUserId"" = a.""UserId""::uuid
                       FROM audit_entries a
                       WHERE a.""EntityType"" = '{entity}' AND a.""Action"" = 'Created'
                         AND a.""EntityId"" = t.""Id""::text
                         AND a.""UserId"" ~* '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$'
                         AND t.""CreatedByUserId"" IS NULL;");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatedByUserId",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "NegativeNumberStyle",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "CreatedByUserId",
                table: "bills");
        }
    }
}
