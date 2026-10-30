using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUserRolesAndInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CompanyRoleId",
                table: "memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "memberships",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "now()");

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "memberships",
                type: "boolean",
                nullable: false,
                defaultValue: true); // every existing membership stays active

            migrationBuilder.AddColumn<string>(
                name: "FullName",
                table: "AspNetUsers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastLoginAt",
                table: "AspNetUsers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "company_roles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Description = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    BuiltInKey = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    SalesAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PurchasesAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PartnersAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ItemsAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    AccountingAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ReportsAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    HrAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PayrollAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    SettingsAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    UsersAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PartnerScope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_roles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_company_roles_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    FullName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CompanyRoleId = table.Column<Guid>(type: "uuid", nullable: true),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    InvitedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AcceptedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_invitations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_user_invitations_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_user_invitations_company_roles_CompanyRoleId",
                        column: x => x.CompanyRoleId,
                        principalTable: "company_roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_memberships_CompanyRoleId",
                table: "memberships",
                column: "CompanyRoleId");

            migrationBuilder.CreateIndex(
                name: "IX_company_roles_CompanyId_BuiltInKey",
                table: "company_roles",
                columns: new[] { "CompanyId", "BuiltInKey" },
                unique: true,
                filter: "\"BuiltInKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_company_roles_CompanyId_Name",
                table: "company_roles",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_invitations_CompanyId_Email",
                table: "user_invitations",
                columns: new[] { "CompanyId", "Email" });

            migrationBuilder.CreateIndex(
                name: "IX_user_invitations_CompanyRoleId",
                table: "user_invitations",
                column: "CompanyRoleId");

            migrationBuilder.CreateIndex(
                name: "IX_user_invitations_TokenHash",
                table: "user_invitations",
                column: "TokenHash",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_memberships_company_roles_CompanyRoleId",
                table: "memberships",
                column: "CompanyRoleId",
                principalTable: "company_roles",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // docs/USER_ACCESS_PLAN.md §4: every department a ClientStaff user's access came from
            // becomes a role with the same levels (Payroll inherits HR, which used to cover it), and
            // those users get that role — nobody's access changes with this migration.
            migrationBuilder.Sql("""
                INSERT INTO company_roles ("Id", "CompanyId", "Name", "Description", "BuiltInKey",
                    "SalesAccess", "PurchasesAccess", "PartnersAccess", "ItemsAccess", "AccountingAccess",
                    "ReportsAccess", "HrAccess", "PayrollAccess", "SettingsAccess", "UsersAccess", "PartnerScope", "CreatedAt")
                SELECT gen_random_uuid(), d."CompanyId", left('Department: ' || d."Name" || ' (' || d."Code" || ')', 80),
                    'Converted from the department''s permissions.', NULL,
                    d."SalesAccess", d."PurchasesAccess", d."PartnersAccess", 'Read', d."AccountingAccess",
                    d."ReportsAccess", d."HrAccess", d."HrAccess", 'None', 'None', d."PartnerScope", now()
                FROM departments d
                WHERE EXISTS (
                    SELECT 1 FROM employees e
                    JOIN memberships m ON m."UserId" = e."UserId" AND m."CompanyId" = e."CompanyId"
                    WHERE e."DepartmentId" = d."Id" AND m."Role" = 'ClientStaff');

                UPDATE memberships m SET "CompanyRoleId" = r."Id"
                FROM employees e
                JOIN departments d ON d."Id" = e."DepartmentId"
                JOIN company_roles r ON r."CompanyId" = d."CompanyId"
                    AND r."Name" = left('Department: ' || d."Name" || ' (' || d."Code" || ')', 80)
                WHERE m."Role" = 'ClientStaff' AND m."CompanyId" = e."CompanyId" AND m."UserId" = e."UserId";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_memberships_company_roles_CompanyRoleId",
                table: "memberships");

            migrationBuilder.DropTable(
                name: "user_invitations");

            migrationBuilder.DropTable(
                name: "company_roles");

            migrationBuilder.DropIndex(
                name: "IX_memberships_CompanyRoleId",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "CompanyRoleId",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "FullName",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "LastLoginAt",
                table: "AspNetUsers");
        }
    }
}
