using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PreferredLanguage",
                table: "employees",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "sq");

            migrationBuilder.AddColumn<bool>(
                name: "ReceivePayslipsByEmail",
                table: "employees",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ProbationEndDate",
                table: "employee_contracts",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "company_notification_settings",
                columns: table => new
                {
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Template = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_notification_settings", x => new { x.CompanyId, x.Template });
                    table.ForeignKey(
                        name: "FK_company_notification_settings_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "job_locks",
                columns: table => new
                {
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    LastRunOn = table.Column<DateOnly>(type: "date", nullable: true),
                    LastRunAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_job_locks", x => x.Name);
                });

            migrationBuilder.CreateTable(
                name: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: true),
                    RecipientEmail = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Template = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Culture = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PayloadJson = table.Column<string>(type: "jsonb", nullable: false),
                    AttachmentKind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    AttachmentRefId = table.Column<Guid>(type: "uuid", nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LockedUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_notifications_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_notifications_CompanyId_CreatedAt",
                table: "notifications",
                columns: new[] { "CompanyId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_notifications_State_NextAttemptAt",
                table: "notifications",
                columns: new[] { "State", "NextAttemptAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "company_notification_settings");

            migrationBuilder.DropTable(
                name: "job_locks");

            migrationBuilder.DropTable(
                name: "notifications");

            migrationBuilder.DropColumn(
                name: "PreferredLanguage",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "ReceivePayslipsByEmail",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "ProbationEndDate",
                table: "employee_contracts");
        }
    }
}
