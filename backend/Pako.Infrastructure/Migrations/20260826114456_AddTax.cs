using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTax : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "tax_definitions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Rate = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Scope = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tax_definitions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "tax_repartition_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaxDefinitionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Percentage = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Tag = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tax_repartition_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tax_repartition_lines_tax_definitions_TaxDefinitionId",
                        column: x => x.TaxDefinitionId,
                        principalTable: "tax_definitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_tax_definitions_CompanyId_Name",
                table: "tax_definitions",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tax_repartition_lines_AccountId",
                table: "tax_repartition_lines",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_tax_repartition_lines_TaxDefinitionId",
                table: "tax_repartition_lines",
                column: "TaxDefinitionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "tax_repartition_lines");

            migrationBuilder.DropTable(
                name: "tax_definitions");
        }
    }
}
