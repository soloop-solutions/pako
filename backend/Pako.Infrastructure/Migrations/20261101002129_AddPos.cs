using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_price_lists_CompanyId_WarehouseId",
                table: "price_lists");

            migrationBuilder.AddColumn<Guid>(
                name: "DriverUserId",
                table: "warehouses",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsVan",
                table: "warehouses",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "SiteId",
                table: "stock_documents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CostCodeId",
                table: "stock_document_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SalesOrderLineId",
                table: "stock_document_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsCustomerList",
                table: "price_lists",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<decimal>(
                name: "MinQuantity",
                table: "price_list_prices",
                type: "numeric(18,4)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "MinQuantity",
                table: "price_change_lines",
                type: "numeric(18,4)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "OverdueBlockDays",
                table: "partners",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PriceListId",
                table: "partners",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ActiveIngredient",
                table: "items",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AgencyCommissionPercent",
                table: "items",
                type: "numeric(5,2)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AgencyPartnerId",
                table: "items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AtcCode",
                table: "items",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BufferMinutes",
                table: "items",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DepositItemId",
                table: "items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DurationMinutes",
                table: "items",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsBookable",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsControlled",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsPrescriptionOnly",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsVariantTemplate",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<decimal>(
                name: "MaxRetailPrice",
                table: "items",
                type: "numeric(18,4)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MembershipDays",
                table: "items",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MinimumAge",
                table: "items",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "OpenPrice",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "PackageServiceItemId",
                table: "items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PackageSessions",
                table: "items",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PackageValidDays",
                table: "items",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Plu",
                table: "items",
                type: "character varying(6)",
                maxLength: 6,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ProductionCenterId",
                table: "items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "SellByWeight",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "TrackSerials",
                table: "items",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "VariantOfItemId",
                table: "items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WarrantyMonths",
                table: "items",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ProjectId",
                table: "invoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeliveryLineId",
                table: "invoice_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SalesOrderLineId",
                table: "invoice_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PosAccess",
                table: "company_roles",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<Guid>(
                name: "ProjectId",
                table: "bills",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CostCodeId",
                table: "bill_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "construction_sites",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    ClientPartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Address = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    ContractValue = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    RetentionPercent = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    RetentionReleased = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    BillingItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_construction_sites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_construction_sites_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_construction_sites_items_BillingItemId",
                        column: x => x.BillingItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_construction_sites_partners_ClientPartnerId",
                        column: x => x.ClientPartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_construction_sites_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "item_attributes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_attributes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_item_attributes_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "item_cross_references",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Brand = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Number = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Normalized = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_cross_references", x => x.Id);
                    table.ForeignKey(
                        name: "FK_item_cross_references_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "item_fitments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Make = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Model = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    YearFrom = table.Column<int>(type: "integer", nullable: true),
                    YearTo = table.Column<int>(type: "integer", nullable: true),
                    Engine = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_fitments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_item_fitments_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "item_recipe_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    IngredientItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    WastePercent = table.Column<decimal>(type: "numeric(9,4)", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_recipe_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_item_recipe_lines_items_IngredientItemId",
                        column: x => x.IngredientItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_item_recipe_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "item_serials",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Serial = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SoldOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    SoldAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    WarrantyUntil = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_serials", x => x.Id);
                    table.ForeignKey(
                        name: "FK_item_serials_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_item_serials_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_barcode_rules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Prefix = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ItemDigits = table.Column<int>(type: "integer", nullable: false),
                    ValueDigits = table.Column<int>(type: "integer", nullable: false),
                    ValueDecimals = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_barcode_rules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_barcode_rules_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_combo_slots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ComboItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    MinSelect = table.Column<int>(type: "integer", nullable: false),
                    MaxSelect = table.Column<int>(type: "integer", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_combo_slots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_combo_slots_items_ComboItemId",
                        column: x => x.ComboItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_fleet_cards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehiclePlate = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    DriverName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    LimitPerFill = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    FuelOnly = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_fleet_cards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_fleet_cards_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_fleet_cards_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_gift_cards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Balance = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ExpiresOn = table.Column<DateOnly>(type: "date", nullable: true),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_gift_cards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_gift_cards_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_gift_cards_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_loyalty_cards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    HolderName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Points = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_loyalty_cards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_loyalty_cards_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_loyalty_cards_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_memberships",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PlanItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: true),
                    HolderName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    StartsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    EndsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FrozenFrom = table.Column<DateOnly>(type: "date", nullable: true),
                    FrozenDays = table.Column<int>(type: "integer", nullable: false),
                    LastOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_memberships", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_memberships_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_memberships_items_PlanItemId",
                        column: x => x.PlanItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_memberships_partners_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_modifier_groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    MinSelect = table.Column<int>(type: "integer", nullable: false),
                    MaxSelect = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_modifier_groups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_modifier_groups_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_packages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ServiceItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: true),
                    HolderName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    SessionsTotal = table.Column<int>(type: "integer", nullable: false),
                    SessionsUsed = table.Column<int>(type: "integer", nullable: false),
                    UnitValue = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    ExpiresOn = table.Column<DateOnly>(type: "date", nullable: true),
                    SoldOrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_packages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_packages_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_packages_items_ServiceItemId",
                        column: x => x.ServiceItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_packages_partners_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_payers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    CoveragePercent = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_payers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_payers_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_payers_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_pins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    PinHash = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_pins", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_pins_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_stores",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Address = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    FiscalBranchNumber = table.Column<int>(type: "integer", nullable: false),
                    Location = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceListId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReceiptHeader = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ReceiptFooter = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    TipsAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    BookingToken = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    TouristTaxItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_stores", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_stores_accounts_TipsAccountId",
                        column: x => x.TipsAccountId,
                        principalTable: "accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_stores_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_stores_items_TouristTaxItemId",
                        column: x => x.TouristTaxItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_stores_price_lists_PriceListId",
                        column: x => x.PriceListId,
                        principalTable: "price_lists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_stores_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "re_buildings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Address = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    SaleItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_re_buildings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_re_buildings_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_re_buildings_items_SaleItemId",
                        column: x => x.SaleItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_re_buildings_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "sales_routes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: true),
                    Days = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sales_routes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sales_routes_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_sales_routes_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "construction_boq_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SiteId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_construction_boq_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_construction_boq_lines_construction_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "construction_sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "construction_cost_codes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SiteId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Budget = table.Column<decimal>(type: "numeric(18,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_construction_cost_codes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_construction_cost_codes_construction_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "construction_sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "construction_progress_bills",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SiteId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    PeriodTo = table.Column<DateOnly>(type: "date", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Retention = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_construction_progress_bills", x => x.Id);
                    table.ForeignKey(
                        name: "FK_construction_progress_bills_construction_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "construction_sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_construction_progress_bills_invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "item_attribute_values",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AttributeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Value = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_attribute_values", x => x.Id);
                    table.ForeignKey(
                        name: "FK_item_attribute_values_item_attributes_AttributeId",
                        column: x => x.AttributeId,
                        principalTable: "item_attributes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_combo_choices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SlotId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceDelta = table.Column<decimal>(type: "numeric(18,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_combo_choices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_combo_choices_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_combo_choices_pos_combo_slots_SlotId",
                        column: x => x.SlotId,
                        principalTable: "pos_combo_slots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_item_modifier_groups",
                columns: table => new
                {
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_item_modifier_groups", x => new { x.ItemId, x.GroupId });
                    table.ForeignKey(
                        name: "FK_pos_item_modifier_groups_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_item_modifier_groups_pos_modifier_groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "pos_modifier_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_modifiers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    PriceDelta = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    IngredientItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    IngredientQuantity = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_modifiers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_modifiers_items_IngredientItemId",
                        column: x => x.IngredientItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_modifiers_pos_modifier_groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "pos_modifier_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_floors",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_floors", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_floors_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_floors_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_fuel_tanks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Capacity = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_fuel_tanks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_fuel_tanks_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_fuel_tanks_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_fuel_tanks_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_prescriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    IssuedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    ValidUntil = table.Column<DateOnly>(type: "date", nullable: true),
                    Prescriber = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    PrescriberLicence = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    PatientName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    PatientPersonalNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    PayerId = table.Column<Guid>(type: "uuid", nullable: true),
                    CoveragePercent = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_prescriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_prescriptions_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_prescriptions_pos_payers_PayerId",
                        column: x => x.PayerId,
                        principalTable: "pos_payers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_prescriptions_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_production_centers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PrinterName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_production_centers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_production_centers_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_production_centers_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_programs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Reward = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    ValidFrom = table.Column<DateOnly>(type: "date", nullable: true),
                    ValidTo = table.Column<DateOnly>(type: "date", nullable: true),
                    Days = table.Column<int>(type: "integer", nullable: false),
                    TimeFrom = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    TimeTo = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: true),
                    Priority = table.Column<int>(type: "integer", nullable: false),
                    Stackable = table.Column<bool>(type: "boolean", nullable: false),
                    Code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    MaxUses = table.Column<int>(type: "integer", nullable: true),
                    Uses = table.Column<int>(type: "integer", nullable: false),
                    MinQuantity = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    MinAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    Percent = table.Column<decimal>(type: "numeric(9,4)", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    Price = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    BuyQuantity = table.Column<int>(type: "integer", nullable: true),
                    GetQuantity = table.Column<int>(type: "integer", nullable: true),
                    PointsPerEuro = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    PointValue = table.Column<decimal>(type: "numeric(18,4)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_programs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_programs_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_programs_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_registers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Profile = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FiscalMode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FiscalPosNumber = table.Column<int>(type: "integer", nullable: false),
                    FiscalizationNumber = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CertificatePem = table.Column<string>(type: "text", nullable: true),
                    CertificateThumbprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CertificateNotAfter = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CashAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_registers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_registers_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_registers_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_repair_tickets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: true),
                    CustomerName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Device = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    SerialOrPlate = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Problem = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Accessories = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    TechnicianUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReadyAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CollectedOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_repair_tickets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_repair_tickets_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_repair_tickets_partners_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_repair_tickets_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_resources",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Color = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_resources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_resources_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_resources_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_room_types",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: false),
                    RateItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_room_types", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_room_types_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_room_types_items_RateItemId",
                        column: x => x.RateItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_room_types_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_sales_channels",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_sales_channels", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_sales_channels_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_sales_channels_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_ticketed_events",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    StartsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_ticketed_events", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_ticketed_events_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_ticketed_events_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_venues",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_venues", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_venues_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_venues_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "re_units",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    BuildingId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Floor = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Area = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    ListPrice = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_re_units", x => x.Id);
                    table.ForeignKey(
                        name: "FK_re_units_re_buildings_BuildingId",
                        column: x => x.BuildingId,
                        principalTable: "re_buildings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "route_visits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RouteId = table.Column<Guid>(type: "uuid", nullable: true),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    CheckInAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CheckOutAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Latitude = table.Column<double>(type: "double precision", nullable: true),
                    Longitude = table.Column<double>(type: "double precision", nullable: true),
                    AccuracyMeters = table.Column<double>(type: "double precision", nullable: true),
                    Outcome = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Collected = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_route_visits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_route_visits_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_route_visits_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_route_visits_sales_routes_RouteId",
                        column: x => x.RouteId,
                        principalTable: "sales_routes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "sales_route_stops",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RouteId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sales_route_stops", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sales_route_stops_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_sales_route_stops_sales_routes_RouteId",
                        column: x => x.RouteId,
                        principalTable: "sales_routes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "construction_progress_bill_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgressBillId = table.Column<Guid>(type: "uuid", nullable: false),
                    BoqLineId = table.Column<Guid>(type: "uuid", nullable: false),
                    CumulativeQuantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    PreviousQuantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_construction_progress_bill_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_construction_progress_bill_lines_construction_boq_lines_Boq~",
                        column: x => x.BoqLineId,
                        principalTable: "construction_boq_lines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_construction_progress_bill_lines_construction_progress_bill~",
                        column: x => x.ProgressBillId,
                        principalTable: "construction_progress_bills",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "item_variant_values",
                columns: table => new
                {
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    AttributeValueId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_item_variant_values", x => new { x.ItemId, x.AttributeValueId });
                    table.ForeignKey(
                        name: "FK_item_variant_values_item_attribute_values_AttributeValueId",
                        column: x => x.AttributeValueId,
                        principalTable: "item_attribute_values",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_item_variant_values_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_tables",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FloorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Seats = table.Column<int>(type: "integer", nullable: false),
                    Shape = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    X = table.Column<int>(type: "integer", nullable: false),
                    Y = table.Column<int>(type: "integer", nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    QrToken = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_tables", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_tables_pos_floors_FloorId",
                        column: x => x.FloorId,
                        principalTable: "pos_floors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_fuel_nozzles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Pump = table.Column<int>(type: "integer", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    TankId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_fuel_nozzles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_fuel_nozzles_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_fuel_nozzles_pos_fuel_tanks_TankId",
                        column: x => x.TankId,
                        principalTable: "pos_fuel_tanks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_fuel_nozzles_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_tank_dips",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    TankId = table.Column<Guid>(type: "uuid", nullable: false),
                    MeasuredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Volume = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Water = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_tank_dips", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_tank_dips_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_tank_dips_pos_fuel_tanks_TankId",
                        column: x => x.TankId,
                        principalTable: "pos_fuel_tanks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_prescription_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PrescriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    Dispensed = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    Dosage = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_prescription_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_prescription_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_prescription_lines_pos_prescriptions_PrescriptionId",
                        column: x => x.PrescriptionId,
                        principalTable: "pos_prescriptions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_program_targets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgramId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_program_targets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_program_targets_item_categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "item_categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_program_targets_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_program_targets_pos_programs_ProgramId",
                        column: x => x.ProgramId,
                        principalTable: "pos_programs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_sessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RegisterId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    OpenedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    OpenedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    OpeningFloat = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ClosedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    BusinessDate = table.Column<DateOnly>(type: "date", nullable: false),
                    JournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    ZReportJson = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_sessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_sessions_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_sessions_pos_registers_RegisterId",
                        column: x => x.RegisterId,
                        principalTable: "pos_registers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_repair_ticket_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TicketId = table.Column<Guid>(type: "uuid", nullable: false),
                    LineNo = table.Column<int>(type: "integer", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_repair_ticket_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_repair_ticket_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_repair_ticket_lines_pos_repair_tickets_TicketId",
                        column: x => x.TicketId,
                        principalTable: "pos_repair_tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_appointments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    ResourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Start = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    End = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: true),
                    CustomerName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    DepositCardId = table.Column<Guid>(type: "uuid", nullable: true),
                    PosOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReminderSentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelReason = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_appointments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_appointments_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_appointments_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_appointments_partners_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_appointments_pos_gift_cards_DepositCardId",
                        column: x => x.DepositCardId,
                        principalTable: "pos_gift_cards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_appointments_pos_resources_ResourceId",
                        column: x => x.ResourceId,
                        principalTable: "pos_resources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_appointments_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_resource_hours",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ResourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Day = table.Column<int>(type: "integer", nullable: false),
                    From = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    To = table.Column<TimeOnly>(type: "time without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_resource_hours", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_resource_hours_pos_resources_ResourceId",
                        column: x => x.ResourceId,
                        principalTable: "pos_resources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_service_resources",
                columns: table => new
                {
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    ResourceId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_service_resources", x => new { x.ItemId, x.ResourceId });
                    table.ForeignKey(
                        name: "FK_pos_service_resources_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_service_resources_pos_resources_ResourceId",
                        column: x => x.ResourceId,
                        principalTable: "pos_resources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_rooms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Floor = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_rooms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_rooms_pos_room_types_RoomTypeId",
                        column: x => x.RoomTypeId,
                        principalTable: "pos_room_types",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_channel_orders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChannelId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ExternalRef = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Fulfilment = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Payment = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CustomerName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Address = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    City = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Total = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ShippingFee = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    CourierPartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    TrackingNumber = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    PosOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    RemittedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    RemittanceRef = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_channel_orders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_channel_orders_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_channel_orders_partners_CourierPartnerId",
                        column: x => x.CourierPartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_channel_orders_pos_sales_channels_ChannelId",
                        column: x => x.ChannelId,
                        principalTable: "pos_sales_channels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_event_ticket_types",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quota = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_event_ticket_types", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_event_ticket_types_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_event_ticket_types_pos_ticketed_events_EventId",
                        column: x => x.EventId,
                        principalTable: "pos_ticketed_events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "re_leases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: true),
                    Property = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    TenantPartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Rent = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    RentItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    DueDay = table.Column<int>(type: "integer", nullable: false),
                    Deposit = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    DepositReceivedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    DepositReturnedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_re_leases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_re_leases_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_re_leases_items_RentItemId",
                        column: x => x.RentItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_re_leases_partners_TenantPartnerId",
                        column: x => x.TenantPartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_re_leases_re_units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "re_units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "re_reservations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    ExpiresOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Deposit = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_re_reservations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_re_reservations_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_re_reservations_re_units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "re_units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "re_sale_contracts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    BuyerPartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ContractDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Price = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_re_sale_contracts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_re_sale_contracts_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_re_sale_contracts_partners_BuyerPartnerId",
                        column: x => x.BuyerPartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_re_sale_contracts_re_units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "re_units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "sales_orders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    QuoteNumber = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Number = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    ValidUntil = table.Column<DateOnly>(type: "date", nullable: true),
                    DeliveryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: true),
                    CustomerReference = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    DeliveryAddress = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    RouteVisitId = table.Column<Guid>(type: "uuid", nullable: true),
                    BlockOverriddenByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    BlockOverrideReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    QuotedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ConfirmedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sales_orders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sales_orders_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_sales_orders_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_sales_orders_route_visits_RouteVisitId",
                        column: x => x.RouteVisitId,
                        principalTable: "route_visits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_sales_orders_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_tabs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    TableId = table.Column<Guid>(type: "uuid", nullable: true),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Covers = table.Column<int>(type: "integer", nullable: false),
                    WaiterUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    WaiterName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    DeliveryAddress = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    DeliveryPhone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    DriverName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    PreBillCount = table.Column<int>(type: "integer", nullable: false),
                    OpenedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_tabs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_tabs_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_tabs_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_tabs_pos_tables_TableId",
                        column: x => x.TableId,
                        principalTable: "pos_tables",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "pos_cash_movements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Reason = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    CounterpartAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_cash_movements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_cash_movements_pos_sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "pos_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_meter_readings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    NozzleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Opening = table.Column<decimal>(type: "numeric(18,3)", nullable: false),
                    Closing = table.Column<decimal>(type: "numeric(18,3)", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_meter_readings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_meter_readings_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_meter_readings_pos_fuel_nozzles_NozzleId",
                        column: x => x.NozzleId,
                        principalTable: "pos_fuel_nozzles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_meter_readings_pos_sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "pos_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "pos_session_tenders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentMethodId = table.Column<Guid>(type: "uuid", nullable: false),
                    Expected = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Counted = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Difference = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    DifferenceReason = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_session_tenders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_session_tenders_pos_sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "pos_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_waiter_settlements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    WaiterUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    WaiterName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Expected = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Handed = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Difference = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Reason = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_waiter_settlements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_waiter_settlements_pos_sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "pos_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_channel_order_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ChannelOrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    LineNo = table.Column<int>(type: "integer", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_channel_order_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_channel_order_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_channel_order_lines_pos_channel_orders_ChannelOrderId",
                        column: x => x.ChannelOrderId,
                        principalTable: "pos_channel_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "re_lease_invoices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Period = table.Column<DateOnly>(type: "date", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_re_lease_invoices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_re_lease_invoices_invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_re_lease_invoices_re_leases_LeaseId",
                        column: x => x.LeaseId,
                        principalTable: "re_leases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "re_lease_meters",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    LastReading = table.Column<decimal>(type: "numeric(18,3)", nullable: false),
                    PendingReading = table.Column<decimal>(type: "numeric(18,3)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_re_lease_meters", x => x.Id);
                    table.ForeignKey(
                        name: "FK_re_lease_meters_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_re_lease_meters_re_leases_LeaseId",
                        column: x => x.LeaseId,
                        principalTable: "re_leases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "re_installments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_re_installments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_re_installments_invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_re_installments_re_sale_contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "re_sale_contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sales_order_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SalesOrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    Description = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitName = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    UnitFactor = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    DiscountPercent = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    TaxDefinitionId = table.Column<Guid>(type: "uuid", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sales_order_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sales_order_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_sales_order_lines_sales_orders_SalesOrderId",
                        column: x => x.SalesOrderId,
                        principalTable: "sales_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_sales_order_lines_tax_definitions_TaxDefinitionId",
                        column: x => x.TaxDefinitionId,
                        principalTable: "tax_definitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_event_bookings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    VenueId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    From = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    To = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: true),
                    CustomerName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    PackageItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    PricePerGuest = table.Column<decimal>(type: "numeric(18,4)", nullable: true),
                    GuestsEstimated = table.Column<int>(type: "integer", nullable: false),
                    GuestsFinal = table.Column<int>(type: "integer", nullable: true),
                    BanquetNotes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    DepositCardId = table.Column<Guid>(type: "uuid", nullable: true),
                    TabId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_event_bookings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_event_bookings_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_event_bookings_items_PackageItemId",
                        column: x => x.PackageItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_event_bookings_partners_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_event_bookings_pos_gift_cards_DepositCardId",
                        column: x => x.DepositCardId,
                        principalTable: "pos_gift_cards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_event_bookings_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_event_bookings_pos_tabs_TabId",
                        column: x => x.TabId,
                        principalTable: "pos_tabs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_event_bookings_pos_venues_VenueId",
                        column: x => x.VenueId,
                        principalTable: "pos_venues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_hotel_bookings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: true),
                    Arrival = table.Column<DateOnly>(type: "date", nullable: false),
                    Departure = table.Column<DateOnly>(type: "date", nullable: false),
                    Adults = table.Column<int>(type: "integer", nullable: false),
                    Children = table.Column<int>(type: "integer", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    GuestName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CompanyPartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Channel = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    NightlyRate = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    DepositCardId = table.Column<Guid>(type: "uuid", nullable: true),
                    FolioTabId = table.Column<Guid>(type: "uuid", nullable: true),
                    PostedThrough = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_hotel_bookings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_hotel_bookings_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_hotel_bookings_partners_CompanyPartnerId",
                        column: x => x.CompanyPartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_hotel_bookings_pos_gift_cards_DepositCardId",
                        column: x => x.DepositCardId,
                        principalTable: "pos_gift_cards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_hotel_bookings_pos_room_types_RoomTypeId",
                        column: x => x.RoomTypeId,
                        principalTable: "pos_room_types",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_hotel_bookings_pos_rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "pos_rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_hotel_bookings_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_hotel_bookings_pos_tabs_FolioTabId",
                        column: x => x.FolioTabId,
                        principalTable: "pos_tabs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_kitchen_tickets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    TabId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductionCenterId = table.Column<Guid>(type: "uuid", nullable: true),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    IsStorno = table.Column<bool>(type: "boolean", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TabLabel = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    WaiterName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReadyAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DoneAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_kitchen_tickets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_kitchen_tickets_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_kitchen_tickets_pos_production_centers_ProductionCenter~",
                        column: x => x.ProductionCenterId,
                        principalTable: "pos_production_centers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_pos_kitchen_tickets_pos_tabs_TabId",
                        column: x => x.TabId,
                        principalTable: "pos_tabs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_orders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientUuid = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    RegisterId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    OrderedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    OperatorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    OperatorName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: true),
                    OriginalOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    Total = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    TotalTax = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    TotalDiscount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    CreatedOffline = table.Column<bool>(type: "boolean", nullable: false),
                    CouponCodes = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    LoyaltyCardId = table.Column<Guid>(type: "uuid", nullable: true),
                    TabId = table.Column<Guid>(type: "uuid", nullable: true),
                    AppointmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    RepairTicketId = table.Column<Guid>(type: "uuid", nullable: true),
                    PrescriptionId = table.Column<Guid>(type: "uuid", nullable: true),
                    FleetCardId = table.Column<Guid>(type: "uuid", nullable: true),
                    ChannelOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    PointsEarned = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    PointsRedeemed = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    ReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_orders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_orders_partners_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_appointments_AppointmentId",
                        column: x => x.AppointmentId,
                        principalTable: "pos_appointments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_channel_orders_ChannelOrderId",
                        column: x => x.ChannelOrderId,
                        principalTable: "pos_channel_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_fleet_cards_FleetCardId",
                        column: x => x.FleetCardId,
                        principalTable: "pos_fleet_cards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_loyalty_cards_LoyaltyCardId",
                        column: x => x.LoyaltyCardId,
                        principalTable: "pos_loyalty_cards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_orders_OriginalOrderId",
                        column: x => x.OriginalOrderId,
                        principalTable: "pos_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_prescriptions_PrescriptionId",
                        column: x => x.PrescriptionId,
                        principalTable: "pos_prescriptions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_repair_tickets_RepairTicketId",
                        column: x => x.RepairTicketId,
                        principalTable: "pos_repair_tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "pos_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_orders_pos_tabs_TabId",
                        column: x => x.TabId,
                        principalTable: "pos_tabs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_tab_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TabId = table.Column<Guid>(type: "uuid", nullable: false),
                    LineNo = table.Column<int>(type: "integer", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Seat = table.Column<int>(type: "integer", nullable: true),
                    Course = table.Column<int>(type: "integer", nullable: false),
                    Note = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Modifiers = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ModifierIds = table.Column<string>(type: "character varying(800)", maxLength: 800, nullable: true),
                    ParentLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    ProductionCenterId = table.Column<Guid>(type: "uuid", nullable: true),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidReason = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    VoidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    PaidQuantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_tab_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_tab_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_tab_lines_pos_tabs_TabId",
                        column: x => x.TabId,
                        principalTable: "pos_tabs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_hotel_guests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BookingId = table.Column<Guid>(type: "uuid", nullable: false),
                    FullName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Nationality = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    DocumentType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    DocumentNumber = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    BirthDate = table.Column<DateOnly>(type: "date", nullable: true),
                    IsPrimary = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_hotel_guests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_hotel_guests_pos_hotel_bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "pos_hotel_bookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_kitchen_ticket_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TicketId = table.Column<Guid>(type: "uuid", nullable: false),
                    TabLineId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    Modifiers = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Note = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Seat = table.Column<int>(type: "integer", nullable: true),
                    Course = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_kitchen_ticket_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_kitchen_ticket_lines_pos_kitchen_tickets_TicketId",
                        column: x => x.TicketId,
                        principalTable: "pos_kitchen_tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "fiscal_documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RegisterId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CouponId = table.Column<long>(type: "bigint", nullable: false),
                    DailyNumber = table.Column<int>(type: "integer", nullable: false),
                    ReferenceCouponId = table.Column<long>(type: "bigint", nullable: true),
                    VerificationNo = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IssuedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PosCouponDetails = table.Column<string>(type: "text", nullable: false),
                    Signature = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    QrCode = table.Column<string>(type: "text", nullable: false),
                    AtkStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AtkTransactionNo = table.Column<decimal>(type: "numeric(20,0)", nullable: true),
                    AtkError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    SendBy = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fiscal_documents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_fiscal_documents_pos_orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "pos_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_fiscal_documents_pos_registers_RegisterId",
                        column: x => x.RegisterId,
                        principalTable: "pos_registers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_customer_orders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StoreId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    DepositCardId = table.Column<Guid>(type: "uuid", nullable: false),
                    CollectedOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_customer_orders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_customer_orders_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_customer_orders_partners_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_customer_orders_pos_gift_cards_DepositCardId",
                        column: x => x.DepositCardId,
                        principalTable: "pos_gift_cards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_customer_orders_pos_orders_CollectedOrderId",
                        column: x => x.CollectedOrderId,
                        principalTable: "pos_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_customer_orders_pos_stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "pos_stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_gift_card_movements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GiftCardId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_gift_card_movements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_gift_card_movements_pos_gift_cards_GiftCardId",
                        column: x => x.GiftCardId,
                        principalTable: "pos_gift_cards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_gift_card_movements_pos_orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "pos_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentMethodId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Tendered = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    Reference = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Tip = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_payments_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_payments_payment_methods_PaymentMethodId",
                        column: x => x.PaymentMethodId,
                        principalTable: "payment_methods",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_payments_pos_orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "pos_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pos_tickets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    UsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_tickets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_tickets_pos_orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "pos_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_tickets_pos_ticketed_events_EventId",
                        column: x => x.EventId,
                        principalTable: "pos_ticketed_events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_order_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    LineNo = table.Column<int>(type: "integer", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    Description = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Unit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitFactor = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    TaxDefinitionId = table.Column<Guid>(type: "uuid", nullable: true),
                    TaxLetter = table.Column<string>(type: "character varying(1)", maxLength: 1, nullable: false),
                    TaxRate = table.Column<decimal>(type: "numeric(9,4)", nullable: false),
                    Gross = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Net = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Tax = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    RevenueAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    LotNumber = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    AgeVerified = table.Column<bool>(type: "boolean", nullable: false),
                    ProgramDiscount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ProgramId = table.Column<Guid>(type: "uuid", nullable: true),
                    GiftCardNumber = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    SerialNumber = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    TabLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    ModifierIds = table.Column<string>(type: "character varying(800)", maxLength: 800, nullable: true),
                    StaffUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    PackageNumber = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    MembershipNumber = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    PrescriptionLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    NozzleId = table.Column<Guid>(type: "uuid", nullable: true),
                    AgencyPartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    AgencyCommission = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    OriginalLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    CostValue = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    CostCorrection = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    CostReplay = table.Column<decimal>(type: "numeric(18,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_order_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_order_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_order_lines_pos_fuel_nozzles_NozzleId",
                        column: x => x.NozzleId,
                        principalTable: "pos_fuel_nozzles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_order_lines_pos_orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "pos_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_pos_order_lines_pos_prescription_lines_PrescriptionLineId",
                        column: x => x.PrescriptionLineId,
                        principalTable: "pos_prescription_lines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_order_lines_pos_tab_lines_TabLineId",
                        column: x => x.TabLineId,
                        principalTable: "pos_tab_lines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "pos_customer_order_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerOrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    LineNo = table.Column<int>(type: "integer", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pos_customer_order_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pos_customer_order_lines_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pos_customer_order_lines_pos_customer_orders_CustomerOrderId",
                        column: x => x.CustomerOrderId,
                        principalTable: "pos_customer_orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_stock_documents_SiteId",
                table: "stock_documents",
                column: "SiteId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_document_lines_CostCodeId",
                table: "stock_document_lines",
                column: "CostCodeId");

            migrationBuilder.CreateIndex(
                name: "IX_stock_document_lines_SalesOrderLineId",
                table: "stock_document_lines",
                column: "SalesOrderLineId");

            migrationBuilder.CreateIndex(
                name: "IX_price_lists_CompanyId_WarehouseId",
                table: "price_lists",
                columns: new[] { "CompanyId", "WarehouseId" },
                unique: true,
                filter: "\"IsCustomerList\" = false")
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_partners_PriceListId",
                table: "partners",
                column: "PriceListId");

            migrationBuilder.CreateIndex(
                name: "IX_items_AgencyPartnerId",
                table: "items",
                column: "AgencyPartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_items_CompanyId_Plu",
                table: "items",
                columns: new[] { "CompanyId", "Plu" },
                unique: true,
                filter: "\"Plu\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_items_DepositItemId",
                table: "items",
                column: "DepositItemId");

            migrationBuilder.CreateIndex(
                name: "IX_items_PackageServiceItemId",
                table: "items",
                column: "PackageServiceItemId");

            migrationBuilder.CreateIndex(
                name: "IX_items_ProductionCenterId",
                table: "items",
                column: "ProductionCenterId");

            migrationBuilder.CreateIndex(
                name: "IX_items_VariantOfItemId",
                table: "items",
                column: "VariantOfItemId");

            migrationBuilder.CreateIndex(
                name: "IX_invoices_ProjectId",
                table: "invoices",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_invoice_lines_DeliveryLineId",
                table: "invoice_lines",
                column: "DeliveryLineId");

            migrationBuilder.CreateIndex(
                name: "IX_invoice_lines_SalesOrderLineId",
                table: "invoice_lines",
                column: "SalesOrderLineId");

            migrationBuilder.CreateIndex(
                name: "IX_bills_ProjectId",
                table: "bills",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_bill_lines_CostCodeId",
                table: "bill_lines",
                column: "CostCodeId");

            migrationBuilder.CreateIndex(
                name: "IX_construction_boq_lines_SiteId_Code",
                table: "construction_boq_lines",
                columns: new[] { "SiteId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_construction_cost_codes_SiteId_Code",
                table: "construction_cost_codes",
                columns: new[] { "SiteId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_construction_progress_bill_lines_BoqLineId",
                table: "construction_progress_bill_lines",
                column: "BoqLineId");

            migrationBuilder.CreateIndex(
                name: "IX_construction_progress_bill_lines_ProgressBillId",
                table: "construction_progress_bill_lines",
                column: "ProgressBillId");

            migrationBuilder.CreateIndex(
                name: "IX_construction_progress_bills_InvoiceId",
                table: "construction_progress_bills",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_construction_progress_bills_SiteId_Number",
                table: "construction_progress_bills",
                columns: new[] { "SiteId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_construction_sites_BillingItemId",
                table: "construction_sites",
                column: "BillingItemId");

            migrationBuilder.CreateIndex(
                name: "IX_construction_sites_ClientPartnerId",
                table: "construction_sites",
                column: "ClientPartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_construction_sites_CompanyId",
                table: "construction_sites",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_construction_sites_ProjectId",
                table: "construction_sites",
                column: "ProjectId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_fiscal_documents_CompanyId_AtkStatus",
                table: "fiscal_documents",
                columns: new[] { "CompanyId", "AtkStatus" });

            migrationBuilder.CreateIndex(
                name: "IX_fiscal_documents_CompanyId_CouponId",
                table: "fiscal_documents",
                columns: new[] { "CompanyId", "CouponId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_fiscal_documents_OrderId",
                table: "fiscal_documents",
                column: "OrderId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_fiscal_documents_RegisterId",
                table: "fiscal_documents",
                column: "RegisterId");

            migrationBuilder.CreateIndex(
                name: "IX_item_attribute_values_AttributeId_Value",
                table: "item_attribute_values",
                columns: new[] { "AttributeId", "Value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_item_attributes_CompanyId_Name",
                table: "item_attributes",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_item_cross_references_ItemId_Brand_Normalized",
                table: "item_cross_references",
                columns: new[] { "ItemId", "Brand", "Normalized" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_item_cross_references_Normalized",
                table: "item_cross_references",
                column: "Normalized");

            migrationBuilder.CreateIndex(
                name: "IX_item_fitments_ItemId",
                table: "item_fitments",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_item_fitments_Make_Model",
                table: "item_fitments",
                columns: new[] { "Make", "Model" });

            migrationBuilder.CreateIndex(
                name: "IX_item_recipe_lines_IngredientItemId",
                table: "item_recipe_lines",
                column: "IngredientItemId");

            migrationBuilder.CreateIndex(
                name: "IX_item_recipe_lines_ItemId",
                table: "item_recipe_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_item_serials_CompanyId_ItemId_Serial",
                table: "item_serials",
                columns: new[] { "CompanyId", "ItemId", "Serial" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_item_serials_CompanyId_Serial",
                table: "item_serials",
                columns: new[] { "CompanyId", "Serial" });

            migrationBuilder.CreateIndex(
                name: "IX_item_serials_ItemId",
                table: "item_serials",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_item_variant_values_AttributeValueId",
                table: "item_variant_values",
                column: "AttributeValueId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_appointments_CompanyId_Number",
                table: "pos_appointments",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_appointments_CustomerId",
                table: "pos_appointments",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_appointments_DepositCardId",
                table: "pos_appointments",
                column: "DepositCardId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_appointments_ItemId",
                table: "pos_appointments",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_appointments_ResourceId_Start",
                table: "pos_appointments",
                columns: new[] { "ResourceId", "Start" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_appointments_StoreId",
                table: "pos_appointments",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_barcode_rules_CompanyId_Prefix",
                table: "pos_barcode_rules",
                columns: new[] { "CompanyId", "Prefix" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_cash_movements_SessionId",
                table: "pos_cash_movements",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_channel_order_lines_ChannelOrderId",
                table: "pos_channel_order_lines",
                column: "ChannelOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_channel_order_lines_ItemId",
                table: "pos_channel_order_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_channel_orders_ChannelId_ExternalRef",
                table: "pos_channel_orders",
                columns: new[] { "ChannelId", "ExternalRef" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_channel_orders_CompanyId_State",
                table: "pos_channel_orders",
                columns: new[] { "CompanyId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_channel_orders_CourierPartnerId",
                table: "pos_channel_orders",
                column: "CourierPartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_combo_choices_ItemId",
                table: "pos_combo_choices",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_combo_choices_SlotId",
                table: "pos_combo_choices",
                column: "SlotId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_combo_slots_ComboItemId",
                table: "pos_combo_slots",
                column: "ComboItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_customer_order_lines_CustomerOrderId",
                table: "pos_customer_order_lines",
                column: "CustomerOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_customer_order_lines_ItemId",
                table: "pos_customer_order_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_customer_orders_CollectedOrderId",
                table: "pos_customer_orders",
                column: "CollectedOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_customer_orders_CompanyId_Number",
                table: "pos_customer_orders",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_customer_orders_CustomerId",
                table: "pos_customer_orders",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_customer_orders_DepositCardId",
                table: "pos_customer_orders",
                column: "DepositCardId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_customer_orders_StoreId",
                table: "pos_customer_orders",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_bookings_CompanyId_Number",
                table: "pos_event_bookings",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_bookings_CustomerId",
                table: "pos_event_bookings",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_bookings_DepositCardId",
                table: "pos_event_bookings",
                column: "DepositCardId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_bookings_PackageItemId",
                table: "pos_event_bookings",
                column: "PackageItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_bookings_StoreId",
                table: "pos_event_bookings",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_bookings_TabId",
                table: "pos_event_bookings",
                column: "TabId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_bookings_VenueId_Date",
                table: "pos_event_bookings",
                columns: new[] { "VenueId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_ticket_types_EventId_ItemId",
                table: "pos_event_ticket_types",
                columns: new[] { "EventId", "ItemId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_event_ticket_types_ItemId",
                table: "pos_event_ticket_types",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_fleet_cards_CompanyId_Number",
                table: "pos_fleet_cards",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_fleet_cards_PartnerId",
                table: "pos_fleet_cards",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_floors_CompanyId",
                table: "pos_floors",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_floors_StoreId",
                table: "pos_floors",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_fuel_nozzles_CompanyId",
                table: "pos_fuel_nozzles",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_fuel_nozzles_StoreId_Pump_Number",
                table: "pos_fuel_nozzles",
                columns: new[] { "StoreId", "Pump", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_fuel_nozzles_TankId",
                table: "pos_fuel_nozzles",
                column: "TankId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_fuel_tanks_CompanyId",
                table: "pos_fuel_tanks",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_fuel_tanks_ItemId",
                table: "pos_fuel_tanks",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_fuel_tanks_StoreId_Name",
                table: "pos_fuel_tanks",
                columns: new[] { "StoreId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_gift_card_movements_GiftCardId",
                table: "pos_gift_card_movements",
                column: "GiftCardId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_gift_card_movements_OrderId",
                table: "pos_gift_card_movements",
                column: "OrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_gift_cards_CompanyId_Number",
                table: "pos_gift_cards",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_gift_cards_PartnerId",
                table: "pos_gift_cards",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_hotel_bookings_CompanyId_Number",
                table: "pos_hotel_bookings",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_hotel_bookings_CompanyPartnerId",
                table: "pos_hotel_bookings",
                column: "CompanyPartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_hotel_bookings_DepositCardId",
                table: "pos_hotel_bookings",
                column: "DepositCardId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_hotel_bookings_FolioTabId",
                table: "pos_hotel_bookings",
                column: "FolioTabId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_hotel_bookings_RoomId",
                table: "pos_hotel_bookings",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_hotel_bookings_RoomTypeId_Arrival",
                table: "pos_hotel_bookings",
                columns: new[] { "RoomTypeId", "Arrival" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_hotel_bookings_StoreId",
                table: "pos_hotel_bookings",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_hotel_guests_BookingId",
                table: "pos_hotel_guests",
                column: "BookingId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_item_modifier_groups_GroupId",
                table: "pos_item_modifier_groups",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_kitchen_ticket_lines_TicketId",
                table: "pos_kitchen_ticket_lines",
                column: "TicketId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_kitchen_tickets_CompanyId",
                table: "pos_kitchen_tickets",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_kitchen_tickets_ProductionCenterId",
                table: "pos_kitchen_tickets",
                column: "ProductionCenterId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_kitchen_tickets_StoreId_State",
                table: "pos_kitchen_tickets",
                columns: new[] { "StoreId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_kitchen_tickets_TabId",
                table: "pos_kitchen_tickets",
                column: "TabId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_loyalty_cards_CompanyId_Number",
                table: "pos_loyalty_cards",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_loyalty_cards_PartnerId",
                table: "pos_loyalty_cards",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_memberships_CompanyId_Number",
                table: "pos_memberships",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_memberships_CustomerId",
                table: "pos_memberships",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_memberships_PlanItemId",
                table: "pos_memberships",
                column: "PlanItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_meter_readings_CompanyId",
                table: "pos_meter_readings",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_meter_readings_NozzleId_Date",
                table: "pos_meter_readings",
                columns: new[] { "NozzleId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_meter_readings_SessionId",
                table: "pos_meter_readings",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_modifier_groups_CompanyId",
                table: "pos_modifier_groups",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_modifiers_GroupId",
                table: "pos_modifiers",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_modifiers_IngredientItemId",
                table: "pos_modifiers",
                column: "IngredientItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_order_lines_ItemId",
                table: "pos_order_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_order_lines_NozzleId",
                table: "pos_order_lines",
                column: "NozzleId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_order_lines_OrderId",
                table: "pos_order_lines",
                column: "OrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_order_lines_PrescriptionLineId",
                table: "pos_order_lines",
                column: "PrescriptionLineId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_order_lines_TabLineId",
                table: "pos_order_lines",
                column: "TabLineId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_AppointmentId",
                table: "pos_orders",
                column: "AppointmentId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_ChannelOrderId",
                table: "pos_orders",
                column: "ChannelOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_CompanyId_ClientUuid",
                table: "pos_orders",
                columns: new[] { "CompanyId", "ClientUuid" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_CompanyId_OrderedAt",
                table: "pos_orders",
                columns: new[] { "CompanyId", "OrderedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_CustomerId",
                table: "pos_orders",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_FleetCardId",
                table: "pos_orders",
                column: "FleetCardId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_LoyaltyCardId",
                table: "pos_orders",
                column: "LoyaltyCardId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_OriginalOrderId",
                table: "pos_orders",
                column: "OriginalOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_PrescriptionId",
                table: "pos_orders",
                column: "PrescriptionId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_RepairTicketId",
                table: "pos_orders",
                column: "RepairTicketId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_SessionId_Kind",
                table: "pos_orders",
                columns: new[] { "SessionId", "Kind" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_orders_TabId",
                table: "pos_orders",
                column: "TabId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_packages_CompanyId_Number",
                table: "pos_packages",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_packages_CustomerId",
                table: "pos_packages",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_packages_ServiceItemId",
                table: "pos_packages",
                column: "ServiceItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_payers_CompanyId_Name",
                table: "pos_payers",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_payers_PartnerId",
                table: "pos_payers",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_payments_OrderId",
                table: "pos_payments",
                column: "OrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_payments_PartnerId",
                table: "pos_payments",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_payments_PaymentMethodId",
                table: "pos_payments",
                column: "PaymentMethodId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_pins_CompanyId_UserId",
                table: "pos_pins",
                columns: new[] { "CompanyId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_prescription_lines_ItemId",
                table: "pos_prescription_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_prescription_lines_PrescriptionId",
                table: "pos_prescription_lines",
                column: "PrescriptionId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_prescriptions_CompanyId_Number",
                table: "pos_prescriptions",
                columns: new[] { "CompanyId", "Number" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_prescriptions_PayerId",
                table: "pos_prescriptions",
                column: "PayerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_prescriptions_StoreId",
                table: "pos_prescriptions",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_production_centers_CompanyId",
                table: "pos_production_centers",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_production_centers_StoreId",
                table: "pos_production_centers",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_program_targets_CategoryId",
                table: "pos_program_targets",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_program_targets_ItemId",
                table: "pos_program_targets",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_program_targets_ProgramId",
                table: "pos_program_targets",
                column: "ProgramId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_programs_CompanyId_Code",
                table: "pos_programs",
                columns: new[] { "CompanyId", "Code" },
                unique: true,
                filter: "\"Code\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_pos_programs_StoreId",
                table: "pos_programs",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_registers_CompanyId_Code",
                table: "pos_registers",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_registers_StoreId_FiscalPosNumber",
                table: "pos_registers",
                columns: new[] { "StoreId", "FiscalPosNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_repair_ticket_lines_ItemId",
                table: "pos_repair_ticket_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_repair_ticket_lines_TicketId",
                table: "pos_repair_ticket_lines",
                column: "TicketId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_repair_tickets_CompanyId_Number",
                table: "pos_repair_tickets",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_repair_tickets_CustomerId",
                table: "pos_repair_tickets",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_repair_tickets_StoreId",
                table: "pos_repair_tickets",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_resource_hours_ResourceId",
                table: "pos_resource_hours",
                column: "ResourceId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_resources_CompanyId",
                table: "pos_resources",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_resources_StoreId",
                table: "pos_resources",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_room_types_CompanyId",
                table: "pos_room_types",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_room_types_RateItemId",
                table: "pos_room_types",
                column: "RateItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_room_types_StoreId",
                table: "pos_room_types",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_rooms_RoomTypeId_Number",
                table: "pos_rooms",
                columns: new[] { "RoomTypeId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_sales_channels_CompanyId",
                table: "pos_sales_channels",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_sales_channels_StoreId",
                table: "pos_sales_channels",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_sales_channels_Token",
                table: "pos_sales_channels",
                column: "Token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_service_resources_ResourceId",
                table: "pos_service_resources",
                column: "ResourceId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_session_tenders_SessionId_PaymentMethodId",
                table: "pos_session_tenders",
                columns: new[] { "SessionId", "PaymentMethodId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_sessions_CompanyId",
                table: "pos_sessions",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_sessions_one_open",
                table: "pos_sessions",
                column: "RegisterId",
                unique: true,
                filter: "\"State\" = 'Open'");

            migrationBuilder.CreateIndex(
                name: "IX_pos_sessions_RegisterId_Number",
                table: "pos_sessions",
                columns: new[] { "RegisterId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_stores_BookingToken",
                table: "pos_stores",
                column: "BookingToken",
                unique: true,
                filter: "\"BookingToken\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_pos_stores_CompanyId_Code",
                table: "pos_stores",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_stores_CompanyId_FiscalBranchNumber",
                table: "pos_stores",
                columns: new[] { "CompanyId", "FiscalBranchNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_stores_PriceListId",
                table: "pos_stores",
                column: "PriceListId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_stores_TipsAccountId",
                table: "pos_stores",
                column: "TipsAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_stores_TouristTaxItemId",
                table: "pos_stores",
                column: "TouristTaxItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_stores_WarehouseId",
                table: "pos_stores",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_tab_lines_ItemId",
                table: "pos_tab_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_tab_lines_TabId",
                table: "pos_tab_lines",
                column: "TabId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_tables_FloorId",
                table: "pos_tables",
                column: "FloorId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_tables_QrToken",
                table: "pos_tables",
                column: "QrToken",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_tabs_CompanyId_Number",
                table: "pos_tabs",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_tabs_StoreId_State",
                table: "pos_tabs",
                columns: new[] { "StoreId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_tabs_TableId",
                table: "pos_tabs",
                column: "TableId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_tank_dips_CompanyId",
                table: "pos_tank_dips",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_tank_dips_TankId_MeasuredAt",
                table: "pos_tank_dips",
                columns: new[] { "TankId", "MeasuredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_ticketed_events_CompanyId",
                table: "pos_ticketed_events",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_ticketed_events_StoreId",
                table: "pos_ticketed_events",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_tickets_Code",
                table: "pos_tickets",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pos_tickets_EventId_State",
                table: "pos_tickets",
                columns: new[] { "EventId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_pos_tickets_OrderId",
                table: "pos_tickets",
                column: "OrderId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_venues_CompanyId",
                table: "pos_venues",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_venues_StoreId",
                table: "pos_venues",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_pos_waiter_settlements_SessionId_WaiterUserId",
                table: "pos_waiter_settlements",
                columns: new[] { "SessionId", "WaiterUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_re_buildings_CompanyId_Name",
                table: "re_buildings",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_re_buildings_ProjectId",
                table: "re_buildings",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_re_buildings_SaleItemId",
                table: "re_buildings",
                column: "SaleItemId");

            migrationBuilder.CreateIndex(
                name: "IX_re_installments_ContractId_Number",
                table: "re_installments",
                columns: new[] { "ContractId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_re_installments_InvoiceId",
                table: "re_installments",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_re_lease_invoices_InvoiceId",
                table: "re_lease_invoices",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_re_lease_invoices_LeaseId_Period",
                table: "re_lease_invoices",
                columns: new[] { "LeaseId", "Period" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_re_lease_meters_ItemId",
                table: "re_lease_meters",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_re_lease_meters_LeaseId",
                table: "re_lease_meters",
                column: "LeaseId");

            migrationBuilder.CreateIndex(
                name: "IX_re_leases_CompanyId_Number",
                table: "re_leases",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_re_leases_RentItemId",
                table: "re_leases",
                column: "RentItemId");

            migrationBuilder.CreateIndex(
                name: "IX_re_leases_TenantPartnerId",
                table: "re_leases",
                column: "TenantPartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_re_leases_UnitId",
                table: "re_leases",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_re_reservations_PartnerId",
                table: "re_reservations",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_re_reservations_UnitId",
                table: "re_reservations",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_re_sale_contracts_BuyerPartnerId",
                table: "re_sale_contracts",
                column: "BuyerPartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_re_sale_contracts_CompanyId_Number",
                table: "re_sale_contracts",
                columns: new[] { "CompanyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_re_sale_contracts_UnitId",
                table: "re_sale_contracts",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_re_units_BuildingId_Number",
                table: "re_units",
                columns: new[] { "BuildingId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_route_visits_CompanyId_Date_UserId",
                table: "route_visits",
                columns: new[] { "CompanyId", "Date", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_route_visits_PartnerId",
                table: "route_visits",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_route_visits_RouteId",
                table: "route_visits",
                column: "RouteId");

            migrationBuilder.CreateIndex(
                name: "IX_sales_order_lines_ItemId",
                table: "sales_order_lines",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_sales_order_lines_SalesOrderId",
                table: "sales_order_lines",
                column: "SalesOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_sales_order_lines_TaxDefinitionId",
                table: "sales_order_lines",
                column: "TaxDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_sales_orders_CompanyId_Number",
                table: "sales_orders",
                columns: new[] { "CompanyId", "Number" },
                unique: true,
                filter: "\"Number\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_sales_orders_CompanyId_QuoteNumber",
                table: "sales_orders",
                columns: new[] { "CompanyId", "QuoteNumber" },
                unique: true,
                filter: "\"QuoteNumber\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_sales_orders_CompanyId_State_Date",
                table: "sales_orders",
                columns: new[] { "CompanyId", "State", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_sales_orders_PartnerId",
                table: "sales_orders",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_sales_orders_RouteVisitId",
                table: "sales_orders",
                column: "RouteVisitId");

            migrationBuilder.CreateIndex(
                name: "IX_sales_orders_WarehouseId",
                table: "sales_orders",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_sales_route_stops_PartnerId",
                table: "sales_route_stops",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_sales_route_stops_RouteId_PartnerId",
                table: "sales_route_stops",
                columns: new[] { "RouteId", "PartnerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sales_routes_CompanyId_Name",
                table: "sales_routes",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sales_routes_WarehouseId",
                table: "sales_routes",
                column: "WarehouseId");

            migrationBuilder.AddForeignKey(
                name: "FK_bill_lines_construction_cost_codes_CostCodeId",
                table: "bill_lines",
                column: "CostCodeId",
                principalTable: "construction_cost_codes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_bills_projects_ProjectId",
                table: "bills",
                column: "ProjectId",
                principalTable: "projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_invoice_lines_sales_order_lines_SalesOrderLineId",
                table: "invoice_lines",
                column: "SalesOrderLineId",
                principalTable: "sales_order_lines",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_invoice_lines_stock_document_lines_DeliveryLineId",
                table: "invoice_lines",
                column: "DeliveryLineId",
                principalTable: "stock_document_lines",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_invoices_projects_ProjectId",
                table: "invoices",
                column: "ProjectId",
                principalTable: "projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_items_items_DepositItemId",
                table: "items",
                column: "DepositItemId",
                principalTable: "items",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_items_items_PackageServiceItemId",
                table: "items",
                column: "PackageServiceItemId",
                principalTable: "items",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_items_items_VariantOfItemId",
                table: "items",
                column: "VariantOfItemId",
                principalTable: "items",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_items_partners_AgencyPartnerId",
                table: "items",
                column: "AgencyPartnerId",
                principalTable: "partners",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_items_pos_production_centers_ProductionCenterId",
                table: "items",
                column: "ProductionCenterId",
                principalTable: "pos_production_centers",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_partners_price_lists_PriceListId",
                table: "partners",
                column: "PriceListId",
                principalTable: "price_lists",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_stock_document_lines_construction_cost_codes_CostCodeId",
                table: "stock_document_lines",
                column: "CostCodeId",
                principalTable: "construction_cost_codes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_stock_document_lines_sales_order_lines_SalesOrderLineId",
                table: "stock_document_lines",
                column: "SalesOrderLineId",
                principalTable: "sales_order_lines",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_stock_documents_construction_sites_SiteId",
                table: "stock_documents",
                column: "SiteId",
                principalTable: "construction_sites",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // docs/POS_PLAN.md D14: built-in roles get their POS level; companies that have the
            // built-in roles get the new Cashier role; the POS module is on for every company (its
            // menus show only to roles that hold the area); and a card tender is added where the
            // acquirer clearing account (103200) exists.
            migrationBuilder.Sql("""
                UPDATE company_roles SET "PosAccess" = 'Approve' WHERE "BuiltInKey" = 'accountant';
                UPDATE company_roles SET "PosAccess" = 'Write' WHERE "BuiltInKey" = 'sales';
                UPDATE company_roles SET "PosAccess" = 'Read' WHERE "BuiltInKey" = 'readonly';
                INSERT INTO company_roles ("Id", "CompanyId", "Name", "Description", "BuiltInKey", "SalesAccess", "PurchasesAccess", "PartnersAccess",
                    "ItemsAccess", "AccountingAccess", "ReportsAccess", "HrAccess", "PayrollAccess", "InventoryAccess", "SettingsAccess", "UsersAccess",
                    "PosAccess", "PartnerScope", "CreatedAt")
                SELECT gen_random_uuid(), c."CompanyId", 'Arkëtar',
                    'Shet në arkë dhe menaxhon paratë e turnit; anulimet dhe kthimet i miraton menaxheri.', 'cashier',
                    'None', 'None', 'Read', 'Read', 'None', 'None', 'None', 'None', 'None', 'None', 'None', 'Write', 'All', now()
                FROM (SELECT DISTINCT "CompanyId" FROM company_roles WHERE "BuiltInKey" IS NOT NULL) c
                WHERE NOT EXISTS (SELECT 1 FROM company_roles r WHERE r."CompanyId" = c."CompanyId" AND (r."BuiltInKey" = 'cashier' OR r."Name" = 'Arkëtar'));
                UPDATE companies SET "EnabledModules" = "EnabledModules" | 128;
                INSERT INTO payment_methods ("Id", "CompanyId", "Name", "Kind", "LedgerAccountId")
                SELECT gen_random_uuid(), a."CompanyId", 'Kartelë — POS', 2, a."Id"
                FROM accounts a
                WHERE a."Code" = '103200'
                  AND NOT EXISTS (SELECT 1 FROM payment_methods m WHERE m."CompanyId" = a."CompanyId" AND m."Kind" = 2);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_bill_lines_construction_cost_codes_CostCodeId",
                table: "bill_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_bills_projects_ProjectId",
                table: "bills");

            migrationBuilder.DropForeignKey(
                name: "FK_invoice_lines_sales_order_lines_SalesOrderLineId",
                table: "invoice_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_invoice_lines_stock_document_lines_DeliveryLineId",
                table: "invoice_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_invoices_projects_ProjectId",
                table: "invoices");

            migrationBuilder.DropForeignKey(
                name: "FK_items_items_DepositItemId",
                table: "items");

            migrationBuilder.DropForeignKey(
                name: "FK_items_items_PackageServiceItemId",
                table: "items");

            migrationBuilder.DropForeignKey(
                name: "FK_items_items_VariantOfItemId",
                table: "items");

            migrationBuilder.DropForeignKey(
                name: "FK_items_partners_AgencyPartnerId",
                table: "items");

            migrationBuilder.DropForeignKey(
                name: "FK_items_pos_production_centers_ProductionCenterId",
                table: "items");

            migrationBuilder.DropForeignKey(
                name: "FK_partners_price_lists_PriceListId",
                table: "partners");

            migrationBuilder.DropForeignKey(
                name: "FK_stock_document_lines_construction_cost_codes_CostCodeId",
                table: "stock_document_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_stock_document_lines_sales_order_lines_SalesOrderLineId",
                table: "stock_document_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_stock_documents_construction_sites_SiteId",
                table: "stock_documents");

            migrationBuilder.DropTable(
                name: "construction_cost_codes");

            migrationBuilder.DropTable(
                name: "construction_progress_bill_lines");

            migrationBuilder.DropTable(
                name: "fiscal_documents");

            migrationBuilder.DropTable(
                name: "item_cross_references");

            migrationBuilder.DropTable(
                name: "item_fitments");

            migrationBuilder.DropTable(
                name: "item_recipe_lines");

            migrationBuilder.DropTable(
                name: "item_serials");

            migrationBuilder.DropTable(
                name: "item_variant_values");

            migrationBuilder.DropTable(
                name: "pos_barcode_rules");

            migrationBuilder.DropTable(
                name: "pos_cash_movements");

            migrationBuilder.DropTable(
                name: "pos_channel_order_lines");

            migrationBuilder.DropTable(
                name: "pos_combo_choices");

            migrationBuilder.DropTable(
                name: "pos_customer_order_lines");

            migrationBuilder.DropTable(
                name: "pos_event_bookings");

            migrationBuilder.DropTable(
                name: "pos_event_ticket_types");

            migrationBuilder.DropTable(
                name: "pos_gift_card_movements");

            migrationBuilder.DropTable(
                name: "pos_hotel_guests");

            migrationBuilder.DropTable(
                name: "pos_item_modifier_groups");

            migrationBuilder.DropTable(
                name: "pos_kitchen_ticket_lines");

            migrationBuilder.DropTable(
                name: "pos_memberships");

            migrationBuilder.DropTable(
                name: "pos_meter_readings");

            migrationBuilder.DropTable(
                name: "pos_modifiers");

            migrationBuilder.DropTable(
                name: "pos_order_lines");

            migrationBuilder.DropTable(
                name: "pos_packages");

            migrationBuilder.DropTable(
                name: "pos_payments");

            migrationBuilder.DropTable(
                name: "pos_pins");

            migrationBuilder.DropTable(
                name: "pos_program_targets");

            migrationBuilder.DropTable(
                name: "pos_repair_ticket_lines");

            migrationBuilder.DropTable(
                name: "pos_resource_hours");

            migrationBuilder.DropTable(
                name: "pos_service_resources");

            migrationBuilder.DropTable(
                name: "pos_session_tenders");

            migrationBuilder.DropTable(
                name: "pos_tank_dips");

            migrationBuilder.DropTable(
                name: "pos_tickets");

            migrationBuilder.DropTable(
                name: "pos_waiter_settlements");

            migrationBuilder.DropTable(
                name: "re_installments");

            migrationBuilder.DropTable(
                name: "re_lease_invoices");

            migrationBuilder.DropTable(
                name: "re_lease_meters");

            migrationBuilder.DropTable(
                name: "re_reservations");

            migrationBuilder.DropTable(
                name: "sales_order_lines");

            migrationBuilder.DropTable(
                name: "sales_route_stops");

            migrationBuilder.DropTable(
                name: "construction_boq_lines");

            migrationBuilder.DropTable(
                name: "construction_progress_bills");

            migrationBuilder.DropTable(
                name: "item_attribute_values");

            migrationBuilder.DropTable(
                name: "pos_combo_slots");

            migrationBuilder.DropTable(
                name: "pos_customer_orders");

            migrationBuilder.DropTable(
                name: "pos_venues");

            migrationBuilder.DropTable(
                name: "pos_hotel_bookings");

            migrationBuilder.DropTable(
                name: "pos_kitchen_tickets");

            migrationBuilder.DropTable(
                name: "pos_modifier_groups");

            migrationBuilder.DropTable(
                name: "pos_fuel_nozzles");

            migrationBuilder.DropTable(
                name: "pos_prescription_lines");

            migrationBuilder.DropTable(
                name: "pos_tab_lines");

            migrationBuilder.DropTable(
                name: "pos_programs");

            migrationBuilder.DropTable(
                name: "pos_ticketed_events");

            migrationBuilder.DropTable(
                name: "re_sale_contracts");

            migrationBuilder.DropTable(
                name: "re_leases");

            migrationBuilder.DropTable(
                name: "sales_orders");

            migrationBuilder.DropTable(
                name: "construction_sites");

            migrationBuilder.DropTable(
                name: "item_attributes");

            migrationBuilder.DropTable(
                name: "pos_orders");

            migrationBuilder.DropTable(
                name: "pos_rooms");

            migrationBuilder.DropTable(
                name: "pos_production_centers");

            migrationBuilder.DropTable(
                name: "pos_fuel_tanks");

            migrationBuilder.DropTable(
                name: "re_units");

            migrationBuilder.DropTable(
                name: "route_visits");

            migrationBuilder.DropTable(
                name: "pos_appointments");

            migrationBuilder.DropTable(
                name: "pos_channel_orders");

            migrationBuilder.DropTable(
                name: "pos_fleet_cards");

            migrationBuilder.DropTable(
                name: "pos_loyalty_cards");

            migrationBuilder.DropTable(
                name: "pos_prescriptions");

            migrationBuilder.DropTable(
                name: "pos_repair_tickets");

            migrationBuilder.DropTable(
                name: "pos_sessions");

            migrationBuilder.DropTable(
                name: "pos_tabs");

            migrationBuilder.DropTable(
                name: "pos_room_types");

            migrationBuilder.DropTable(
                name: "re_buildings");

            migrationBuilder.DropTable(
                name: "sales_routes");

            migrationBuilder.DropTable(
                name: "pos_gift_cards");

            migrationBuilder.DropTable(
                name: "pos_resources");

            migrationBuilder.DropTable(
                name: "pos_sales_channels");

            migrationBuilder.DropTable(
                name: "pos_payers");

            migrationBuilder.DropTable(
                name: "pos_registers");

            migrationBuilder.DropTable(
                name: "pos_tables");

            migrationBuilder.DropTable(
                name: "pos_floors");

            migrationBuilder.DropTable(
                name: "pos_stores");

            migrationBuilder.DropIndex(
                name: "IX_stock_documents_SiteId",
                table: "stock_documents");

            migrationBuilder.DropIndex(
                name: "IX_stock_document_lines_CostCodeId",
                table: "stock_document_lines");

            migrationBuilder.DropIndex(
                name: "IX_stock_document_lines_SalesOrderLineId",
                table: "stock_document_lines");

            migrationBuilder.DropIndex(
                name: "IX_price_lists_CompanyId_WarehouseId",
                table: "price_lists");

            migrationBuilder.DropIndex(
                name: "IX_partners_PriceListId",
                table: "partners");

            migrationBuilder.DropIndex(
                name: "IX_items_AgencyPartnerId",
                table: "items");

            migrationBuilder.DropIndex(
                name: "IX_items_CompanyId_Plu",
                table: "items");

            migrationBuilder.DropIndex(
                name: "IX_items_DepositItemId",
                table: "items");

            migrationBuilder.DropIndex(
                name: "IX_items_PackageServiceItemId",
                table: "items");

            migrationBuilder.DropIndex(
                name: "IX_items_ProductionCenterId",
                table: "items");

            migrationBuilder.DropIndex(
                name: "IX_items_VariantOfItemId",
                table: "items");

            migrationBuilder.DropIndex(
                name: "IX_invoices_ProjectId",
                table: "invoices");

            migrationBuilder.DropIndex(
                name: "IX_invoice_lines_DeliveryLineId",
                table: "invoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_invoice_lines_SalesOrderLineId",
                table: "invoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_bills_ProjectId",
                table: "bills");

            migrationBuilder.DropIndex(
                name: "IX_bill_lines_CostCodeId",
                table: "bill_lines");

            migrationBuilder.DropColumn(
                name: "DriverUserId",
                table: "warehouses");

            migrationBuilder.DropColumn(
                name: "IsVan",
                table: "warehouses");

            migrationBuilder.DropColumn(
                name: "SiteId",
                table: "stock_documents");

            migrationBuilder.DropColumn(
                name: "CostCodeId",
                table: "stock_document_lines");

            migrationBuilder.DropColumn(
                name: "SalesOrderLineId",
                table: "stock_document_lines");

            migrationBuilder.DropColumn(
                name: "IsCustomerList",
                table: "price_lists");

            migrationBuilder.DropColumn(
                name: "MinQuantity",
                table: "price_list_prices");

            migrationBuilder.DropColumn(
                name: "MinQuantity",
                table: "price_change_lines");

            migrationBuilder.DropColumn(
                name: "OverdueBlockDays",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "PriceListId",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "ActiveIngredient",
                table: "items");

            migrationBuilder.DropColumn(
                name: "AgencyCommissionPercent",
                table: "items");

            migrationBuilder.DropColumn(
                name: "AgencyPartnerId",
                table: "items");

            migrationBuilder.DropColumn(
                name: "AtcCode",
                table: "items");

            migrationBuilder.DropColumn(
                name: "BufferMinutes",
                table: "items");

            migrationBuilder.DropColumn(
                name: "DepositItemId",
                table: "items");

            migrationBuilder.DropColumn(
                name: "DurationMinutes",
                table: "items");

            migrationBuilder.DropColumn(
                name: "IsBookable",
                table: "items");

            migrationBuilder.DropColumn(
                name: "IsControlled",
                table: "items");

            migrationBuilder.DropColumn(
                name: "IsPrescriptionOnly",
                table: "items");

            migrationBuilder.DropColumn(
                name: "IsVariantTemplate",
                table: "items");

            migrationBuilder.DropColumn(
                name: "MaxRetailPrice",
                table: "items");

            migrationBuilder.DropColumn(
                name: "MembershipDays",
                table: "items");

            migrationBuilder.DropColumn(
                name: "MinimumAge",
                table: "items");

            migrationBuilder.DropColumn(
                name: "OpenPrice",
                table: "items");

            migrationBuilder.DropColumn(
                name: "PackageServiceItemId",
                table: "items");

            migrationBuilder.DropColumn(
                name: "PackageSessions",
                table: "items");

            migrationBuilder.DropColumn(
                name: "PackageValidDays",
                table: "items");

            migrationBuilder.DropColumn(
                name: "Plu",
                table: "items");

            migrationBuilder.DropColumn(
                name: "ProductionCenterId",
                table: "items");

            migrationBuilder.DropColumn(
                name: "SellByWeight",
                table: "items");

            migrationBuilder.DropColumn(
                name: "TrackSerials",
                table: "items");

            migrationBuilder.DropColumn(
                name: "VariantOfItemId",
                table: "items");

            migrationBuilder.DropColumn(
                name: "WarrantyMonths",
                table: "items");

            migrationBuilder.DropColumn(
                name: "ProjectId",
                table: "invoices");

            migrationBuilder.DropColumn(
                name: "DeliveryLineId",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "SalesOrderLineId",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "PosAccess",
                table: "company_roles");

            migrationBuilder.DropColumn(
                name: "ProjectId",
                table: "bills");

            migrationBuilder.DropColumn(
                name: "CostCodeId",
                table: "bill_lines");

            migrationBuilder.CreateIndex(
                name: "IX_price_lists_CompanyId_WarehouseId",
                table: "price_lists",
                columns: new[] { "CompanyId", "WarehouseId" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);
        }
    }
}
