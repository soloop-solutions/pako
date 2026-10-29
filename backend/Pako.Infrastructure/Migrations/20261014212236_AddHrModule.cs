using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddHrModule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "BaseSalary",
                table: "payslip_lines",
                type: "numeric(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "BonusAmount",
                table: "payslip_lines",
                type: "numeric(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "CostCenterId",
                table: "payslip_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DeductionsAmount",
                table: "payslip_lines",
                type: "numeric(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "DepartmentId",
                table: "payslip_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsPrimaryEmployer",
                table: "payslip_lines",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<decimal>(
                name: "OtherAdditionsAmount",
                table: "payslip_lines",
                type: "numeric(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "PaidDays",
                table: "payslip_lines",
                type: "numeric(6,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "WorkingDays",
                table: "payslip_lines",
                type: "numeric(6,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<DateTime>(
                name: "ApprovedAt",
                table: "payroll_runs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ApprovedByUserId",
                table: "payroll_runs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "payroll_runs",
                type: "character varying(1024)",
                maxLength: 1024,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PaidOn",
                table: "payroll_runs",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PaymentJournalEntryId",
                table: "payroll_runs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "employees",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankName",
                table: "employees",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "BirthDate",
                table: "employees",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DepartmentId",
                table: "employees",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "employees",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FirstName",
                table: "employees",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "HireDate",
                table: "employees",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Iban",
                table: "employees",
                type: "character varying(34)",
                maxLength: 34,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsPrimaryEmployer",
                table: "employees",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "JobTitle",
                table: "employees",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastName",
                table: "employees",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ManagerId",
                table: "employees",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PensionExempt",
                table: "employees",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "PersonalNumber",
                table: "employees",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "employees",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "TerminationDate",
                table: "employees",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "UserId",
                table: "employees",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BonusExpenseAccountId",
                table: "company_account_defaults",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EmployerPensionExpenseAccountId",
                table: "company_account_defaults",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EmployerPensionPayableAccountId",
                table: "company_account_defaults",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PayrollDeductionsAccountId",
                table: "company_account_defaults",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "departments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    ManagerEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    CostCenterId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SalesAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PurchasesAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PartnersAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    AccountingAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ReportsAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    HrAccess = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PartnerScope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_departments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "employee_contracts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    MonthlyGrossSalary = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    EmploymentType = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    WeeklyHours = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    JobTitle = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Notes = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_contracts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_employee_contracts_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "employee_partner_assignments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_partner_assignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_employee_partner_assignments_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_employee_partner_assignments_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "leave_types",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    DefaultAnnualDays = table.Column<decimal>(type: "numeric(6,2)", nullable: true),
                    PayPercent = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_leave_types", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "payroll_adjustments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Period = table.Column<DateOnly>(type: "date", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Description = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Hours = table.Column<decimal>(type: "numeric(8,2)", nullable: true),
                    RateMultiplier = table.Column<decimal>(type: "numeric(6,4)", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    PayrollRunId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payroll_adjustments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_payroll_adjustments_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "public_holidays",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_public_holidays", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "leave_allocations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaveTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Days = table.Column<decimal>(type: "numeric(6,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_leave_allocations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_leave_allocations_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_leave_allocations_leave_types_LeaveTypeId",
                        column: x => x.LeaveTypeId,
                        principalTable: "leave_types",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "leave_requests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaveTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Days = table.Column<decimal>(type: "numeric(6,2)", nullable: false),
                    Reason = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_leave_requests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_leave_requests_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_leave_requests_leave_types_LeaveTypeId",
                        column: x => x.LeaveTypeId,
                        principalTable: "leave_types",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_employees_CompanyId_PersonalNumber",
                table: "employees",
                columns: new[] { "CompanyId", "PersonalNumber" },
                unique: true,
                filter: "\"PersonalNumber\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_employees_CompanyId_UserId",
                table: "employees",
                columns: new[] { "CompanyId", "UserId" },
                unique: true,
                filter: "\"UserId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_employees_DepartmentId",
                table: "employees",
                column: "DepartmentId");

            migrationBuilder.CreateIndex(
                name: "IX_departments_CompanyId_Code",
                table: "departments",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employee_contracts_EmployeeId_StartDate",
                table: "employee_contracts",
                columns: new[] { "EmployeeId", "StartDate" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_partner_assignments_CompanyId_PartnerId",
                table: "employee_partner_assignments",
                columns: new[] { "CompanyId", "PartnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_partner_assignments_EmployeeId_PartnerId",
                table: "employee_partner_assignments",
                columns: new[] { "EmployeeId", "PartnerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employee_partner_assignments_PartnerId",
                table: "employee_partner_assignments",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_leave_allocations_EmployeeId_LeaveTypeId_Year",
                table: "leave_allocations",
                columns: new[] { "EmployeeId", "LeaveTypeId", "Year" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_leave_allocations_LeaveTypeId",
                table: "leave_allocations",
                column: "LeaveTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_leave_requests_CompanyId_State",
                table: "leave_requests",
                columns: new[] { "CompanyId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_leave_requests_EmployeeId_StartDate",
                table: "leave_requests",
                columns: new[] { "EmployeeId", "StartDate" });

            migrationBuilder.CreateIndex(
                name: "IX_leave_requests_LeaveTypeId",
                table: "leave_requests",
                column: "LeaveTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_leave_types_CompanyId_Code",
                table: "leave_types",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_payroll_adjustments_CompanyId_Period",
                table: "payroll_adjustments",
                columns: new[] { "CompanyId", "Period" });

            migrationBuilder.CreateIndex(
                name: "IX_payroll_adjustments_EmployeeId",
                table: "payroll_adjustments",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_payroll_adjustments_PayrollRunId",
                table: "payroll_adjustments",
                column: "PayrollRunId");

            migrationBuilder.CreateIndex(
                name: "IX_public_holidays_CompanyId_Date",
                table: "public_holidays",
                columns: new[] { "CompanyId", "Date" },
                unique: true);

            // ClientStaff joins the company-scoped roles.
            migrationBuilder.Sql(
                """
                ALTER TABLE memberships DROP CONSTRAINT IF EXISTS ck_memberships_scope;
                ALTER TABLE memberships ADD CONSTRAINT ck_memberships_scope CHECK (
                    ("FirmId" IS NOT NULL AND "CompanyId" IS NULL AND "Role" IN ('FirmAdmin', 'FirmAccountant'))
                    OR
                    ("CompanyId" IS NOT NULL AND "FirmId" IS NULL AND "Role" IN ('ClientAdmin', 'ClientViewer', 'ClientStaff'))
                );
                """);

            // Slips computed before the HR module had no proration or additions: base = gross.
            migrationBuilder.Sql("UPDATE payslip_lines SET \"BaseSalary\" = \"GrossSalary\";");

            // Employees keep their single Name; split names start empty.
            // Payroll-profile companies get the finer account roles from their seeded v2 chart.
            migrationBuilder.Sql(
                """
                UPDATE company_account_defaults d SET
                    "BonusExpenseAccountId" = (SELECT a."Id" FROM accounts a WHERE a."CompanyId" = d."CompanyId" AND a."Code" = '600300'),
                    "EmployerPensionExpenseAccountId" = (SELECT a."Id" FROM accounts a WHERE a."CompanyId" = d."CompanyId" AND a."Code" = '600200'),
                    "EmployerPensionPayableAccountId" = (SELECT a."Id" FROM accounts a WHERE a."CompanyId" = d."CompanyId" AND a."Code" = '221200'),
                    "PayrollDeductionsAccountId" = (SELECT a."Id" FROM accounts a WHERE a."CompanyId" = d."CompanyId" AND a."Code" = '222100')
                WHERE d."SalaryExpenseAccountId" IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DELETE FROM memberships WHERE "Role" = 'ClientStaff';
                ALTER TABLE memberships DROP CONSTRAINT IF EXISTS ck_memberships_scope;
                ALTER TABLE memberships ADD CONSTRAINT ck_memberships_scope CHECK (
                    ("FirmId" IS NOT NULL AND "CompanyId" IS NULL AND "Role" IN ('FirmAdmin', 'FirmAccountant'))
                    OR
                    ("CompanyId" IS NOT NULL AND "FirmId" IS NULL AND "Role" IN ('ClientAdmin', 'ClientViewer'))
                );
                """);

            migrationBuilder.DropTable(
                name: "departments");

            migrationBuilder.DropTable(
                name: "employee_contracts");

            migrationBuilder.DropTable(
                name: "employee_partner_assignments");

            migrationBuilder.DropTable(
                name: "leave_allocations");

            migrationBuilder.DropTable(
                name: "leave_requests");

            migrationBuilder.DropTable(
                name: "payroll_adjustments");

            migrationBuilder.DropTable(
                name: "public_holidays");

            migrationBuilder.DropTable(
                name: "leave_types");

            migrationBuilder.DropIndex(
                name: "IX_employees_CompanyId_PersonalNumber",
                table: "employees");

            migrationBuilder.DropIndex(
                name: "IX_employees_CompanyId_UserId",
                table: "employees");

            migrationBuilder.DropIndex(
                name: "IX_employees_DepartmentId",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "BaseSalary",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "BonusAmount",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "CostCenterId",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "DeductionsAmount",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "DepartmentId",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "IsPrimaryEmployer",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "OtherAdditionsAmount",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "PaidDays",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "WorkingDays",
                table: "payslip_lines");

            migrationBuilder.DropColumn(
                name: "ApprovedAt",
                table: "payroll_runs");

            migrationBuilder.DropColumn(
                name: "ApprovedByUserId",
                table: "payroll_runs");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "payroll_runs");

            migrationBuilder.DropColumn(
                name: "PaidOn",
                table: "payroll_runs");

            migrationBuilder.DropColumn(
                name: "PaymentJournalEntryId",
                table: "payroll_runs");

            migrationBuilder.DropColumn(
                name: "Address",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "BankName",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "BirthDate",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "DepartmentId",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "FirstName",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "HireDate",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "Iban",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "IsPrimaryEmployer",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "JobTitle",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "LastName",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "ManagerId",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "PensionExempt",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "PersonalNumber",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "TerminationDate",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "BonusExpenseAccountId",
                table: "company_account_defaults");

            migrationBuilder.DropColumn(
                name: "EmployerPensionExpenseAccountId",
                table: "company_account_defaults");

            migrationBuilder.DropColumn(
                name: "EmployerPensionPayableAccountId",
                table: "company_account_defaults");

            migrationBuilder.DropColumn(
                name: "PayrollDeductionsAccountId",
                table: "company_account_defaults");
        }
    }
}
