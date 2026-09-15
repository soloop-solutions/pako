using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCompanyLockDatesAndExceptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "HardLockDate",
                table: "companies",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PurchaseLockDate",
                table: "companies",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "SaleLockDate",
                table: "companies",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "account_lock_exceptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LockDateField = table.Column<int>(type: "integer", nullable: false),
                    LockDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Reason = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    EndsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    GrantedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedByUserId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_lock_exceptions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_account_lock_exceptions_CompanyId_UserId_LockDateField",
                table: "account_lock_exceptions",
                columns: new[] { "CompanyId", "UserId", "LockDateField" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "account_lock_exceptions");

            migrationBuilder.DropColumn(
                name: "HardLockDate",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "PurchaseLockDate",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "SaleLockDate",
                table: "companies");
        }
    }
}
