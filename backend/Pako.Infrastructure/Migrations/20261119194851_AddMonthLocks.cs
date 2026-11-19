using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMonthLocks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EncryptedPrivateKeyPem",
                table: "pos_registers",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "month_lock_events",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Reason = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_month_lock_events", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "month_locks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    IsLocked = table.Column<bool>(type: "boolean", nullable: false),
                    LockedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    LockedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UnlockedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UnlockedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UnlockReason = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_month_locks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_month_lock_events_CompanyId_Year",
                table: "month_lock_events",
                columns: new[] { "CompanyId", "Year" });

            migrationBuilder.CreateIndex(
                name: "IX_month_locks_CompanyId_Year_Month",
                table: "month_locks",
                columns: new[] { "CompanyId", "Year", "Month" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "month_lock_events");

            migrationBuilder.DropTable(
                name: "month_locks");

            migrationBuilder.DropColumn(
                name: "EncryptedPrivateKeyPem",
                table: "pos_registers");
        }
    }
}
