using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerPortal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Missing from main's ATK SEF commit (cb24644): Register.EncryptedPrivateKeyPem had no migration.
            migrationBuilder.AddColumn<string>(
                name: "EncryptedPrivateKeyPem",
                table: "pos_registers",
                type: "text",
                nullable: true);
            migrationBuilder.AddColumn<Guid>(
                name: "PartnerId",
                table: "user_invitations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "sales_orders",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Staff");

            migrationBuilder.AddColumn<Guid>(
                name: "PartnerId",
                table: "memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_invitations_PartnerId",
                table: "user_invitations",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_memberships_PartnerId",
                table: "memberships",
                column: "PartnerId");

            migrationBuilder.AddForeignKey(
                name: "FK_memberships_partners_PartnerId",
                table: "memberships",
                column: "PartnerId",
                principalTable: "partners",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_user_invitations_partners_PartnerId",
                table: "user_invitations",
                column: "PartnerId",
                principalTable: "partners",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            // Client feedback phase 5: ClientCustomer joins the company-scoped roles, and only it
            // (always) names a customer.
            migrationBuilder.Sql(
                """
                ALTER TABLE memberships DROP CONSTRAINT IF EXISTS ck_memberships_scope;
                ALTER TABLE memberships ADD CONSTRAINT ck_memberships_scope CHECK (
                    ("FirmId" IS NOT NULL AND "CompanyId" IS NULL AND "Role" IN ('FirmAdmin', 'FirmAccountant') AND "PartnerId" IS NULL)
                    OR
                    ("CompanyId" IS NOT NULL AND "FirmId" IS NULL AND "Role" IN ('ClientAdmin', 'ClientViewer', 'ClientStaff') AND "PartnerId" IS NULL)
                    OR
                    ("CompanyId" IS NOT NULL AND "FirmId" IS NULL AND "Role" = 'ClientCustomer' AND "PartnerId" IS NOT NULL)
                );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EncryptedPrivateKeyPem",
                table: "pos_registers");
            migrationBuilder.Sql(
                """
                DELETE FROM memberships WHERE "Role" = 'ClientCustomer';
                DELETE FROM user_invitations WHERE "Role" = 'ClientCustomer';
                ALTER TABLE memberships DROP CONSTRAINT IF EXISTS ck_memberships_scope;
                ALTER TABLE memberships ADD CONSTRAINT ck_memberships_scope CHECK (
                    ("FirmId" IS NOT NULL AND "CompanyId" IS NULL AND "Role" IN ('FirmAdmin', 'FirmAccountant'))
                    OR
                    ("CompanyId" IS NOT NULL AND "FirmId" IS NULL AND "Role" IN ('ClientAdmin', 'ClientViewer', 'ClientStaff'))
                );
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_memberships_partners_PartnerId",
                table: "memberships");

            migrationBuilder.DropForeignKey(
                name: "FK_user_invitations_partners_PartnerId",
                table: "user_invitations");

            migrationBuilder.DropIndex(
                name: "IX_user_invitations_PartnerId",
                table: "user_invitations");

            migrationBuilder.DropIndex(
                name: "IX_memberships_PartnerId",
                table: "memberships");

            migrationBuilder.DropColumn(
                name: "PartnerId",
                table: "user_invitations");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "sales_orders");

            migrationBuilder.DropColumn(
                name: "PartnerId",
                table: "memberships");
        }
    }
}
