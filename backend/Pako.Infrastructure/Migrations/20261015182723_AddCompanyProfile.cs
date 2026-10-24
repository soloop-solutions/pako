using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCompanyProfile : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AddressLine2",
                table: "companies",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankAccountHolder",
                table: "companies",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankName",
                table: "companies",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BusinessActivity",
                table: "companies",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BusinessNumber",
                table: "companies",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Country",
                table: "companies",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "companies",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DocumentFooter",
                table: "companies",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "companies",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FiscalNumber",
                table: "companies",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Iban",
                table: "companies",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LegalForm",
                table: "companies",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Municipality",
                table: "companies",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PaymentInstructions",
                table: "companies",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "companies",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PostalCode",
                table: "companies",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StreetAddress",
                table: "companies",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SwiftBic",
                table: "companies",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TradingName",
                table: "companies",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VatNumber",
                table: "companies",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "VatRegistrationDate",
                table: "companies",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Website",
                table: "companies",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AddressLine2",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "BankAccountHolder",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "BankName",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "BusinessActivity",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "BusinessNumber",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "Country",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "Description",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "DocumentFooter",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "FiscalNumber",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "Iban",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "LegalForm",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "Municipality",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "PaymentInstructions",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "PostalCode",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "StreetAddress",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "SwiftBic",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "TradingName",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "VatNumber",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "VatRegistrationDate",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "Website",
                table: "companies");
        }
    }
}
