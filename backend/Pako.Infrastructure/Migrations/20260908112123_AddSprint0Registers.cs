using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSprint0Registers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FiscalNumber",
                table: "partners",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsVatRegistered",
                table: "partners",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "GraceDays",
                table: "invoices",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PaymentTermDays",
                table: "invoices",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PriceMode",
                table: "invoices",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "ItemId",
                table: "invoice_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ItemId",
                table: "bill_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "document_number_audits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    OldNumber = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    NewNumber = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_document_number_audits", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "items",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Unit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DefaultTaxDefinitionId = table.Column<Guid>(type: "uuid", nullable: true),
                    DefaultRevenueAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    DefaultExpenseAccountId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_items", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "number_series",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Pattern = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    NextValue = table.Column<int>(type: "integer", nullable: false, defaultValue: 1)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_number_series", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "payment_methods",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    LedgerAccountId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_methods", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "item_barcodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Barcode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_barcodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_item_barcodes_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_invoice_lines_ItemId",
                table: "invoice_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_bill_lines_ItemId",
                table: "bill_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_document_number_audits_CompanyId_DocumentId",
                table: "document_number_audits",
                columns: new[] { "CompanyId", "DocumentId" });

            migrationBuilder.CreateIndex(
                name: "IX_item_barcodes_CompanyId_Barcode",
                table: "item_barcodes",
                columns: new[] { "CompanyId", "Barcode" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_item_barcodes_ItemId",
                table: "item_barcodes",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_items_CompanyId_Code",
                table: "items",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_number_series_CompanyId_DocumentType_Year",
                table: "number_series",
                columns: new[] { "CompanyId", "DocumentType", "Year" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_payment_methods_CompanyId",
                table: "payment_methods",
                column: "CompanyId");

            migrationBuilder.AddForeignKey(
                name: "FK_bill_lines_items_ItemId",
                table: "bill_lines",
                column: "ItemId",
                principalTable: "items",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_invoice_lines_items_ItemId",
                table: "invoice_lines",
                column: "ItemId",
                principalTable: "items",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_bill_lines_items_ItemId",
                table: "bill_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_invoice_lines_items_ItemId",
                table: "invoice_lines");

            migrationBuilder.DropTable(
                name: "document_number_audits");

            migrationBuilder.DropTable(
                name: "item_barcodes");

            migrationBuilder.DropTable(
                name: "number_series");

            migrationBuilder.DropTable(
                name: "payment_methods");

            migrationBuilder.DropTable(
                name: "items");

            migrationBuilder.DropIndex(
                name: "IX_invoice_lines_ItemId",
                table: "invoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_bill_lines_ItemId",
                table: "bill_lines");

            migrationBuilder.DropColumn(
                name: "FiscalNumber",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "IsVatRegistered",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "GraceDays",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "PaymentTermDays",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "PriceMode",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "ItemId",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "ItemId",
                table: "bill_lines");
        }
    }
}
