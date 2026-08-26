using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDebitNotesDiscountsDownPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "DiscountPercent",
                table: "invoice_lines",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "NextDebitNoteNumber",
                table: "companies",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "NextDownPaymentNumber",
                table: "companies",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountPercent",
                table: "bill_lines",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DiscountPercent",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "NextDebitNoteNumber",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "NextDownPaymentNumber",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "DiscountPercent",
                table: "bill_lines");
        }
    }
}
