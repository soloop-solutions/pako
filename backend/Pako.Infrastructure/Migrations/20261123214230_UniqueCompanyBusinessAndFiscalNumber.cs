using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class UniqueCompanyBusinessAndFiscalNumber : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_companies_BusinessNumber",
                table: "companies",
                column: "BusinessNumber",
                unique: true,
                filter: "\"BusinessNumber\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_companies_FiscalNumber",
                table: "companies",
                column: "FiscalNumber",
                unique: true,
                filter: "\"FiscalNumber\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_companies_BusinessNumber",
                table: "companies");

            migrationBuilder.DropIndex(
                name: "IX_companies_FiscalNumber",
                table: "companies");
        }
    }
}
