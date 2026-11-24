using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTwoStepPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "OutstandingPaymentsAccountId",
                table: "journals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OutstandingReceiptsAccountId",
                table: "journals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OutstandingPaymentsAccountId",
                table: "company_account_defaults",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OutstandingReceiptsAccountId",
                table: "company_account_defaults",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DirectAccountId",
                table: "bank_statement_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PaymentId",
                table: "bank_statement_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Direction = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Reference = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    JournalEntryId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClearingJournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    DestinationAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    OutstandingAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    BillId = table.Column<Guid>(type: "uuid", nullable: true),
                    BankStatementLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_payments_bills_BillId",
                        column: x => x.BillId,
                        principalTable: "bills",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_payments_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_payments_invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_payments_journal_entries_ClearingJournalEntryId",
                        column: x => x.ClearingJournalEntryId,
                        principalTable: "journal_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_payments_journal_entries_JournalEntryId",
                        column: x => x.JournalEntryId,
                        principalTable: "journal_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_payments_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_DirectAccountId",
                table: "bank_statement_lines",
                column: "DirectAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_bank_statement_lines_PaymentId",
                table: "bank_statement_lines",
                column: "PaymentId");

            migrationBuilder.CreateIndex(
                name: "IX_payments_BillId",
                table: "payments",
                column: "BillId",
                filter: "\"BillId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_payments_ClearingJournalEntryId",
                table: "payments",
                column: "ClearingJournalEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_payments_CompanyId_State",
                table: "payments",
                columns: new[] { "CompanyId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_payments_InvoiceId",
                table: "payments",
                column: "InvoiceId",
                filter: "\"InvoiceId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_payments_JournalEntryId",
                table: "payments",
                column: "JournalEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_payments_PartnerId",
                table: "payments",
                column: "PartnerId");

            migrationBuilder.AddForeignKey(
                name: "FK_bank_statement_lines_accounts_DirectAccountId",
                table: "bank_statement_lines",
                column: "DirectAccountId",
                principalTable: "accounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_bank_statement_lines_payments_PaymentId",
                table: "bank_statement_lines",
                column: "PaymentId",
                principalTable: "payments",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_bank_statement_lines_accounts_DirectAccountId",
                table: "bank_statement_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_bank_statement_lines_payments_PaymentId",
                table: "bank_statement_lines");

            migrationBuilder.DropTable(
                name: "payments");

            migrationBuilder.DropIndex(
                name: "IX_bank_statement_lines_DirectAccountId",
                table: "bank_statement_lines");

            migrationBuilder.DropIndex(
                name: "IX_bank_statement_lines_PaymentId",
                table: "bank_statement_lines");

            migrationBuilder.DropColumn(
                name: "OutstandingPaymentsAccountId",
                table: "journals");

            migrationBuilder.DropColumn(
                name: "OutstandingReceiptsAccountId",
                table: "journals");

            migrationBuilder.DropColumn(
                name: "OutstandingPaymentsAccountId",
                table: "company_account_defaults");

            migrationBuilder.DropColumn(
                name: "OutstandingReceiptsAccountId",
                table: "company_account_defaults");

            migrationBuilder.DropColumn(
                name: "DirectAccountId",
                table: "bank_statement_lines");

            migrationBuilder.DropColumn(
                name: "PaymentId",
                table: "bank_statement_lines");
        }
    }
}
