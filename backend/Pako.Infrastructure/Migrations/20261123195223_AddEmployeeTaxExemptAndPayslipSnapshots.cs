using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEmployeeTaxExemptAndPayslipSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "PensionExempt",
                table: "payslip_lines",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "TaxExempt",
                table: "payslip_lines",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "TaxExempt",
                table: "employees",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PensionExempt",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "TaxExempt",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "TaxExempt",
                table: "employees");
        }
    }
}
