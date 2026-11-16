using System.Text.Json;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Shared;
using Pako.Infrastructure;
using Pako.Infrastructure.Audit;

namespace Pako.Tests;

public class AuditTrailTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private sealed class FakeAuditContext : IAuditContext
    {
        public string? UserId { get; set; } = "user-1";
        public string? IpAddress { get; set; } = "203.0.113.7";
        public string? RequestId { get; set; } = "req-1";
        public Guid? SourceDocumentId { get; set; }
    }

    private async Task<PakoDbContext> NewDb(IAuditContext? context = null)
    {
        var db = await PostgresTestDatabase.CreateAsync(context);
        _contexts.Add(db);
        return db;
    }

    private static List<(string Field, string? Old, string? New)> Fields(AuditEntry entry) =>
        JsonSerializer.Deserialize<List<JsonElement>>(entry.Changes!)!
            .Select(e => (
                e.GetProperty("field").GetString()!,
                e.GetProperty("oldValue").GetString(),
                e.GetProperty("newValue").GetString()))
            .ToList();

    private static Company NewCompany(string name = "Co") => new() { Id = Guid.NewGuid(), Name = name };

    private static Partner NewPartner(Guid companyId, string name = "Acme") =>
        new() { Id = Guid.NewGuid(), CompanyId = companyId, Name = name, IsCustomer = true };

    [Fact]
    public async Task Save_AuditsCreateUpdateAndDelete_WithFieldDiffs()
    {
        var db = await NewDb(new FakeAuditContext());
        var company = NewCompany();
        var partner = NewPartner(company.Id);
        db.Companies.Add(company);
        db.Partners.Add(partner);
        await db.SaveChangesAsync();

        partner.Name = "Acme Ltd";
        partner.TaxNumber = "811234567";
        await db.SaveChangesAsync();

        db.Partners.Remove(partner);
        await db.SaveChangesAsync();

        var rows = await db.AuditEntries.AsNoTracking()
            .Where(a => a.CompanyId == company.Id && a.EntityType == "Partner" && a.EntityId == partner.Id.ToString())
            .OrderBy(a => a.SequenceNumber).ToListAsync();

        Assert.Equal(new[] { "Created", "Updated", "Deleted" }, rows.Select(r => r.Action));
        Assert.Contains(Fields(rows[0]), f => f.Field == "Name" && f.Old is null && f.New == "Acme");
        var update = Fields(rows[1]);
        Assert.Contains(("Name", "Acme", "Acme Ltd"), update);
        Assert.Contains(("TaxNumber", null, "811234567"), update);
        Assert.DoesNotContain(update, f => f.Field == "IsCustomer");
        Assert.Contains(Fields(rows[2]), f => f.Field == "Name" && f.Old == "Acme Ltd" && f.New is null);
        Assert.All(rows, r => Assert.Equal("user-1", r.UserId));
    }

    [Fact]
    public async Task Save_WithNoEffectiveChange_WritesNoAuditRow()
    {
        var db = await NewDb();
        var company = NewCompany();
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        var before = await db.AuditEntries.CountAsync();

        company.Name = company.Name;
        await db.SaveChangesAsync();

        Assert.Equal(before, await db.AuditEntries.CountAsync());
    }

    [Fact]
    public async Task Save_OfHashBookkeepingOnly_WritesNoAuditRow()
    {
        var db = await NewDb();
        var company = NewCompany();
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = Guid.NewGuid(),
            Date = new DateOnly(2026, 8, 26),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 100m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Credit = 100m }
            }
        };
        entry.Post(company);
        db.Companies.Add(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();
        var before = await db.AuditEntries.CountAsync();

        entry.EntryHash = "abc";
        entry.PrevHash = "";
        entry.SecureSequenceNumber = 1;
        await db.SaveChangesAsync();

        Assert.Equal(before, await db.AuditEntries.CountAsync());
    }

    [Fact]
    public async Task Save_OfLineChangesOnDraftEntry_FoldsIntoParentUpdate()
    {
        var db = await NewDb();
        var company = NewCompany();
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = Guid.NewGuid(), Date = new DateOnly(2026, 8, 26),
            Lines = { new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 5m } }
        };
        db.Companies.Add(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        entry.Lines[0].Debit = 9m;
        await db.SaveChangesAsync();

        var rows = await db.AuditEntries.AsNoTracking()
            .Where(a => a.EntityType == "JournalEntry" && a.EntityId == entry.Id.ToString())
            .OrderBy(a => a.SequenceNumber).ToListAsync();
        Assert.Equal(new[] { "Created", "Updated" }, rows.Select(r => r.Action));
        Assert.Contains(Fields(rows[1]), f => f.Field == "Lines" && f.New == "changed 1");
        Assert.DoesNotContain(await db.AuditEntries.ToListAsync(), a => a.EntityType == "JournalEntryLine");
    }

    [Fact]
    public async Task Save_RolledBack_LeavesNoAuditRow()
    {
        var db = await NewDb();
        var company = NewCompany();

        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            db.Companies.Add(company);
            await db.SaveChangesAsync();
            await tx.RollbackAsync();
        }

        await using var other = PostgresTestDatabase.CreateAdditionalContext(db);
        Assert.Equal(0, await other.AuditEntries.CountAsync(a => a.CompanyId == company.Id));
        Assert.Equal(0, await other.Companies.CountAsync(c => c.Id == company.Id));
    }

    [Fact]
    public async Task Save_ScopesRowsToTheOwningCompany()
    {
        var db = await NewDb();
        var a = NewCompany("A");
        var b = NewCompany("B");
        db.Companies.AddRange(a, b);
        db.Partners.Add(NewPartner(a.Id, "PA"));
        db.Partners.Add(NewPartner(b.Id, "PB"));
        await db.SaveChangesAsync();

        var partnerRows = await db.AuditEntries.AsNoTracking().Where(x => x.EntityType == "Partner").ToListAsync();
        Assert.Equal(2, partnerRows.Count);
        Assert.Contains(partnerRows, r => r.CompanyId == a.Id && Fields(r).Any(f => f.New == "PA"));
        Assert.Contains(partnerRows, r => r.CompanyId == b.Id && Fields(r).Any(f => f.New == "PB"));
    }

    [Fact]
    public async Task Save_OfCompanyLockDate_RecordsTheFieldChange()
    {
        var db = await NewDb();
        var company = NewCompany();
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        company.AccountingLockDate = new DateOnly(2026, 6, 30);
        await db.SaveChangesAsync();

        var update = await db.AuditEntries.AsNoTracking()
            .Where(a => a.EntityType == "Company" && a.Action == "Updated").SingleAsync();
        Assert.Equal(company.Id, update.CompanyId);
        Assert.Contains(("AccountingLockDate", null, "2026-06-30"), Fields(update));
    }

    [Fact]
    public async Task Redaction_MasksSecretLikeFieldNames()
    {
        Assert.True(AuditRedaction.IsSensitive("PasswordHash"));
        Assert.True(AuditRedaction.IsSensitive("RefreshToken"));
        Assert.True(AuditRedaction.IsSensitive("ApiKey"));
        Assert.True(AuditRedaction.IsSensitive("ClientSecret"));
        Assert.False(AuditRedaction.IsSensitive("Name"));
        await Task.CompletedTask;
    }

    [Fact]
    public async Task Posting_StampsIpAndSource_R28()
    {
        var context = new FakeAuditContext();
        var db = await NewDb(context);
        var company = NewCompany();
        var sourceId = Guid.NewGuid();
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = Guid.NewGuid(), Date = new DateOnly(2026, 8, 26),
            SourceDocumentId = sourceId,
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Debit = 10m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = Guid.NewGuid(), Credit = 10m }
            }
        };
        entry.Post(company);
        db.Companies.Add(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var row = await db.AuditEntries.AsNoTracking()
            .SingleAsync(a => a.EntityType == "JournalEntry" && a.Action == "Created");
        Assert.Equal("203.0.113.7", row.IpAddress);
        Assert.Equal("req-1", row.RequestId);
        Assert.Equal("user-1", row.UserId);
        Assert.Equal(sourceId, row.SourceDocumentId);
        Assert.Equal("203.0.113.7", (await db.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == entry.Id)).PostedFromIp);
    }

    [Fact]
    public async Task NoAmbientContext_StillAuditsWithNullUser()
    {
        var db = await NewDb();
        var company = NewCompany();
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var row = await db.AuditEntries.AsNoTracking().SingleAsync(a => a.CompanyId == company.Id);
        Assert.Null(row.UserId);
        Assert.Null(row.IpAddress);
    }

    [Fact]
    public async Task Chain_VerifiesAcrossSaves_AndStagedEntriesJoinIt()
    {
        var db = await NewDb(new FakeAuditContext());
        var company = NewCompany();
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        db.Partners.Add(NewPartner(company.Id));
        db.AuditEntries.Add(new AuditEntry
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, EntityType = "Invoice", EntityId = "x", Action = "Post"
        });
        await db.SaveChangesAsync();

        var result = await AuditChainVerifier.VerifyAsync(db, company.Id);
        Assert.True(result.Valid);
        Assert.Equal(3, result.CheckedCount);
        var seqs = await db.AuditEntries.AsNoTracking().Where(a => a.CompanyId == company.Id)
            .OrderBy(a => a.SequenceNumber).Select(a => a.SequenceNumber).ToListAsync();
        Assert.Equal(new long?[] { 1, 2, 3 }, seqs);
    }

    private async Task<(PakoDbContext Db, Guid CompanyId)> SeededChain()
    {
        var db = await NewDb();
        var company = NewCompany();
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        for (var i = 0; i < 3; i++)
        {
            db.Partners.Add(NewPartner(company.Id, $"P{i}"));
            await db.SaveChangesAsync();
        }

        return (db, company.Id);
    }

    private static async Task Tamper(PakoDbContext db, string sql)
    {
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE audit_entries DISABLE TRIGGER trg_audit_entries_append_only");
        await db.Database.ExecuteSqlRawAsync(sql);
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE audit_entries ENABLE TRIGGER trg_audit_entries_append_only");
    }

    [Fact]
    public async Task Chain_DetectsEditedRow()
    {
        var (db, companyId) = await SeededChain();

        await Tamper(db, "UPDATE audit_entries SET \"Changes\" = '[]' WHERE \"SequenceNumber\" = 3");

        var result = await AuditChainVerifier.VerifyAsync(db, companyId);
        Assert.False(result.Valid);
        Assert.Equal(3, result.FirstBrokenSequence);
        Assert.Equal(AuditChainVerifier.ReasonEntryHashMismatch, result.Reason);
        Assert.Equal(2, result.CheckedCount);
    }

    [Fact]
    public async Task Chain_DetectsDeletedRow()
    {
        var (db, companyId) = await SeededChain();

        await Tamper(db, "DELETE FROM audit_entries WHERE \"SequenceNumber\" = 2");

        var result = await AuditChainVerifier.VerifyAsync(db, companyId);
        Assert.False(result.Valid);
        Assert.Equal(AuditChainVerifier.ReasonSequenceGap, result.Reason);
        Assert.Equal(3, result.FirstBrokenSequence);
    }

    [Fact]
    public async Task AuditRows_CannotBeUpdatedOrDeletedThroughTheContext()
    {
        var (db, companyId) = await SeededChain();
        var row = await db.AuditEntries.FirstAsync(a => a.CompanyId == companyId);

        row.Action = "Tampered";
        await Assert.ThrowsAsync<AuditEntryImmutableException>(() => db.SaveChangesAsync());
        db.Entry(row).State = EntityState.Unchanged;

        db.AuditEntries.Remove(row);
        await Assert.ThrowsAsync<AuditEntryImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task AuditRows_CannotBeUpdatedOrDeletedInTheDatabase()
    {
        var (db, companyId) = await SeededChain();

        await Assert.ThrowsAnyAsync<Exception>(() =>
            db.Database.ExecuteSqlRawAsync("UPDATE audit_entries SET \"Action\" = 'X'"));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            db.Database.ExecuteSqlRawAsync("DELETE FROM audit_entries"));
        Assert.Equal(4, await db.AuditEntries.CountAsync(a => a.CompanyId == companyId));
    }

    [Fact]
    public async Task ConcurrentSaves_KeepOneValidChainPerCompany()
    {
        var db = await NewDb();
        var company = NewCompany();
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var tasks = Enumerable.Range(0, 20).Select(async i =>
        {
            await using var ctx = PostgresTestDatabase.CreateAdditionalContext(db);
            ctx.Partners.Add(NewPartner(company.Id, $"P{i}"));
            await ctx.SaveChangesAsync();
        });
        await Task.WhenAll(tasks);

        var result = await AuditChainVerifier.VerifyAsync(db, company.Id);
        Assert.True(result.Valid, result.Reason);
        Assert.Equal(21, result.CheckedCount);
    }

    [Fact]
    public async Task FailedSave_DoesNotLeaveCapturedRowsToBeDoubled()
    {
        var db = await NewDb();
        var company = NewCompany();
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var partner = NewPartner(company.Id);
        db.Partners.Add(partner);
        await using (var other = PostgresTestDatabase.CreateAdditionalContext(db))
        {
            other.Partners.Add(new Partner { Id = partner.Id, CompanyId = company.Id, Name = "dup" });
            await other.SaveChangesAsync();
        }

        await Assert.ThrowsAnyAsync<Exception>(() => db.SaveChangesAsync());
        db.Entry(partner).State = EntityState.Detached;
        await db.SaveChangesAsync();

        Assert.True((await AuditChainVerifier.VerifyAsync(db, company.Id)).Valid);
    }

    private sealed class FailingTransactionInterceptor : DbTransactionInterceptor
    {
        public int FailuresLeft { get; set; } = 1;

        public override ValueTask<InterceptionResult<DbTransaction>> TransactionStartingAsync(
            DbConnection connection, TransactionStartingEventData eventData, InterceptionResult<DbTransaction> result,
            CancellationToken cancellationToken = default)
        {
            if (FailuresLeft-- > 0)
            {
                throw new InvalidOperationException("transaction start failed");
            }

            return base.TransactionStartingAsync(connection, eventData, result, cancellationToken);
        }
    }

    [Fact]
    public async Task Save_WhenTransactionStartFails_RetryWritesOneAuditRow()
    {
        var db = await NewDb();
        var interceptor = new FailingTransactionInterceptor();
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseNpgsql(db.Database.GetConnectionString()!)
            .AddInterceptors(interceptor)
            .Options;
        await using var failing = new PakoDbContext(options);
        var company = NewCompany();
        failing.Companies.Add(company);

        await Assert.ThrowsAsync<InvalidOperationException>(() => failing.SaveChangesAsync());
        Assert.Empty(failing.ChangeTracker.Entries<AuditEntry>());

        await failing.SaveChangesAsync();

        Assert.Equal(1, await db.AuditEntries.AsNoTracking().CountAsync(a => a.CompanyId == company.Id));
    }

    [Fact]
    public async Task Save_OfLineWithUntrackedParent_StillAuditsParentUpdate()
    {
        var db = await NewDb();
        var company = NewCompany();
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = Guid.NewGuid(), Date = new DateOnly(2026, 8, 26)
        };
        db.Companies.Add(company);
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        await using var other = PostgresTestDatabase.CreateAdditionalContext(db);
        other.Set<JournalEntryLine>().Add(
            new JournalEntryLine { Id = Guid.NewGuid(), JournalEntryId = entry.Id, AccountId = Guid.NewGuid(), Debit = 5m });
        await other.SaveChangesAsync();

        var row = await db.AuditEntries.AsNoTracking()
            .SingleAsync(a => a.EntityType == "JournalEntry" && a.Action == "Updated");
        Assert.Equal(company.Id, row.CompanyId);
        Assert.Equal(entry.Id.ToString(), row.EntityId);
        Assert.Contains(Fields(row), f => f.Field == "Lines" && f.New == "added 1");
    }

    [Theory]
    [InlineData("PersonalNumber", true)]
    [InlineData("Pin", true)]
    [InlineData("PIN", true)]
    [InlineData("CardPin", true)]
    [InlineData("Shipping", false)]
    [InlineData("MappingCode", false)]
    [InlineData("Salary", false)]
    [InlineData("Iban", false)]
    public void Redaction_CoversPinAndPersonalIds_ButNotSalaryOrIban(string field, bool sensitive) =>
        Assert.Equal(sensitive, AuditRedaction.IsSensitive(field));
}
