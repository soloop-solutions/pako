using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddWholesalePriceAndDiscountRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PriceTier",
                table: "partners",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "WholesalePrice",
                table: "items",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "discount_rules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    ItemCategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    Percent = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    ValidFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    ValidTo = table.Column<DateOnly>(type: "date", nullable: false),
                    Priority = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_discount_rules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_discount_rules_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_discount_rules_item_categories_ItemCategoryId",
                        column: x => x.ItemCategoryId,
                        principalTable: "item_categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_discount_rules_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_discount_rules_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_discount_rules_CompanyId_ValidFrom_ValidTo",
                table: "discount_rules",
                columns: new[] { "CompanyId", "ValidFrom", "ValidTo" });

            migrationBuilder.CreateIndex(
                name: "IX_discount_rules_ItemCategoryId",
                table: "discount_rules",
                column: "ItemCategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_discount_rules_ItemId",
                table: "discount_rules",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_discount_rules_PartnerId",
                table: "discount_rules",
                column: "PartnerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "discount_rules");

            migrationBuilder.DropColumn(
                name: "PriceTier",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "WholesalePrice",
                table: "items");
        }
    }
}
