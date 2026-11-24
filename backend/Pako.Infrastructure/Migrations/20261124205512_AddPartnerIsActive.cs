using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPartnerIsActive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "partners",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "partners");
        }
    }
}
