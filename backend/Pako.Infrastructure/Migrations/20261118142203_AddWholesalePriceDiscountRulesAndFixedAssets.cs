using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddWholesalePriceDiscountRulesAndFixedAssets : Migration
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
                name: "asset_categories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AssetAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsDepreciable = table.Column<bool>(type: "boolean", nullable: false),
                    AccumulatedDepreciationAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    DepreciationExpenseAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    DefaultUsefulLifeMonths = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_asset_categories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_asset_categories_accounts_AccumulatedDepreciationAccountId",
                        column: x => x.AccumulatedDepreciationAccountId,
                        principalTable: "accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_asset_categories_accounts_AssetAccountId",
                        column: x => x.AssetAccountId,
                        principalTable: "accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_asset_categories_accounts_DepreciationExpenseAccountId",
                        column: x => x.DepreciationExpenseAccountId,
                        principalTable: "accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_asset_categories_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "depreciation_runs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Period = table.Column<DateOnly>(type: "date", nullable: false),
                    State = table.Column<int>(type: "integer", nullable: false),
                    Total = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    JournalEntryId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReversalJournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    PostedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    PostedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_depreciation_runs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_depreciation_runs_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_depreciation_runs_journal_entries_JournalEntryId",
                        column: x => x.JournalEntryId,
                        principalTable: "journal_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_depreciation_runs_journal_entries_ReversalJournalEntryId",
                        column: x => x.ReversalJournalEntryId,
                        principalTable: "journal_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

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

            migrationBuilder.CreateTable(
                name: "fixed_assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    AcquisitionDate = table.Column<DateOnly>(type: "date", nullable: false),
                    InServiceDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Cost = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ResidualValue = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    UsefulLifeMonths = table.Column<int>(type: "integer", nullable: false),
                    OpeningAccumulatedDepreciation = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    SerialNumber = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Location = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    DisposedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    DisposalProceeds = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    DisposalJournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fixed_assets", x => x.Id);
                    table.CheckConstraint("CK_fixed_assets_amounts", "\"Cost\" > 0 AND \"ResidualValue\" >= 0 AND \"ResidualValue\" <= \"Cost\" AND \"OpeningAccumulatedDepreciation\" >= 0 AND \"UsefulLifeMonths\" >= 0");
                    table.ForeignKey(
                        name: "FK_fixed_assets_asset_categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "asset_categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_fixed_assets_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_fixed_assets_journal_entries_DisposalJournalEntryId",
                        column: x => x.DisposalJournalEntryId,
                        principalTable: "journal_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "depreciation_run_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DepreciationRunId = table.Column<Guid>(type: "uuid", nullable: false),
                    FixedAssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_depreciation_run_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_depreciation_run_lines_depreciation_runs_DepreciationRunId",
                        column: x => x.DepreciationRunId,
                        principalTable: "depreciation_runs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_depreciation_run_lines_fixed_assets_FixedAssetId",
                        column: x => x.FixedAssetId,
                        principalTable: "fixed_assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_asset_categories_AccumulatedDepreciationAccountId",
                table: "asset_categories",
                column: "AccumulatedDepreciationAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_asset_categories_AssetAccountId",
                table: "asset_categories",
                column: "AssetAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_asset_categories_CompanyId_Name",
                table: "asset_categories",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_asset_categories_DepreciationExpenseAccountId",
                table: "asset_categories",
                column: "DepreciationExpenseAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_depreciation_run_lines_DepreciationRunId",
                table: "depreciation_run_lines",
                column: "DepreciationRunId");

            migrationBuilder.CreateIndex(
                name: "IX_depreciation_run_lines_FixedAssetId",
                table: "depreciation_run_lines",
                column: "FixedAssetId");

            migrationBuilder.CreateIndex(
                name: "IX_depreciation_runs_CompanyId_Period",
                table: "depreciation_runs",
                columns: new[] { "CompanyId", "Period" },
                unique: true,
                filter: "\"State\" = 0");

            migrationBuilder.CreateIndex(
                name: "IX_depreciation_runs_JournalEntryId",
                table: "depreciation_runs",
                column: "JournalEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_depreciation_runs_ReversalJournalEntryId",
                table: "depreciation_runs",
                column: "ReversalJournalEntryId");

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

            migrationBuilder.CreateIndex(
                name: "IX_fixed_assets_CategoryId",
                table: "fixed_assets",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_fixed_assets_CompanyId_Code",
                table: "fixed_assets",
                columns: new[] { "CompanyId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_fixed_assets_DisposalJournalEntryId",
                table: "fixed_assets",
                column: "DisposalJournalEntryId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "depreciation_run_lines");

            migrationBuilder.DropTable(
                name: "discount_rules");

            migrationBuilder.DropTable(
                name: "depreciation_runs");

            migrationBuilder.DropTable(
                name: "fixed_assets");

            migrationBuilder.DropTable(
                name: "asset_categories");

            migrationBuilder.DropColumn(
                name: "PriceTier",
                table: "partners");

            migrationBuilder.DropColumn(
                name: "WholesalePrice",
                table: "items");
        }
    }
}
