using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Shared;

namespace Pako.Infrastructure.Audit;

public record AuditFieldChange(string Field, string? OldValue, string? NewValue);

internal static class AuditCapture
{
    private sealed record TypeInfo(bool Audited, Type? Parent, string? ForeignKey);

    private static readonly ConcurrentDictionary<Type, TypeInfo> Types = new();

    private static TypeInfo Info(Type type) => Types.GetOrAdd(type, t =>
    {
        var child = (AuditedChildAttribute?)Attribute.GetCustomAttribute(t, typeof(AuditedChildAttribute));
        return new TypeInfo(Attribute.IsDefined(t, typeof(AuditedAttribute)), child?.Parent, child?.ForeignKey);
    });

    private sealed class Pending(Guid companyId, string entityType, string entityId, string action, Guid? source)
    {
        public Guid CompanyId { get; } = companyId;
        public string EntityType { get; } = entityType;
        public string EntityId { get; } = entityId;
        public string Action { get; } = action;
        public Guid? Source { get; } = source;
        public List<AuditFieldChange> Changes { get; } = new();
    }

    private sealed class ChildTally
    {
        public int Added { get; set; }
        public int Changed { get; set; }
        public int Removed { get; set; }
    }

    public static List<AuditEntry> Capture(PakoDbContext db, IAuditContext? context)
    {
        var tracker = db.ChangeTracker;
        tracker.DetectChanges();

        var entries = tracker.Entries()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .Where(e => e.Entity is not AuditEntry)
            .ToList();

        StampPostingIp(entries, context);

        var records = new Dictionary<(string Type, string Id), Pending>();
        var order = new List<Pending>();
        var children = new Dictionary<(Type Parent, string Id), ChildTally>();

        foreach (var entry in entries)
        {
            var info = Info(entry.Metadata.ClrType);
            if (info.Parent is not null)
            {
                var parentId = entry.Property(info.ForeignKey!).CurrentValue?.ToString();
                if (parentId is null)
                {
                    continue;
                }

                var changes = Diff(entry);
                if (entry.State == EntityState.Modified && changes.Count == 0)
                {
                    continue;
                }

                if (!children.TryGetValue((info.Parent, parentId), out var tally))
                {
                    children[(info.Parent, parentId)] = tally = new ChildTally();
                }

                switch (entry.State)
                {
                    case EntityState.Added: tally.Added++; break;
                    case EntityState.Deleted: tally.Removed++; break;
                    default: tally.Changed++; break;
                }

                continue;
            }

            if (!info.Audited || ResolveCompanyId(entry) is not { } companyId)
            {
                continue;
            }

            var action = entry.State switch
            {
                EntityState.Added => "Created",
                EntityState.Deleted => "Deleted",
                _ => "Updated"
            };

            var changesForEntity = Diff(entry);
            if (entry.State == EntityState.Modified && changesForEntity.Count == 0)
            {
                continue;
            }

            var id = KeyOf(entry);
            var record = new Pending(companyId, entry.Metadata.ClrType.Name, id, action, SourceOf(entry));
            record.Changes.AddRange(changesForEntity);
            records[(record.EntityType, id)] = record;
            order.Add(record);
        }

        foreach (var ((parentType, parentId), tally) in children)
        {
            var summary = LinesSummary(tally);
            if (records.TryGetValue((parentType.Name, parentId), out var existing))
            {
                if (existing.Action != "Created")
                {
                    existing.Changes.Add(new AuditFieldChange("Lines", null, summary));
                }

                continue;
            }

            var parent = tracker.Entries().FirstOrDefault(e =>
                e.Metadata.ClrType == parentType && KeyOf(e) == parentId);
            if (parent is null || parent.State is EntityState.Added or EntityState.Deleted ||
                ResolveCompanyId(parent) is not { } companyId)
            {
                continue;
            }

            var record = new Pending(companyId, parentType.Name, parentId, "Updated", SourceOf(parent));
            record.Changes.Add(new AuditFieldChange("Lines", null, summary));
            records[(parentType.Name, parentId)] = record;
            order.Add(record);
        }

        var added = new List<AuditEntry>();
        foreach (var record in order)
        {
            var audit = new AuditEntry
            {
                Id = Guid.NewGuid(),
                CompanyId = record.CompanyId,
                EntityType = record.EntityType,
                EntityId = record.EntityId,
                Action = record.Action,
                OccurredAtUtc = DateTime.UtcNow,
                Changes = JsonSerializer.Serialize(
                    record.Changes.Select(c => new { field = c.Field, oldValue = c.OldValue, newValue = c.NewValue })),
                SourceDocumentId = record.Source
            };
            db.AuditEntries.Add(audit);
            added.Add(audit);
        }

        return added;
    }

