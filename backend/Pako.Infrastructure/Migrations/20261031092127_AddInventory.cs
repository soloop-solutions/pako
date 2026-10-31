using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddInventory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CategoryId",
                table: "items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "MinimumStock",
                table: "items",
                type: "numeric(18,4)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "TrackInventory",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "WarehouseId",
                table: "invoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InventoryAccess",
                table: "company_roles",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<Guid>(
                name: "WarehouseId",
                table: "bills",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "item_categories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    InventoryAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    CogsAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    RevenueAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    ExpenseAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_categories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_item_categories_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "item_costs",
                columns: table => new
                {
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    AverageCost = table.Column<decimal>(type: "numeric(18,6)", nullable: false),
                    Value = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    LastMoveDate = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_costs", x => x.ItemId);
                    table.ForeignKey(
                        name: "FK_item_costs_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "warehouses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Address = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_warehouses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_warehouses_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "stock_documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Number = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: false),
                    DestinationWarehouseId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    AtkNoticeDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    JournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    PostedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    PostedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stock_documents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_stock_documents_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_stock_documents_warehouses_DestinationWarehouseId",
                        column: x => x.DestinationWarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_stock_documents_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "stock_locations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Usage = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stock_locations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_stock_locations_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_stock_locations_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "stock_settings",
                columns: table => new
                {
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    CostMethod = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CostMethodSince = table.Column<DateOnly>(type: "date", nullable: true),
                    NegativeStock = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    DefaultWarehouseId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stock_settings", x => x.CompanyId);
                    table.ForeignKey(
                        name: "FK_stock_settings_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_stock_settings_warehouses_DefaultWarehouseId",
                        column: x => x.DefaultWarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "stock_document_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StockDocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitCost = table.Column<decimal>(type: "numeric(18,6)", nullable: true),
                    BookQuantity = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    Difference = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stock_document_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_stock_document_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_stock_document_lines_stock_documents_StockDocumentId",
                        column: x => x.StockDocumentId,
                        principalTable: "stock_documents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "stock_balances",
                columns: table => new
                {
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stock_balances", x => new { x.ItemId, x.LocationId });
                    table.ForeignKey(
                        name: "FK_stock_balances_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_stock_balances_stock_locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "stock_locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "stock_moves",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FromLocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ToLocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitCost = table.Column<decimal>(type: "numeric(18,6)", nullable: false),
                    Value = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ValueDelta = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Correction = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    QtyAfter = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    AvgCostAfter = table.Column<decimal>(type: "numeric(18,6)", nullable: false),
                    ValueAfter = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    SourceType = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reference = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stock_moves", x => x.Id);
                    table.ForeignKey(
                        name: "FK_stock_moves_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_stock_moves_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_stock_moves_stock_locations_FromLocationId",
                        column: x => x.FromLocationId,
                        principalTable: "stock_locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_stock_moves_stock_locations_ToLocationId",
                        column: x => x.ToLocationId,
                        principalTable: "stock_locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_items_CategoryId",
                table: "items",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_invoices_WarehouseId",
                table: "invoices",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_bills_WarehouseId",
                table: "bills",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_item_categories_CompanyId_Name",
                table: "item_categories",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_item_costs_CompanyId",
                table: "item_costs",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_balances_CompanyId_LocationId",
                table: "stock_balances",
                columns: new[] { "CompanyId", "LocationId" });

            migrationBuilder.CreateIndex(
                name: "IX_stock_balances_LocationId",
                table: "stock_balances",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_document_lines_ItemId",
                table: "stock_document_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_document_lines_StockDocumentId",
                table: "stock_document_lines",
                column: "StockDocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_documents_CompanyId_Number",
                table: "stock_documents",
                columns: new[] { "CompanyId", "Number" },
                unique: true,
                filter: "\"Number\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_stock_documents_CompanyId_Type_Date",
                table: "stock_documents",
                columns: new[] { "CompanyId", "Type", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_stock_documents_DestinationWarehouseId",
                table: "stock_documents",
                column: "DestinationWarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_documents_WarehouseId",
                table: "stock_documents",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_locations_CompanyId_Usage_WarehouseId",
                table: "stock_locations",
                columns: new[] { "CompanyId", "Usage", "WarehouseId" });

            migrationBuilder.CreateIndex(
                name: "IX_stock_locations_WarehouseId",
                table: "stock_locations",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_moves_CompanyId_ItemId_Date_Sequence",
                table: "stock_moves",
                columns: new[] { "CompanyId", "ItemId", "Date", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_stock_moves_FromLocationId",
                table: "stock_moves",
                column: "FromLocationId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_moves_ItemId",
                table: "stock_moves",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_moves_SourceType_SourceId",
                table: "stock_moves",
                columns: new[] { "SourceType", "SourceId" });

            migrationBuilder.CreateIndex(
                name: "IX_stock_moves_ToLocationId",
                table: "stock_moves",
                column: "ToLocationId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_settings_DefaultWarehouseId",
                table: "stock_settings",
                column: "DefaultWarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_warehouses_CompanyId_Code",
                table: "warehouses",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_bills_warehouses_WarehouseId",
                table: "bills",
                column: "WarehouseId",
                principalTable: "warehouses",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_invoices_warehouses_WarehouseId",
                table: "invoices",
                column: "WarehouseId",
                principalTable: "warehouses",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_items_item_categories_CategoryId",
                table: "items",
                column: "CategoryId",
                principalTable: "item_categories",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        
            // docs/INVENTORY_PLAN.md D7: the Inventory module is on for every existing company (stock
            // stays off until items are tracked), and the built-in roles get the Inventory area the
            // templates give new companies.
            migrationBuilder.Sql("""
                UPDATE companies SET "EnabledModules" = "EnabledModules" | 64;
                UPDATE company_roles SET "InventoryAccess" = 'Approve' WHERE "BuiltInKey" = 'accountant';
                UPDATE company_roles SET "InventoryAccess" = 'Write' WHERE "BuiltInKey" = 'purchasing';
                UPDATE company_roles SET "InventoryAccess" = 'Read' WHERE "BuiltInKey" IN ('sales', 'readonly');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_bills_warehouses_WarehouseId",
                table: "bills");

            migrationBuilder.DropForeignKey(
                name: "FK_invoices_warehouses_WarehouseId",
                table: "invoices");

            migrationBuilder.DropForeignKey(
                name: "FK_items_item_categories_CategoryId",
                table: "items");

            migrationBuilder.DropTable(
                name: "item_categories");

            migrationBuilder.DropTable(
                name: "item_costs");

            migrationBuilder.DropTable(
                name: "stock_balances");

            migrationBuilder.DropTable(
                name: "stock_document_lines");

            migrationBuilder.DropTable(
                name: "stock_moves");

            migrationBuilder.DropTable(
                name: "stock_settings");

            migrationBuilder.DropTable(
                name: "stock_documents");

            migrationBuilder.DropTable(
                name: "stock_locations");

            migrationBuilder.DropTable(
                name: "warehouses");

            migrationBuilder.DropIndex(
                name: "IX_items_CategoryId",
                table: "items");

            migrationBuilder.DropIndex(
                name: "IX_invoices_WarehouseId",
                table: "invoices");

            migrationBuilder.DropIndex(
                name: "IX_bills_WarehouseId",
                table: "bills");

            migrationBuilder.DropColumn(
                name: "CategoryId",
                table: "items");

            migrationBuilder.DropColumn(
                name: "MinimumStock",
                table: "items");

            migrationBuilder.DropColumn(
                name: "TrackInventory",
                table: "items");

            migrationBuilder.DropColumn(
                name: "WarehouseId",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "InventoryAccess",
                table: "company_roles");

            migrationBuilder.DropColumn(
                name: "WarehouseId",
                table: "bills");
        }
    }
}
