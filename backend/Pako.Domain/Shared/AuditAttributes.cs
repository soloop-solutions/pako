namespace Pako.Domain.Shared;

[AttributeUsage(AttributeTargets.Class)]
public sealed class AuditedAttribute : Attribute
{
}

[AttributeUsage(AttributeTargets.Property)]
public sealed class AuditIgnoreAttribute : Attribute
{
}

[AttributeUsage(AttributeTargets.Class)]
public sealed class AuditedChildAttribute(Type parent, string foreignKey) : Attribute
{
    public Type Parent { get; } = parent;
    public string ForeignKey { get; } = foreignKey;
}
