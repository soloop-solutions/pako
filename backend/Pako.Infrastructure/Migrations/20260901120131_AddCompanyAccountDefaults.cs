using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCompanyAccountDefaults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "company_account_defaults",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReceivableAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    PayableAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    RevenueAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpenseAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerDepositsAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    SalaryExpenseAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    PitPayableAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    PensionPayableAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    NetPayPayableAccountId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_account_defaults", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_company_account_defaults_CompanyId",
                table: "company_account_defaults",
                column: "CompanyId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "company_account_defaults");
        }
    }
}
