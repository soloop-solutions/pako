using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddExpenseClaims : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ReimbursementAmount",
                table: "payslip_lines",
                type: "numeric(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "ExpenseClaimId",
                table: "payroll_adjustments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EmployeeId",
                table: "partners",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "expense_claims",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecisionNote = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    BillId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_expense_claims", x => x.Id);
                    table.ForeignKey(
                        name: "FK_expense_claims_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "expense_claim_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpenseClaimId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Description = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ExpenseAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TaxDefinitionId = table.Column<Guid>(type: "uuid", nullable: true),
                    SupplierName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SupplierFiscalNumber = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_expense_claim_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_expense_claim_lines_expense_claims_ExpenseClaimId",
                        column: x => x.ExpenseClaimId,
                        principalTable: "expense_claims",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_payroll_adjustments_ExpenseClaimId",
                table: "payroll_adjustments",
                column: "ExpenseClaimId");

            migrationBuilder.CreateIndex(
                name: "IX_partners_CompanyId_EmployeeId",
                table: "partners",
                columns: new[] { "CompanyId", "EmployeeId" },
                unique: true,
                filter: "\"EmployeeId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_expense_claim_lines_ExpenseClaimId",
                table: "expense_claim_lines",
                column: "ExpenseClaimId");

            migrationBuilder.CreateIndex(
                name: "IX_expense_claims_BillId",
                table: "expense_claims",
                column: "BillId");

            migrationBuilder.CreateIndex(
                name: "IX_expense_claims_CompanyId_State",
                table: "expense_claims",
                columns: new[] { "CompanyId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_expense_claims_EmployeeId",
                table: "expense_claims",
                column: "EmployeeId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "expense_claim_lines");

            migrationBuilder.DropTable(
                name: "expense_claims");

            migrationBuilder.DropIndex(
                name: "IX_payroll_adjustments_ExpenseClaimId",
                table: "payroll_adjustments");

            migrationBuilder.DropIndex(
                name: "IX_partners_CompanyId_EmployeeId",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "ReimbursementAmount",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "ExpenseClaimId",
                table: "payroll_adjustments");

            migrationBuilder.DropColumn(
                name: "EmployeeId",
                table: "partners");
        }
    }
}
