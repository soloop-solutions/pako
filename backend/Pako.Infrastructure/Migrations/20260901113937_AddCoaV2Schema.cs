using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCoaV2Schema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AtkBook",
                table: "tax_definitions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Code",
                table: "tax_definitions",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DeductiblePercent",
                table: "tax_definitions",
                type: "numeric(5,2)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Direction",
                table: "tax_definitions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsReverseCharge",
                table: "tax_definitions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "CostCenterId",
                table: "journal_entry_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ExchangeRate",
                table: "journal_entry_lines",
                type: "numeric(18,6)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "OriginalAmount",
                table: "journal_entry_lines",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OriginalCurrency",
                table: "journal_entry_lines",
                type: "character varying(3)",
                maxLength: 3,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "EnabledProfiles",
                table: "companies",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "FunctionalCurrency",
                table: "companies",
                type: "character varying(3)",
                maxLength: 3,
                nullable: false,
                defaultValue: "EUR");

            migrationBuilder.AddColumn<int>(
                name: "CitDeductibility",
                table: "accounts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CitLimitRule",
                table: "accounts",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Class",
                table: "accounts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DefaultVatCode",
                table: "accounts",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Group",
                table: "accounts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "accounts",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsControl",
                table: "accounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsPostable",
                table: "accounts",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "NameSq",
                table: "accounts",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NormalBalance",
                table: "accounts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Profiles",
                table: "accounts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Statement",
                table: "accounts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Subledger",
                table: "accounts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ValidFrom",
                table: "accounts",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ValidTo",
                table: "accounts",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "cost_centers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    NameEn = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Profile = table.Column<int>(type: "integer", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cost_centers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_tax_definitions_CompanyId_Code",
                table: "tax_definitions",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_journal_entry_lines_CostCenterId",
                table: "journal_entry_lines",
                column: "CostCenterId");

            migrationBuilder.CreateIndex(
                name: "IX_cost_centers_CompanyId_Code",
                table: "cost_centers",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            // COA_V2_IMPLEMENTATION_BRIEF.md Stage 1 hard invariant: first digit of Code ==
            // Class, first two digits == Group. NULL-tolerant so the legacy Stage-0 accounts
            // (which have no Class/Group yet) remain valid; verified against all 233 rows of
            // PAKO_COA_v2_seed.csv with zero violations.
            migrationBuilder.Sql(
                """
                ALTER TABLE accounts ADD CONSTRAINT ck_accounts_code_class_group CHECK (
                    "Class" IS NULL OR "Group" IS NULL OR (
                        LEFT("Code", 1) = CAST("Class" AS text) AND
                        LEFT("Code", 2) = LPAD(CAST("Group" AS text), 2, '0')
                    )
                );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE accounts DROP CONSTRAINT IF EXISTS ck_accounts_code_class_group;");

            migrationBuilder.DropTable(
                name: "cost_centers");

            migrationBuilder.DropIndex(
                name: "IX_tax_definitions_CompanyId_Code",
                table: "tax_definitions");

            migrationBuilder.DropIndex(
                name: "IX_journal_entry_lines_CostCenterId",
                table: "journal_entry_lines");

            migrationBuilder.DropColumn(
                name: "AtkBook",
                table: "tax_definitions");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "tax_definitions");

            migrationBuilder.DropColumn(
                name: "DeductiblePercent",
                table: "tax_definitions");

            migrationBuilder.DropColumn(
                name: "Direction",
                table: "tax_definitions");

            migrationBuilder.DropColumn(
                name: "IsReverseCharge",
                table: "tax_definitions");

            migrationBuilder.DropColumn(
                name: "CostCenterId",
                table: "journal_entry_lines");

            migrationBuilder.DropColumn(
                name: "ExchangeRate",
                table: "journal_entry_lines");

            migrationBuilder.DropColumn(
                name: "OriginalAmount",
                table: "journal_entry_lines");

            migrationBuilder.DropColumn(
                name: "OriginalCurrency",
                table: "journal_entry_lines");

            migrationBuilder.DropColumn(
                name: "EnabledProfiles",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "FunctionalCurrency",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "CitDeductibility",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "CitLimitRule",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "Class",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "DefaultVatCode",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "Group",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "IsControl",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "IsPostable",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "NameSq",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "NormalBalance",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "Profiles",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "Statement",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "Subledger",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "ValidFrom",
                table: "accounts");

            migrationBuilder.DropColumn(
                name: "ValidTo",
                table: "accounts");
        }
    }
}
