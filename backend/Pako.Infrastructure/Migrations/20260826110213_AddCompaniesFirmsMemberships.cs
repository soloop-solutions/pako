using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCompaniesFirmsMemberships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "FirmId",
                table: "companies",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "firms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_firms", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "memberships",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    FirmId = table.Column<Guid>(type: "uuid", nullable: true),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: true),
                    Role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_memberships", x => x.Id);
                    table.ForeignKey(
                        name: "FK_memberships_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_memberships_firms_FirmId",
                        column: x => x.FirmId,
                        principalTable: "firms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_companies_FirmId",
                table: "companies",
                column: "FirmId");

            migrationBuilder.CreateIndex(
                name: "IX_memberships_CompanyId",
                table: "memberships",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_memberships_FirmId",
                table: "memberships",
                column: "FirmId");

            migrationBuilder.CreateIndex(
                name: "IX_memberships_UserId_CompanyId",
                table: "memberships",
                columns: new[] { "UserId", "CompanyId" });

            migrationBuilder.CreateIndex(
                name: "IX_memberships_UserId_FirmId",
                table: "memberships",
                columns: new[] { "UserId", "FirmId" });

            migrationBuilder.AddForeignKey(
                name: "FK_companies_firms_FirmId",
                table: "companies",
                column: "FirmId",
                principalTable: "firms",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.Sql(
                """
                ALTER TABLE memberships ADD CONSTRAINT ck_memberships_scope CHECK (
                    ("FirmId" IS NOT NULL AND "CompanyId" IS NULL AND "Role" IN ('FirmAdmin', 'FirmAccountant'))
                    OR
                    ("CompanyId" IS NOT NULL AND "FirmId" IS NULL AND "Role" IN ('ClientAdmin', 'ClientViewer'))
                );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE memberships DROP CONSTRAINT IF EXISTS ck_memberships_scope;");

            migrationBuilder.DropForeignKey(
                name: "FK_companies_firms_FirmId",
                table: "companies");

            migrationBuilder.DropTable(
                name: "memberships");

            migrationBuilder.DropTable(
                name: "firms");

            migrationBuilder.DropIndex(
                name: "IX_companies_FirmId",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "FirmId",
                table: "companies");
        }
    }
}
