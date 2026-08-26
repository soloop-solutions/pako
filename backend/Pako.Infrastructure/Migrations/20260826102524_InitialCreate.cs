using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "accounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    AccountType = table.Column<int>(type: "integer", nullable: false),
                    AccountSubType = table.Column<int>(type: "integer", nullable: false),
                    ParentAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsReconcilable = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_accounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "companies",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    AccountingLockDate = table.Column<DateOnly>(type: "date", nullable: true),
                    TaxLockDate = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_companies", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "journal_entries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    JournalId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Reference = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SequenceNumber = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    PostedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EntryHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    PrevHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    SecureSequenceNumber = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_journal_entries", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "journals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Code = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    DefaultDebitAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    DefaultCreditAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    SequencePrefix = table.Column<string>(type: "text", nullable: false),
                    SequenceNextNumber = table.Column<int>(type: "integer", nullable: false),
                    SequencePadding = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_journals", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "journal_entry_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    JournalEntryId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Debit = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Credit = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Description = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    TaxId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReconciledFlag = table.Column<bool>(type: "boolean", nullable: false),
                    ReconciliationId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_journal_entry_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_journal_entry_lines_journal_entries_JournalEntryId",
                        column: x => x.JournalEntryId,
                        principalTable: "journal_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_accounts_CompanyId_Code",
                table: "accounts",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_journal_entries_CompanyId_JournalId_State",
                table: "journal_entries",
                columns: new[] { "CompanyId", "JournalId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_journal_entry_lines_AccountId",
                table: "journal_entry_lines",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_journal_entry_lines_JournalEntryId",
                table: "journal_entry_lines",
                column: "JournalEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_journals_CompanyId_Code",
                table: "journals",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION enforce_journal_entry_balance() RETURNS TRIGGER AS $$
                DECLARE
                    total_debit numeric(18,2);
                    total_credit numeric(18,2);
                BEGIN
                    IF NEW."State" = 'Posted' THEN
                        SELECT COALESCE(SUM("Debit"), 0), COALESCE(SUM("Credit"), 0)
                        INTO total_debit, total_credit
                        FROM journal_entry_lines
                        WHERE "JournalEntryId" = NEW."Id";

                        IF total_debit <> total_credit THEN
                            RAISE EXCEPTION 'Journal entry % is unbalanced: debit % <> credit %', NEW."Id", total_debit, total_credit;
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_enforce_journal_entry_balance
                AFTER INSERT OR UPDATE ON journal_entries
                FOR EACH ROW
                EXECUTE FUNCTION enforce_journal_entry_balance();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS trg_enforce_journal_entry_balance ON journal_entries;
                DROP FUNCTION IF EXISTS enforce_journal_entry_balance();
                """);

            migrationBuilder.DropTable(
                name: "accounts");

            migrationBuilder.DropTable(
                name: "companies");

            migrationBuilder.DropTable(
                name: "journal_entry_lines");

            migrationBuilder.DropTable(
                name: "journals");

            migrationBuilder.DropTable(
                name: "journal_entries");
        }
    }
}
