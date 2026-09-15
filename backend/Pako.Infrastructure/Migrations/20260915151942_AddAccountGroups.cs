using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "account_groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    CodePrefixStart = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CodePrefixEnd = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ParentGroupId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_groups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_account_groups_account_groups_ParentGroupId",
                        column: x => x.ParentGroupId,
                        principalTable: "account_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_account_groups_CompanyId",
                table: "account_groups",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_account_groups_ParentGroupId",
                table: "account_groups",
                column: "ParentGroupId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "account_groups");
        }
    }
}
