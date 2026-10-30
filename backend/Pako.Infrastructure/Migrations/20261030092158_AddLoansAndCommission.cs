using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddLoansAndCommission : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "LoanRepaymentAmount",
                table: "payslip_lines",
                type: "numeric(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "CommissionBasisAmount",
                table: "payroll_adjustments",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CommissionPlanId",
                table: "payroll_adjustments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EmployeeLoanId",
                table: "payroll_adjustments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CommissionPlanId",
                table: "employees",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "AssignedFrom",
                table: "employee_partner_assignments",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EmployeeAdvancesAccountId",
                table: "company_account_defaults",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "commission_plans",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Basis = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Rate = table.Column<decimal>(type: "numeric(9,6)", precision: 9, scale: 6, nullable: false),
                    MinThreshold = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_commission_plans", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "employee_loans",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Principal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    IssuedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    InstallmentAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    FirstPeriod = table.Column<DateOnly>(type: "date", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Notes = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    DisbursementJournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    CancellationJournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_loans", x => x.Id);
                    table.ForeignKey(
                        name: "FK_employee_loans_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "employee_partner_assignment_periods",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignedFrom = table.Column<DateOnly>(type: "date", nullable: true),
                    AssignedTo = table.Column<DateOnly>(type: "date", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_partner_assignment_periods", x => x.Id);
                    table.ForeignKey(
                        name: "FK_employee_partner_assignment_periods_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_payroll_adjustments_EmployeeLoanId",
                table: "payroll_adjustments",
                column: "EmployeeLoanId");

            migrationBuilder.CreateIndex(
                name: "IX_commission_plans_CompanyId_Name",
                table: "commission_plans",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employee_loans_CompanyId_State",
                table: "employee_loans",
                columns: new[] { "CompanyId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_loans_EmployeeId",
                table: "employee_loans",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_employee_partner_assignment_periods_CompanyId_PartnerId",
                table: "employee_partner_assignment_periods",
                columns: new[] { "CompanyId", "PartnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_partner_assignment_periods_EmployeeId",
                table: "employee_partner_assignment_periods",
                column: "EmployeeId");

            migrationBuilder.AddForeignKey(
                name: "FK_payroll_adjustments_employee_loans_EmployeeLoanId",
                table: "payroll_adjustments",
                column: "EmployeeLoanId",
                principalTable: "employee_loans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_payroll_adjustments_employee_loans_EmployeeLoanId",
                table: "payroll_adjustments");

            migrationBuilder.DropTable(
                name: "commission_plans");

            migrationBuilder.DropTable(
                name: "employee_loans");

            migrationBuilder.DropTable(
                name: "employee_partner_assignment_periods");

            migrationBuilder.DropIndex(
                name: "IX_payroll_adjustments_EmployeeLoanId",
                table: "payroll_adjustments");

            migrationBuilder.DropColumn(
                name: "LoanRepaymentAmount",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "CommissionBasisAmount",
                table: "payroll_adjustments");

            migrationBuilder.DropColumn(
                name: "CommissionPlanId",
                table: "payroll_adjustments");

            migrationBuilder.DropColumn(
                name: "EmployeeLoanId",
                table: "payroll_adjustments");

            migrationBuilder.DropColumn(
                name: "CommissionPlanId",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "AssignedFrom",
                table: "employee_partner_assignments");

            migrationBuilder.DropColumn(
                name: "EmployeeAdvancesAccountId",
                table: "company_account_defaults");
        }
    }
}
