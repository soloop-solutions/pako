using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountCashFlowCategory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CashFlowCategory",
                table: "accounts",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CashFlowCategory",
                table: "accounts");
        }
    }
}
