using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddVehicles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "vehicles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Plate = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Make = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    Model = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    DriverUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CapacityKg = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: true),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    StockWarehouseId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_vehicles_companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_vehicles_warehouses_StockWarehouseId",
                        column: x => x.StockWarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_vehicles_CompanyId_Plate",
                table: "vehicles",
                columns: new[] { "CompanyId", "Plate" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_vehicles_StockWarehouseId",
                table: "vehicles",
                column: "StockWarehouseId",
                unique: true,
                filter: "\"StockWarehouseId\" IS NOT NULL");

            migrationBuilder.Sql(@"
INSERT INTO vehicles (""Id"", ""CompanyId"", ""Plate"", ""Make"", ""Model"", ""Type"", ""Status"", ""DriverUserId"", ""CapacityKg"", ""Notes"", ""StockWarehouseId"", ""IsArchived"", ""CreatedAt"")
SELECT gen_random_uuid(), x.""CompanyId"",
       CASE WHEN x.rn = 1 THEN UPPER(x.""Code"") ELSE LEFT(UPPER(x.""Code""), 20 - LENGTH('-' || x.rn::text)) || '-' || x.rn::text END,
       NULL, NULL, 1, CASE WHEN x.""IsActive"" THEN 0 ELSE 2 END, x.""DriverUserId"", NULL, x.""Name"", x.""Id"", NOT x.""IsActive"", x.""CreatedAt""
FROM (
    SELECT w.*, ROW_NUMBER() OVER (PARTITION BY w.""CompanyId"", UPPER(w.""Code"") ORDER BY w.""CreatedAt"", w.""Id"") AS rn
    FROM warehouses w
    WHERE w.""IsVan"" = TRUE
) x;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "vehicles");
        }
    }
}
