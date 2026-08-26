using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCreditNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DocumentType",
                table: "invoices",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "OriginalInvoiceId",
                table: "invoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NextCreditNoteNumber",
                table: "companies",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "DocumentType",
                table: "bills",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "OriginalBillId",
                table: "bills",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_invoices_OriginalInvoiceId",
                table: "invoices",
                column: "OriginalInvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_bills_OriginalBillId",
                table: "bills",
                column: "OriginalBillId");

            migrationBuilder.AddForeignKey(
                name: "FK_bills_bills_OriginalBillId",
                table: "bills",
                column: "OriginalBillId",
                principalTable: "bills",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_invoices_invoices_OriginalInvoiceId",
                table: "invoices",
                column: "OriginalInvoiceId",
                principalTable: "invoices",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_bills_bills_OriginalBillId",
                table: "bills");

            migrationBuilder.DropForeignKey(
                name: "FK_invoices_invoices_OriginalInvoiceId",
                table: "invoices");

            migrationBuilder.DropIndex(
                name: "IX_invoices_OriginalInvoiceId",
                table: "invoices");

            migrationBuilder.DropIndex(
                name: "IX_bills_OriginalBillId",
                table: "bills");

            migrationBuilder.DropColumn(
                name: "DocumentType",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "OriginalInvoiceId",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "NextCreditNoteNumber",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "DocumentType",
                table: "bills");

            migrationBuilder.DropColumn(
                name: "OriginalBillId",
                table: "bills");
        }
    }
}
