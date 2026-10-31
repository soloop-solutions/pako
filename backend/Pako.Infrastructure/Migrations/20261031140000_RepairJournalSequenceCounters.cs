using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pako.Infrastructure.Migrations
{
    [DbContext(typeof(PakoDbContext))]
    [Migration("20261031140000_RepairJournalSequenceCounters")]
    public partial class RepairJournalSequenceCounters : Migration
    {
        public const string RepairSql = """
            UPDATE journals AS j
            SET "SequenceNextNumber" = GREATEST(j."SequenceNextNumber", m.next_number)
            FROM (
                SELECT j2."Id" AS journal_id,
                       1 + MAX(CASE
                                   WHEN left(e."SequenceNumber", length(j2."SequencePrefix") + 1) = j2."SequencePrefix" || '-'
                                        AND substring(e."SequenceNumber" from length(j2."SequencePrefix") + 2) ~ '^[0-9]+$'
                                   THEN CASE
                                            WHEN length(e."SequenceNumber") - length(j2."SequencePrefix") - 1 <= 9
                                            THEN substring(e."SequenceNumber" from length(j2."SequencePrefix") + 2)::integer
                                        END
                               END) AS next_number
                FROM journals AS j2
                JOIN journal_entries AS e ON e."JournalId" = j2."Id"
                WHERE e."SequenceNumber" IS NOT NULL
                GROUP BY j2."Id"
            ) AS m
            WHERE m.journal_id = j."Id"
              AND m.next_number IS NOT NULL
              AND m.next_number > j."SequenceNextNumber";
            """;

        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(RepairSql);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
