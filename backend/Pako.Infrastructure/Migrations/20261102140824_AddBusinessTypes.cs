using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddBusinessTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BusinessType",
                table: "companies",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<long>(
                name: "EnabledFeatures",
                table: "companies",
                type: "bigint",
                nullable: false,
                // Existing companies keep every pack (CompanyFeature.All), as before business types.
                defaultValue: 8191L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BusinessType",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "EnabledFeatures",
                table: "companies");
        }
    }
}
