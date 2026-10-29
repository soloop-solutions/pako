using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddItemDescriptionAndUserFavorites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "items",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "user_favorites",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsPinned = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    IsSuppressed = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    SelectionCount = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    LastSelectedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_favorites", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_user_favorites_UserId_CompanyId_EntityType",
                table: "user_favorites",
                columns: new[] { "UserId", "CompanyId", "EntityType" });

            migrationBuilder.CreateIndex(
                name: "IX_user_favorites_UserId_CompanyId_EntityType_EntityId",
                table: "user_favorites",
                columns: new[] { "UserId", "CompanyId", "EntityType", "EntityId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_favorites");

            migrationBuilder.DropColumn(
                name: "Description",
                table: "items");
        }
    }
}
