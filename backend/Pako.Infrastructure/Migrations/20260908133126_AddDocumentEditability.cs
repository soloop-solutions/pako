using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDocumentEditability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "InternalNotes",
                table: "invoices",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InternalNotes",
                table: "bills",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "document_edit_audits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    OldDueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    NewDueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    OldInternalNotes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    NewInternalNotes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_document_edit_audits", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_document_edit_audits_CompanyId_DocumentId",
                table: "document_edit_audits",
                columns: new[] { "CompanyId", "DocumentId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "document_edit_audits");

            migrationBuilder.DropColumn(
                name: "InternalNotes",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "InternalNotes",
                table: "bills");
        }
    }
}
