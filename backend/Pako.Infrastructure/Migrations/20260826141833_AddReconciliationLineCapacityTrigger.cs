using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddReconciliationLineCapacityTrigger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION enforce_reconciliation_line_capacity() RETURNS TRIGGER AS $$
                DECLARE
                    line_amount numeric(18,2);
                    total_reconciled numeric(18,2);
                BEGIN
                    SELECT CASE WHEN "Debit" <> 0 THEN "Debit" ELSE "Credit" END
                    INTO line_amount
                    FROM journal_entry_lines
                    WHERE "Id" = NEW."JournalEntryLineId"
                    FOR UPDATE;

                    SELECT COALESCE(SUM("Amount"), 0)
                    INTO total_reconciled
                    FROM reconciliations
                    WHERE "JournalEntryLineId" = NEW."JournalEntryLineId";

                    IF total_reconciled > line_amount THEN
                        RAISE EXCEPTION 'Journal entry line % has amount %, but % would be reconciled against it in total', NEW."JournalEntryLineId", line_amount, total_reconciled;
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_enforce_reconciliation_line_capacity
                AFTER INSERT OR UPDATE ON reconciliations
                FOR EACH ROW
                EXECUTE FUNCTION enforce_reconciliation_line_capacity();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS trg_enforce_reconciliation_line_capacity ON reconciliations;
                DROP FUNCTION IF EXISTS enforce_reconciliation_line_capacity();
                """);
        }
    }
}
