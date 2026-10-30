using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPlatformAdministration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "companies",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "now()");

            migrationBuilder.AddColumn<Guid>(
                name: "CreatedByUserId",
                table: "companies",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "EnabledModules",
                table: "companies",
                type: "integer",
                nullable: false,
                defaultValue: 63); // every module: existing companies keep what they have

            migrationBuilder.AddColumn<int>(
                name: "CompanyLimit",
                table: "AspNetUsers",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "AspNetUsers",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "now()");

            migrationBuilder.AddColumn<bool>(
                name: "IsDisabled",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsPlatformAdmin",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "account_requests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FullName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Phone = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    FirmName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    BusinessNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    City = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    RequestedCompanies = table.Column<int>(type: "integer", nullable: false),
                    Message = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecisionNote = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_requests", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_account_requests_Email",
                table: "account_requests",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_account_requests_Status_CreatedAt",
                table: "account_requests",
                columns: new[] { "Status", "CreatedAt" });
        
            // Who created each existing company: its earliest company administrator, or for a
            // firm's company the firm's earliest administrator. Counted against company limits.
            migrationBuilder.Sql("""
                UPDATE companies c SET "CreatedByUserId" = m."UserId"
                FROM (
                    SELECT DISTINCT ON (x."CompanyId") x."CompanyId", x."UserId"
                    FROM memberships x WHERE x."CompanyId" IS NOT NULL AND x."Role" = 'ClientAdmin'
                    ORDER BY x."CompanyId", x."CreatedAt"
                ) m
                WHERE m."CompanyId" = c."Id" AND c."CreatedByUserId" IS NULL;

                UPDATE companies c SET "CreatedByUserId" = m."UserId"
                FROM (
                    SELECT DISTINCT ON (x."FirmId") x."FirmId", x."UserId"
                    FROM memberships x WHERE x."FirmId" IS NOT NULL AND x."Role" = 'FirmAdmin'
                    ORDER BY x."FirmId", x."CreatedAt"
                ) m
                WHERE m."FirmId" = c."FirmId" AND c."CreatedByUserId" IS NULL;

                -- Existing accounts that created companies keep no limit; everyone else (invited
                -- staff, viewers) may create none until a platform administrator allows it.
                UPDATE "AspNetUsers" u SET "CompanyLimit" = 0
                WHERE NOT u."IsPlatformAdmin"
                  AND NOT EXISTS (SELECT 1 FROM companies c WHERE c."CreatedByUserId" = u."Id");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "account_requests");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "CreatedByUserId",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "EnabledModules",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "CompanyLimit",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "IsDisabled",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "IsPlatformAdmin",
                table: "AspNetUsers");
        }
    }
}
