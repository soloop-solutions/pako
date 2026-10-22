using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPartnerTaxNumberUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_partners_CompanyId_TaxNumber_Unique",
                table: "partners",
                columns: new[] { "CompanyId", "TaxNumber" },
                unique: true,
                filter: "\"TaxNumber\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_partners_CompanyId_TaxNumber_Unique",
                table: "partners");
        }
    }
}
