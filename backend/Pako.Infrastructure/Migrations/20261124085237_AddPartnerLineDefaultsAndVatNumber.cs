using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPartnerLineDefaultsAndVatNumber : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DefaultExpenseAccountId",
                table: "partners",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DefaultPurchaseTaxDefinitionId",
                table: "partners",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DefaultRevenueAccountId",
                table: "partners",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DefaultSaleTaxDefinitionId",
                table: "partners",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VatNumber",
                table: "partners",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DefaultExpenseAccountId",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "DefaultPurchaseTaxDefinitionId",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "DefaultRevenueAccountId",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "DefaultSaleTaxDefinitionId",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "VatNumber",
                table: "partners");
        }
    }
}