    private static string LinesSummary(ChildTally t) =>
        string.Join(", ", new[]
        {
            t.Added > 0 ? $"added {t.Added}" : null,
            t.Changed > 0 ? $"changed {t.Changed}" : null,
            t.Removed > 0 ? $"removed {t.Removed}" : null
        }.Where(s => s is not null));

    private static void StampPostingIp(List<EntityEntry> entries, IAuditContext? context)
    {
        if (context?.IpAddress is not { } ip)
        {
            return;
        }

        foreach (var entry in entries.Where(e => e.Entity is JournalEntry))
        {
            var posted = entry.Entity is JournalEntry { State: JournalEntryState.Posted, PostedFromIp: null };
            var firstPosting = entry.State == EntityState.Added ||
                (entry.State == EntityState.Modified &&
                 entry.OriginalValues.GetValue<JournalEntryState>(nameof(JournalEntry.State)) == JournalEntryState.Draft);
            if (posted && firstPosting)
            {
                entry.Property(nameof(JournalEntry.PostedFromIp)).CurrentValue = ip;
            }
        }
    }

    private static Guid? SourceOf(EntityEntry entry) => (entry.Entity as JournalEntry)?.SourceDocumentId;

    private static string KeyOf(EntityEntry entry)
    {
        var key = entry.Metadata.FindPrimaryKey()!.Properties[0];
        return entry.Property(key.Name).CurrentValue?.ToString() ?? string.Empty;
    }

    private static Guid? ResolveCompanyId(EntityEntry entry)
    {
        if (entry.Entity is Company company)
        {
            return company.Id;
        }

        var property = entry.Metadata.FindProperty("CompanyId");
        if (property is null)
        {
            return null;
        }

        return entry.Property("CompanyId").CurrentValue switch
        {
            Guid g when g != Guid.Empty => g,
            _ => null
        };
    }

    private static List<AuditFieldChange> Diff(EntityEntry entry)
    {
        var result = new List<AuditFieldChange>();
        foreach (var property in entry.Properties)
        {
            var meta = property.Metadata;
            if (!Tracked(meta))
            {
                continue;
            }

            var oldValue = entry.State == EntityState.Added ? null : Format(property.OriginalValue);
            var newValue = entry.State == EntityState.Deleted ? null : Format(property.CurrentValue);
            if (entry.State == EntityState.Modified && !property.IsModified)
            {
                continue;
            }

            if (oldValue == newValue)
            {
                continue;
            }

            if (AuditRedaction.IsSensitive(meta.Name))
            {
                oldValue = oldValue is null ? null : AuditRedaction.Redacted;
                newValue = newValue is null ? null : AuditRedaction.Redacted;
            }

            result.Add(new AuditFieldChange(meta.Name, oldValue, newValue));
        }

        return result;
    }

    private static bool Tracked(IProperty property) =>
        !property.IsShadowProperty() &&
        !property.IsPrimaryKey() &&
        !property.IsConcurrencyToken &&
        property.Name != "RowVersion" &&
        property.ClrType != typeof(byte[]) &&
        property.PropertyInfo?.IsDefined(typeof(AuditIgnoreAttribute), false) != true;

    private static string? Format(object? value) => value switch
    {
        null => null,
        DateTime d => d.ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset d => d.ToString("O", CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString()
    };
}
