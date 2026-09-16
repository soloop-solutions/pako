using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAnalyticDistribution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // B14: add the new column and backfill it from the old one BEFORE dropping
            // CostCenterId — every existing non-null value becomes a single 100% entry, the
            // literal meaning a single-valued cost center already had.
            migrationBuilder.AddColumn<string>(
                name: "AnalyticDistribution",
                table: "journal_entry_lines",
                type: "jsonb",
                nullable: true);

            migrationBuilder.Sql(
                "UPDATE journal_entry_lines " +
                "SET \"AnalyticDistribution\" = jsonb_build_object(\"CostCenterId\"::text, 100) " +
                "WHERE \"CostCenterId\" IS NOT NULL;");

            migrationBuilder.DropIndex(
                name: "IX_journal_entry_lines_CostCenterId",
                table: "journal_entry_lines");

            migrationBuilder.DropColumn(
                name: "CostCenterId",
                table: "journal_entry_lines");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AnalyticDistribution",
                table: "journal_entry_lines");

            migrationBuilder.AddColumn<Guid>(
                name: "CostCenterId",
                table: "journal_entry_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_journal_entry_lines_CostCenterId",
                table: "journal_entry_lines",
                column: "CostCenterId");
        }
    }
}
