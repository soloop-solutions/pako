using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddBankStatements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "bank_statements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    BankAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    FileHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PeriodFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    PeriodTo = table.Column<DateOnly>(type: "date", nullable: false),
                    OpeningBalance = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ClosingBalance = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ConfirmedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bank_statements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_bank_statements_accounts_BankAccountId",
                        column: x => x.BankAccountId,
                        principalTable: "accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_bank_statements_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "bank_statement_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StatementId = table.Column<Guid>(type: "uuid", nullable: false),
                    RowNumber = table.Column<int>(type: "integer", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    PartnerText = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Reference = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    AmountIn = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    AmountOut = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IsDuplicate = table.Column<bool>(type: "boolean", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    BillId = table.Column<Guid>(type: "uuid", nullable: true),
                    MatchAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    JournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReconciliationId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bank_statement_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_bank_statement_lines_bank_statements_StatementId",
                        column: x => x.StatementId,
                        principalTable: "bank_statements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_bank_statement_lines_bills_BillId",
                        column: x => x.BillId,
                        principalTable: "bills",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_bank_statement_lines_invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_bank_statement_lines_journal_entries_JournalEntryId",
                        column: x => x.JournalEntryId,
                        principalTable: "journal_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_bank_statement_lines_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_bank_statement_lines_reconciliations_ReconciliationId",
                        column: x => x.ReconciliationId,
                        principalTable: "reconciliations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_BillId",
                table: "bank_statement_lines",
                column: "BillId");

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_Fingerprint",
                table: "bank_statement_lines",
                column: "Fingerprint");

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_InvoiceId",
                table: "bank_statement_lines",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_JournalEntryId",
                table: "bank_statement_lines",
                column: "JournalEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_PartnerId",
                table: "bank_statement_lines",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_ReconciliationId",
                table: "bank_statement_lines",
                column: "ReconciliationId");

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_StatementId_RowNumber",
                table: "bank_statement_lines",
                columns: new[] { "StatementId", "RowNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_bank_statements_BankAccountId",
                table: "bank_statements",
                column: "BankAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_bank_statements_CompanyId_FileHash",
                table: "bank_statements",
                columns: new[] { "CompanyId", "FileHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_bank_statements_CompanyId_PeriodFrom",
                table: "bank_statements",
                columns: new[] { "CompanyId", "PeriodFrom" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "bank_statement_lines");

            migrationBuilder.DropTable(
                name: "bank_statements");
        }
    }
}
