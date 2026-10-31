using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddInventoryPhase2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PartnerId",
                table: "stock_documents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AllowanceAfter",
                table: "stock_document_lines",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Amount",
                table: "stock_document_lines",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AverageCost",
                table: "stock_document_lines",
                type: "numeric(18,6)",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ExpiryDate",
                table: "stock_document_lines",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LotNumber",
                table: "stock_document_lines",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PurchaseOrderLineId",
                table: "stock_document_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PurchaseUnit",
                table: "items",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PurchaseUnitFactor",
                table: "items",
                type: "numeric(18,4)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SalesUnit",
                table: "items",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SalesUnitFactor",
                table: "items",
                type: "numeric(18,4)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "TrackLots",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ExpiryDate",
                table: "invoice_lines",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LotNumber",
                table: "invoice_lines",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "UnitFactor",
                table: "invoice_lines",
                type: "numeric(18,4)",
                nullable: false,
                defaultValue: 1m);

            migrationBuilder.AddColumn<string>(
                name: "UnitName",
                table: "invoice_lines",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ExpiryDate",
                table: "bill_lines",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LotNumber",
                table: "bill_lines",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PurchaseOrderLineId",
                table: "bill_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "UnitFactor",
                table: "bill_lines",
                type: "numeric(18,4)",
                nullable: false,
                defaultValue: 1m);

            migrationBuilder.AddColumn<string>(
                name: "UnitName",
                table: "bill_lines",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "lots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ExpiryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_lots_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_lots_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "price_lists",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_price_lists", x => x.Id);
                    table.ForeignKey(
                        name: "FK_price_lists_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_price_lists_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "purchase_orders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    ExpectedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    VendorReference = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ConfirmedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_purchase_orders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_purchase_orders_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_purchase_orders_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_purchase_orders_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "receipt_matches",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    BillId = table.Column<Guid>(type: "uuid", nullable: false),
                    BillLineId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReceiptLineId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    Value = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_receipt_matches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_receipt_matches_bills_BillId",
                        column: x => x.BillId,
                        principalTable: "bills",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_receipt_matches_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_receipt_matches_stock_document_lines_ReceiptLineId",
                        column: x => x.ReceiptLineId,
                        principalTable: "stock_document_lines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "lot_balances",
                columns: table => new
                {
                    LotId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lot_balances", x => new { x.LotId, x.LocationId });
                    table.ForeignKey(
                        name: "FK_lot_balances_lots_LotId",
                        column: x => x.LotId,
                        principalTable: "lots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_lot_balances_stock_locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "stock_locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "stock_move_lots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StockMoveId = table.Column<Guid>(type: "uuid", nullable: false),
                    LotId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stock_move_lots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_stock_move_lots_lots_LotId",
                        column: x => x.LotId,
                        principalTable: "lots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_stock_move_lots_stock_moves_StockMoveId",
                        column: x => x.StockMoveId,
                        principalTable: "stock_moves",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "price_changes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceListId = table.Column<Guid>(type: "uuid", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Number = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    PostedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    PostedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_price_changes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_price_changes_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_price_changes_price_lists_PriceListId",
                        column: x => x.PriceListId,
                        principalTable: "price_lists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "purchase_order_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PurchaseOrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    Description = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    TaxDefinitionId = table.Column<Guid>(type: "uuid", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_purchase_order_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_purchase_order_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_purchase_order_lines_purchase_orders_PurchaseOrderId",
                        column: x => x.PurchaseOrderId,
                        principalTable: "purchase_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "price_change_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceChangeId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    NewPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    OldPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    Difference = table.Column<decimal>(type: "numeric(18,2)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_price_change_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_price_change_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_price_change_lines_price_changes_PriceChangeId",
                        column: x => x.PriceChangeId,
                        principalTable: "price_changes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "price_list_prices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceListId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Price = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    ValidFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    PriceChangeId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_price_list_prices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_price_list_prices_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_price_list_prices_price_changes_PriceChangeId",
                        column: x => x.PriceChangeId,
                        principalTable: "price_changes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_price_list_prices_price_lists_PriceListId",
                        column: x => x.PriceListId,
                        principalTable: "price_lists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_stock_documents_PartnerId",
                table: "stock_documents",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_document_lines_PurchaseOrderLineId",
                table: "stock_document_lines",
                column: "PurchaseOrderLineId");

            migrationBuilder.CreateIndex(
                name: "IX_bill_lines_PurchaseOrderLineId",
                table: "bill_lines",
                column: "PurchaseOrderLineId");

            migrationBuilder.CreateIndex(
                name: "IX_lot_balances_ItemId_LocationId",
                table: "lot_balances",
                columns: new[] { "ItemId", "LocationId" });

            migrationBuilder.CreateIndex(
                name: "IX_lot_balances_LocationId",
                table: "lot_balances",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_lots_CompanyId_ExpiryDate",
                table: "lots",
                columns: new[] { "CompanyId", "ExpiryDate" });

            migrationBuilder.CreateIndex(
                name: "IX_lots_ItemId_Number",
                table: "lots",
                columns: new[] { "ItemId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_price_change_lines_ItemId",
                table: "price_change_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_price_change_lines_PriceChangeId",
                table: "price_change_lines",
                column: "PriceChangeId");

            migrationBuilder.CreateIndex(
                name: "IX_price_changes_CompanyId_Date",
                table: "price_changes",
                columns: new[] { "CompanyId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_price_changes_CompanyId_Number",
                table: "price_changes",
                columns: new[] { "CompanyId", "Number" },
                unique: true,
                filter: "\"Number\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_price_changes_PriceListId",
                table: "price_changes",
                column: "PriceListId");

            migrationBuilder.CreateIndex(
                name: "IX_price_list_prices_ItemId",
                table: "price_list_prices",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_price_list_prices_PriceChangeId",
                table: "price_list_prices",
                column: "PriceChangeId");

            migrationBuilder.CreateIndex(
                name: "IX_price_list_prices_PriceListId_ItemId_ValidFrom",
                table: "price_list_prices",
                columns: new[] { "PriceListId", "ItemId", "ValidFrom" });

            migrationBuilder.CreateIndex(
                name: "IX_price_lists_CompanyId_Name",
                table: "price_lists",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_price_lists_CompanyId_WarehouseId",
                table: "price_lists",
                columns: new[] { "CompanyId", "WarehouseId" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_price_lists_WarehouseId",
                table: "price_lists",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_order_lines_ItemId",
                table: "purchase_order_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_order_lines_PurchaseOrderId",
                table: "purchase_order_lines",
                column: "PurchaseOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_orders_CompanyId_Number",
                table: "purchase_orders",
                columns: new[] { "CompanyId", "Number" },
                unique: true,
                filter: "\"Number\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_orders_CompanyId_State_Date",
                table: "purchase_orders",
                columns: new[] { "CompanyId", "State", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_purchase_orders_PartnerId",
                table: "purchase_orders",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_purchase_orders_WarehouseId",
                table: "purchase_orders",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_receipt_matches_BillId",
                table: "receipt_matches",
                column: "BillId");

            migrationBuilder.CreateIndex(
                name: "IX_receipt_matches_CompanyId",
                table: "receipt_matches",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_receipt_matches_ReceiptLineId",
                table: "receipt_matches",
                column: "ReceiptLineId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_move_lots_LotId",
                table: "stock_move_lots",
                column: "LotId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_move_lots_StockMoveId",
                table: "stock_move_lots",
                column: "StockMoveId");

            migrationBuilder.AddForeignKey(
                name: "FK_bill_lines_purchase_order_lines_PurchaseOrderLineId",
                table: "bill_lines",
                column: "PurchaseOrderLineId",
                principalTable: "purchase_order_lines",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_stock_document_lines_purchase_order_lines_PurchaseOrderLine~",
                table: "stock_document_lines",
                column: "PurchaseOrderLineId",
                principalTable: "purchase_order_lines",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_stock_documents_partners_PartnerId",
                table: "stock_documents",
                column: "PartnerId",
                principalTable: "partners",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_bill_lines_purchase_order_lines_PurchaseOrderLineId",
                table: "bill_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_stock_document_lines_purchase_order_lines_PurchaseOrderLine~",
                table: "stock_document_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_stock_documents_partners_PartnerId",
                table: "stock_documents");

            migrationBuilder.DropTable(
                name: "lot_balances");

            migrationBuilder.DropTable(
                name: "price_change_lines");

            migrationBuilder.DropTable(
                name: "price_list_prices");

            migrationBuilder.DropTable(
                name: "purchase_order_lines");

            migrationBuilder.DropTable(
                name: "receipt_matches");

            migrationBuilder.DropTable(
                name: "stock_move_lots");

            migrationBuilder.DropTable(
                name: "price_changes");

            migrationBuilder.DropTable(
                name: "purchase_orders");

            migrationBuilder.DropTable(
                name: "lots");

            migrationBuilder.DropTable(
                name: "price_lists");

            migrationBuilder.DropIndex(
                name: "IX_stock_documents_PartnerId",
                table: "stock_documents");

            migrationBuilder.DropIndex(
                name: "IX_stock_document_lines_PurchaseOrderLineId",
                table: "stock_document_lines");

            migrationBuilder.DropIndex(
                name: "IX_bill_lines_PurchaseOrderLineId",
                table: "bill_lines");

            migrationBuilder.DropColumn(
                name: "PartnerId",
                table: "stock_documents");

            migrationBuilder.DropColumn(
                name: "AllowanceAfter",
                table: "stock_document_lines");

            migrationBuilder.DropColumn(
                name: "Amount",
                table: "stock_document_lines");

            migrationBuilder.DropColumn(
                name: "AverageCost",
                table: "stock_document_lines");

            migrationBuilder.DropColumn(
                name: "ExpiryDate",
                table: "stock_document_lines");

            migrationBuilder.DropColumn(
                name: "LotNumber",
                table: "stock_document_lines");

            migrationBuilder.DropColumn(
                name: "PurchaseOrderLineId",
                table: "stock_document_lines");

            migrationBuilder.DropColumn(
                name: "PurchaseUnit",
                table: "items");

            migrationBuilder.DropColumn(
                name: "PurchaseUnitFactor",
                table: "items");

            migrationBuilder.DropColumn(
                name: "SalesUnit",
                table: "items");

            migrationBuilder.DropColumn(
                name: "SalesUnitFactor",
                table: "items");

            migrationBuilder.DropColumn(
                name: "TrackLots",
                table: "items");

            migrationBuilder.DropColumn(
                name: "ExpiryDate",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "LotNumber",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "UnitFactor",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "UnitName",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "ExpiryDate",
                table: "bill_lines");

            migrationBuilder.DropColumn(
                name: "LotNumber",
                table: "bill_lines");

            migrationBuilder.DropColumn(
                name: "PurchaseOrderLineId",
                table: "bill_lines");

            migrationBuilder.DropColumn(
                name: "UnitFactor",
                table: "bill_lines");

            migrationBuilder.DropColumn(
                name: "UnitName",
                table: "bill_lines");
        }
    }
}
