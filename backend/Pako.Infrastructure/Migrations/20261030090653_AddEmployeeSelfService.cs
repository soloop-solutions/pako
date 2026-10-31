using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEmployeeSelfService : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CarryOverExpiryMonth",
                table: "leave_types",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CarryOverMaxDays",
                table: "leave_types",
                type: "numeric(6,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CarriedOverDays",
                table: "leave_allocations",
                type: "numeric(6,2)",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "CarriedOverExpiresOn",
                table: "leave_allocations",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasCustomDays",
                table: "leave_allocations",
                type: "boolean",
                nullable: false,
                // Every allocation that existed before carry-over was a custom entitlement.
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "employee_profile_changes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    NewIban = table.Column<string>(type: "character varying(34)", maxLength: 34, nullable: false),
                    NewBankName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    PreviousIban = table.Column<string>(type: "character varying(34)", maxLength: 34, nullable: true),
                    PreviousBankName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_profile_changes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_employee_profile_changes_employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_employee_profile_changes_CompanyId_State",
                table: "employee_profile_changes",
                columns: new[] { "CompanyId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_profile_changes_EmployeeId",
                table: "employee_profile_changes",
                column: "EmployeeId",
                unique: true,
                filter: "\"State\" = 'Pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "employee_profile_changes");

            migrationBuilder.DropColumn(
                name: "CarryOverExpiryMonth",
                table: "leave_types");

            migrationBuilder.DropColumn(
                name: "CarryOverMaxDays",
                table: "leave_types");

            migrationBuilder.DropColumn(
                name: "CarriedOverDays",
                table: "leave_allocations");

            migrationBuilder.DropColumn(
                name: "CarriedOverExpiresOn",
                table: "leave_allocations");

            migrationBuilder.DropColumn(
                name: "HasCustomDays",
                table: "leave_allocations");
        }
    }
}
