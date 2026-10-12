using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddWithholdingTaxEntries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "withholding_tax_entries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    PersonalNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    GrossInterest = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    PropertyRights = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    LotteryWinnings = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    GrossRent = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    NonResidentEntertainer = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    NonResidentServices = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    NonEntrepreneur = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    RentalAreaM2 = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    MonthlyGrossRent = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    Country = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_withholding_tax_entries", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_withholding_tax_entries_CompanyId_Year",
                table: "withholding_tax_entries",
                columns: new[] { "CompanyId", "Year" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "withholding_tax_entries");
        }
    }
}
